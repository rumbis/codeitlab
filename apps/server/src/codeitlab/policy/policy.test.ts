import * as NodeServices from "@effect/platform-node/NodeServices";
import { PolicyService } from "@codeitlab/core/services";
import type { ServerProvider } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { describe } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Policy from "./PolicyService.ts";
import { providerInstructionSupport, resolveEffectivePolicy } from "./instruction.ts";

const instances = [
  { instanceId: "codex-main", driverKind: "codex" },
  { instanceId: "claude-main", driverKind: "claudeAgent" },
];

const fakeInstance = (instanceId: string, driverKind: string) =>
  ({
    instanceId,
    driverKind,
    displayName: instanceId,
    enabled: true,
    snapshot: {
      getSnapshot: Effect.succeed({} as ServerProvider),
    },
  }) as never;

const registryLayer = Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
  getInstance: () => Effect.succeed(undefined),
  listInstances: Effect.succeed(
    instances.map((entry) => fakeInstance(entry.instanceId, entry.driverKind)),
  ),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  subscribeChanges: Effect.die("unused"),
} as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]);

const baseLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "codeitlab-policy-test-" }),
  ServerSettings.layerTest(),
  registryLayer,
).pipe(Layer.provideMerge(NodeServices.layer));

const testLayer = Policy.layer.pipe(Layer.provide(baseLayer));

describe("policy resolution", () => {
  it("maps each driver to the channel CodeitLab can actually use", () => {
    assert.strictEqual(providerInstructionSupport("codex").mechanism, "developer-instructions");
    assert.strictEqual(providerInstructionSupport("claudeAgent").mechanism, "message-prefix");
    assert.strictEqual(providerInstructionSupport("opencode").supported, true);
  });

  it("applies the permissive profile only to requested providers", () => {
    const effective = resolveEffectivePolicy({
      profile: "permissive",
      applyToProviders: ["claude-main"],
      instances,
    });
    assert.deepEqual(effective.appliedTo, ["claude-main"]);
    assert.strictEqual(effective.instructionBlock.includes("permissive"), true);
    assert.strictEqual(effective.limitations.length > 0, true);
  });

  it("reports unregistered providers instead of silently applying", () => {
    const effective = resolveEffectivePolicy({
      profile: "permissive",
      applyToProviders: [],
      instances,
      providerInstanceId: "missing-provider",
    });
    assert.deepEqual(effective.appliedTo, []);
    assert.strictEqual(effective.unsupported[0]?.providerInstanceId, "missing-provider");
  });

  it("keeps the standard profile free of instruction overrides", () => {
    const effective = resolveEffectivePolicy({
      profile: "standard",
      applyToProviders: [],
      instances,
    });
    assert.strictEqual(effective.instructionBlock, "");
    assert.deepEqual(effective.appliedTo, []);
  });
});

it.layer(testLayer)("PolicyService", (it) => {
  it.effect("switches profiles, audits the change, and never claims to bypass providers", () =>
    Effect.gen(function* () {
      const policy = yield* PolicyService;
      const standard = yield* policy.effective();
      assert.strictEqual(standard.profile, "standard");

      yield* policy.setProfile("permissive");
      const permissive = yield* policy.effective({ providerInstanceId: "codex-main" });
      assert.strictEqual(permissive.profile, "permissive");
      assert.deepEqual(permissive.appliedTo, ["codex-main"]);
      assert.strictEqual(
        permissive.limitations.some((line) => line.toLowerCase().includes("provider")),
        true,
      );
      assert.strictEqual(permissive.instructionBlock.includes("bypass the provider"), true);
      assert.strictEqual(permissive.instructionBlock.includes("ignore provider policy"), false);

      const audit = yield* policy.audit(10);
      assert.strictEqual(audit.length >= 2, true);
      assert.strictEqual(
        audit.some((entry) => entry.providerInstanceId === "codex-main"),
        true,
      );

      yield* policy.setProfile("standard");
      assert.strictEqual((yield* policy.effective()).profile, "standard");
    }),
  );
});
