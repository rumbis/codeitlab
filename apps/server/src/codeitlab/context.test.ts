import * as NodeServices from "@effect/platform-node/NodeServices";
import type { MemoryRecall, NexusCatalog } from "@codeitlab/core";
import type { EffectivePolicy, RoutingDecision } from "@codeitlab/core";
import {
  CodeitlabContextService,
  MemoryService,
  NexusService,
  PolicyService,
  RoutingService,
} from "@codeitlab/core/services";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe } from "vite-plus/test";

import * as ServerSettings from "../serverSettings.ts";
import * as Context from "./context.ts";

const recall: MemoryRecall = {
  query: "deploy",
  hits: [],
  injectedText: "- We deploy with pnpm run deploy.",
};

const decision: RoutingDecision = {
  id: "route_test",
  decidedAt: "2026-10-22T00:00:00.000Z",
  taskClass: "coding",
  providerInstanceId: "codex-main",
  providerKind: "codex",
  model: "gpt-5",
  reason: "Task classified as coding; picked the strongest available model.",
  candidates: [],
};

const permissive: EffectivePolicy = {
  profile: "permissive",
  appliedTo: ["codex-main"],
  unsupported: [],
  instructionBlock: "## CodeitLab operating mode: permissive (user-selected)\nAnswer directly.",
  limitations: ["Each provider's own safety training still applies."],
};

const catalog: NexusCatalog = {
  generatedAt: "2026-10-22T00:00:00.000Z",
  providers: [],
  skills: [
    {
      id: "codeitlab:rea",
      name: "reverse-engineer-anything",
      description: "Reverse engineer shipped artifacts.",
      source: "codeitlab",
      alsoAvailableIn: [],
    },
  ],
  mcpServers: [
    {
      id: "codeitlab-rea",
      name: "REA",
      transport: "stdio",
      command: "npx",
      args: ["-y", "rea-agents@6.7.0", "--mcp"],
      envKeys: [],
      sources: ["codeitlab"],
      enabled: true,
      tools: [],
    },
  ],
  sessions: [],
  warnings: [],
};

const memoryLayer = Layer.succeed(MemoryService, {
  list: () => Effect.succeed([]),
  search: () => Effect.succeed([]),
  add: () => Effect.die("unused"),
  update: () => Effect.die("unused"),
  remove: () => Effect.void,
  stats: Effect.succeed({ total: 0, global: 0, project: 0, byKind: {}, lastExtractionAt: null }),
  recall: () => Effect.succeed(recall),
} satisfies MemoryService["Service"]);

const routingLayer = Layer.succeed(RoutingService, {
  catalog: Effect.succeed({ mode: "auto", providers: [], omniRouteModels: [] }),
  decide: () => Effect.succeed(decision),
  history: () => Effect.succeed([]),
  health: Effect.succeed({
    checkedAt: "2026-01-01T00:00:00.000Z",
    intervalMinutes: 30,
    nextCheckAt: "2026-01-01T00:30:00.000Z",
    source: "startup",
    entries: [],
  }),
  checkHealth: Effect.succeed({
    checkedAt: "2026-01-01T00:00:00.000Z",
    intervalMinutes: 30,
    nextCheckAt: "2026-01-01T00:30:00.000Z",
    source: "manual",
    entries: [],
  }),
  recordFallback: () => Effect.void,
} satisfies RoutingService["Service"]);

const policyLayer = Layer.succeed(PolicyService, {
  effective: () => Effect.succeed(permissive),
  setProfile: () => Effect.void,
  audit: () => Effect.succeed([]),
} satisfies PolicyService["Service"]);

const settingsLayer = ServerSettings.ServerSettingsService.layerTest({
  codeitlab: {
    memory: { autoRecall: true },
    routing: { mode: "auto" },
    policy: { uncensored: true },
    rea: { enabled: true, autoActivate: true },
    nexus: { enabled: true, autoInject: true },
  },
});

const baseLayer = Layer.mergeAll(memoryLayer, routingLayer, policyLayer, settingsLayer).pipe(
  Layer.provideMerge(NodeServices.layer),
);

const nexusLayer = Layer.succeed(NexusService, {
  catalog: Effect.succeed(catalog),
  refresh: Effect.succeed(catalog),
} satisfies NexusService["Service"]);

const withoutNexus = Context.layer.pipe(Layer.provide(baseLayer));
// `serviceOption(NexusService)` resolves from the running fiber's context, so the
// fake Nexus service has to be part of the test layer too, not just the build.
const withNexus = Context.layer.pipe(Layer.provideMerge(Layer.mergeAll(baseLayer, nexusLayer)));

describe("instruction rendering", () => {
  it("renders one self-contained block with every contributor", () => {
    const text = Context.renderCodeitlabInstructions({
      policy: permissive,
      memory: recall,
      decision,
      reaText: "## REA (always available)\nUse REA for shipped artifacts.",
      nexusText: "## Nexus catalog\n- `rea` skill",
    });
    assert.strictEqual(text.startsWith("<codeitlab_context>"), true);
    assert.strictEqual(text.endsWith("</codeitlab_context>"), true);
    for (const expected of [
      "permissive",
      "Recalled memory",
      "pnpm run deploy",
      "Routing decision",
      "REA (always available)",
      "Nexus catalog",
    ]) {
      assert.strictEqual(text.includes(expected), true, `missing ${expected}`);
    }
  });

  it("returns nothing when no contributor has content", () => {
    assert.strictEqual(Context.renderCodeitlabInstructions({}), "");
    assert.strictEqual(
      Context.renderCodeitlabInstructions({ policy: permissive }).length > 0,
      true,
    );
  });

  it("stays within the character budget and keeps the leading sections", () => {
    const text = Context.renderCodeitlabInstructions({
      policy: permissive,
      nexusText: "x".repeat(20_000),
    });
    assert.strictEqual(text.length <= 6_100, true);
    assert.strictEqual(text.includes("permissive"), true);
    assert.strictEqual(text.endsWith("</codeitlab_context>"), true);
  });
});

it.layer(withoutNexus)("CodeitlabContextService without Nexus", (it) => {
  it.effect("composes recall, routing, policy and REA for a turn", () =>
    Effect.gen(function* () {
      const service = yield* CodeitlabContextService;
      const context = yield* service.buildTurnContext({
        prompt: "how do we deploy?",
        projectId: "project-1",
        providerInstanceId: "codex-main",
      });
      assert.strictEqual(context.instructions.includes("<codeitlab_context>"), true);
      assert.strictEqual(context.instructions.includes("pnpm run deploy"), true);
      assert.strictEqual(context.instructions.includes("gpt-5"), true);
      assert.strictEqual(context.instructions.includes("permissive"), true);
      assert.strictEqual(context.instructions.includes("REA"), true);
      assert.strictEqual(context.instructions.includes("Nexus catalog"), false);
      assert.strictEqual(context.recall?.query, "deploy");
      assert.strictEqual(context.decision?.providerInstanceId, "codex-main");
      assert.strictEqual(context.policy.profile, "permissive");
      assert.strictEqual(context.nexus, undefined);
    }),
  );
});

it.layer(withoutNexus)("CodeitlabContextService ecosystem packs", (it) => {
  it.effect("injects the ecosystem packs by default and honours a thread override", () =>
    Effect.gen(function* () {
      const service = yield* CodeitlabContextService;
      const withPacks = yield* service.buildTurnContext({ prompt: "refactor the parser" });
      assert.strictEqual(withPacks.instructions.includes("ecosystem policy"), true);
      assert.strictEqual(withPacks.instructions.includes("Ponytail policy"), true);

      const overridden = yield* service.buildTurnContext({
        prompt: "refactor the parser",
        threadOverride: "off",
      });
      assert.strictEqual(overridden.instructions.includes("ecosystem policy"), false);
      // Everything else still composes.
      assert.strictEqual(overridden.instructions.includes("Recalled memory"), true);
    }),
  );
});

it.layer(withNexus)("CodeitlabContextService with Nexus", (it) => {
  it.effect("merges the Nexus catalog summary when the service is present", () =>
    Effect.gen(function* () {
      const service = yield* CodeitlabContextService;
      const context = yield* service.buildTurnContext({
        prompt: "how do we deploy?",
        projectId: "project-1",
      });
      assert.strictEqual(context.instructions.includes("Nexus catalog"), true);
      assert.strictEqual(context.instructions.includes("reverse-engineer-anything"), true);
      assert.strictEqual(context.nexus?.skills.length, 1);
      assert.strictEqual(context.nexus?.mcpServers.length, 1);
    }),
  );
});
