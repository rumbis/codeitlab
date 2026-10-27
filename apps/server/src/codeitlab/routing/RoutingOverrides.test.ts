import * as NodeServices from "@effect/platform-node/NodeServices";
import { RoutingService } from "@codeitlab/core/services";
import type { ServerProvider, ServerProviderModel } from "@codeitlab/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";

import * as ServerConfig from "../../config.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Routing from "./RoutingService.ts";

/**
 * Per-task pins and delegated provider kinds sit on top of the scored decision:
 * an override replaces the winner, a delegated kind keeps its winner but stops
 * the app from pretending its own score chose it. These tests use fake
 * instances and settings only, so they never touch a provider process.
 */

const model = (slug: string, isDefault = false): ServerProviderModel =>
  ({ slug, name: slug, isDefault }) as unknown as ServerProviderModel;

const snapshot = (input: {
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly usedPercent?: number;
}): ServerProvider =>
  ({
    enabled: true,
    installed: true,
    status: "ready",
    availability: "available",
    auth: { status: "authenticated" },
    models: input.models,
    usageLimits:
      input.usedPercent === undefined
        ? undefined
        : { windows: [{ id: "session", label: "Session", usedPercent: input.usedPercent }] },
  }) as unknown as ServerProvider;

const fakeInstance = (
  instanceId: string,
  driverKind: string,
  provider: ServerProvider,
  enabled = true,
) =>
  ({
    instanceId,
    driverKind,
    displayName: instanceId,
    enabled,
    snapshot: { getSnapshot: Effect.succeed(provider), refresh: Effect.succeed(provider) },
  }) as never;

const registryLayer = (instances: ReadonlyArray<unknown>) =>
  Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
    getInstance: () => Effect.succeed(undefined),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.die("unused"),
  } as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]);

const makeLayer = (prefix: string, routing: object, instances: ReadonlyArray<unknown>) =>
  Routing.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix }),
        ServerSettings.layerTest({ codeitlab: { routing } }),
        registryLayer(instances),
        FetchHttpClient.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );

const codingPrompt = "implement a typescript endpoint and add tests";

const twoInstances = [
  fakeInstance(
    "codex-main",
    "codex",
    snapshot({ models: [model("gpt-5", true)], usedPercent: 20 }),
  ),
  fakeInstance(
    "claude-main",
    "claudeAgent",
    snapshot({ models: [model("claude-haiku", true)], usedPercent: 0 }),
  ),
];

// More models than routePerTask seeds, so the pinned model is one scoring
// would never shortlist on its own.
const overrideInstances = [
  fakeInstance(
    "codex-main",
    "codex",
    snapshot({ models: [model("gpt-5", true)], usedPercent: 20 }),
  ),
  fakeInstance(
    "claude-main",
    "claudeAgent",
    snapshot({
      models: [
        model("base-model", true),
        model("claude-opus-5"),
        model("claude-haiku"),
        model("claude-sonnet-4"),
        model("claude-mystery"),
      ],
    }),
  ),
];

it.layer(
  makeLayer(
    "codeitlab-routing-override-",
    {
      mode: "auto",
      recordHistory: false,
      taskOverrides: [
        { taskClass: "coding", providerInstanceId: "claude-main", model: "claude-mystery" },
      ],
    },
    overrideInstances,
  ),
)("RoutingService (per-task override)", (it) => {
  it.effect("pins the configured model before scoring and says so", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: codingPrompt,
        projectId: null,
        attachments: [],
      });

      assert.strictEqual(decision.taskClass, "coding");
      assert.strictEqual(decision.providerInstanceId, "claude-main");
      assert.strictEqual(decision.model, "claude-mystery");
      assert.strictEqual(decision.override, true);
      assert.strictEqual(
        decision.reason,
        "Override: coding turns are pinned to claude-main/claude-mystery.",
      );
      // The scored list is kept so the UI can show what the pin beat, and the
      // pinned model is added to it even though routePerTask did not seed it.
      assert.strictEqual(
        decision.candidates.some((candidate) => candidate.providerInstanceId === "codex-main"),
        true,
      );
      assert.strictEqual(
        decision.candidates.some(
          (candidate) =>
            candidate.providerInstanceId === "claude-main" && candidate.model === "claude-mystery",
        ),
        true,
      );
    }),
  );
});

it.layer(
  makeLayer(
    "codeitlab-routing-override-fallback-",
    {
      mode: "auto",
      recordHistory: false,
      taskOverrides: [
        { taskClass: "coding", providerInstanceId: "claude-main", model: "claude-ghost" },
      ],
    },
    twoInstances,
  ),
)("RoutingService (per-task override fallback)", (it) => {
  it.effect("falls back to scoring and names the unusable target", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: codingPrompt,
        projectId: null,
        attachments: [],
      });

      // Scoring still runs: codex-main/gpt-5 outranks the haiku model for coding.
      assert.strictEqual(decision.override, undefined);
      assert.strictEqual(decision.providerInstanceId, "codex-main");
      assert.strictEqual(decision.model, "gpt-5");
      assert.strictEqual(
        decision.reason.startsWith("Override target claude-main/claude-ghost is unavailable; "),
        true,
      );
      assert.strictEqual(decision.reason.includes("Task classified as coding"), true);
    }),
  );
});

it.layer(
  makeLayer(
    "codeitlab-routing-delegated-",
    {
      mode: "auto",
      recordHistory: false,
      delegatedProviderKinds: ["hermes"],
    },
    [fakeInstance("hermes", "hermes", snapshot({ models: [model("nemotron-3.5-bolt", true)] }))],
  ),
)("RoutingService (delegated provider kind)", (it) => {
  it.effect("marks the decision delegated and keeps the provider's model", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: codingPrompt,
        projectId: null,
        attachments: [],
      });

      assert.strictEqual(decision.providerInstanceId, "hermes");
      assert.strictEqual(decision.model, "nemotron-3.5-bolt");
      assert.strictEqual(decision.delegated, true);
      assert.strictEqual(decision.override, undefined);
      assert.strictEqual(
        decision.reason,
        "hermes routes with its own router; the app does not score its models.",
      );
    }),
  );
});

it.layer(
  makeLayer(
    "codeitlab-routing-omniroute-delegated-",
    {
      mode: "omniroute",
      recordHistory: false,
      omniRoute: { enabled: true, baseUrl: "http://127.0.0.1:1" },
    },
    twoInstances,
  ),
)("RoutingService (OmniRoute delegation)", (it) => {
  it.effect("marks the gateway decision delegated", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a rust parser",
        projectId: null,
        attachments: [],
      });

      assert.strictEqual(decision.providerInstanceId, "omniroute");
      assert.strictEqual(decision.omniRouteModel, "auto/best-coding");
      assert.strictEqual(decision.delegated, true);
    }),
  );
});

it.layer(
  makeLayer(
    "codeitlab-routing-override-pinned-",
    {
      mode: "auto",
      enforcement: "prefer",
      recordHistory: false,
      taskOverrides: [
        { taskClass: "coding", providerInstanceId: "claude-main", model: "claude-haiku" },
      ],
    },
    twoInstances,
  ),
)("RoutingService (override vs pinned thread)", (it) => {
  it.effect("reports the override but does not replace a model the thread pinned", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: codingPrompt,
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "codex-main", model: "gpt-5" },
      });

      assert.strictEqual(decision.override, true);
      assert.strictEqual(decision.providerInstanceId, "claude-main");
      assert.strictEqual(decision.enforced, false);
      assert.strictEqual(decision.skipReason, "pinned");
    }),
  );
});
