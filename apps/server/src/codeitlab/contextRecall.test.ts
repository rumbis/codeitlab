import * as NodeServices from "@effect/platform-node/NodeServices";
import type { RoutingDecision } from "@codeitlab/core";
import {
  CodeItLabContextService,
  MemoryService,
  PolicyService,
  RoutingService,
} from "@codeitlab/core/services";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Context from "./context.ts";
import * as Memory from "./memory/MemoryService.ts";
import {
  registerCodeItLabContextService,
  resetCodeItLabContextService,
  resolveCodeItLabInstructions,
} from "./turnInjection.ts";

/**
 * The read half of the memory loop, exercised end to end: entries written
 * through the real store must reach the text the turn hook injects.
 *
 * `context.test.ts` fakes MemoryService, so it proves the renderer but never the
 * recall itself. Ranking, scoping, and the settings gates are only observable
 * against the real service, which is what this file provides. Routing is faked
 * because the real one needs the provider registry, and recall does not depend
 * on it.
 */

const decision: RoutingDecision = {
  id: "route_test",
  decidedAt: "2026-10-22T00:00:00.000Z",
  taskClass: "coding",
  providerInstanceId: "codex-main",
  providerKind: "codex",
  model: "gpt-5",
  reason: "Recall does not depend on routing.",
  candidates: [],
};

const healthReport = {
  checkedAt: "2026-01-01T00:00:00.000Z",
  intervalMinutes: 30,
  nextCheckAt: "2026-01-01T00:30:00.000Z",
  source: "manual" as const,
  entries: [],
};

const policyLayer = Layer.succeed(
  PolicyService,
  PolicyService.of({
    effective: () =>
      Effect.succeed({
        profile: "standard" as const,
        appliedTo: [],
        unsupported: [],
        instructionBlock: "",
        limitations: [],
      }),
    setProfile: () => Effect.void,
    audit: () => Effect.succeed([]),
  }),
);

const routingLayer = Layer.succeed(
  RoutingService,
  RoutingService.of({
    catalog: Effect.succeed({ mode: "auto", providers: [], omniRouteModels: [] }),
    decide: () => Effect.succeed(decision),
    history: () => Effect.succeed([]),
    health: Effect.succeed(healthReport),
    checkHealth: Effect.succeed(healthReport),
    scanModels: Effect.succeed(healthReport),
    recordFallback: () => Effect.void,
  }),
);
type MemoryFlags = { readonly enabled: boolean; readonly autoRecall: boolean };

const settingsLayer = (memory: MemoryFlags) =>
  ServerSettings.ServerSettingsService.layerTest({
    codeitlab: {
      memory: { enabled: memory.enabled, autoRecall: memory.autoRecall },
      // Keep routing advisory so the block does not narrate a route the
      // orchestrator never applied.
      routing: { enforcement: "off" },
      policy: { uncensored: false },
      rea: { enabled: false, autoActivate: false },
      nexus: { enabled: false, autoInject: false },
    },
  });

// The store reads config, settings, and the filesystem at build time, so they
// must feed it rather than sit beside it.
const baseLayer = (memory: MemoryFlags) =>
  Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), { prefix: "codeitlab-recall-test-" }),
    settingsLayer(memory),
    routingLayer,
    policyLayer,
  ).pipe(Layer.provideMerge(NodeServices.layer));

const layerFor = (memory: MemoryFlags) =>
  Memory.memoryLayer.pipe(Layer.provideMerge(baseLayer(memory)));

const layerWithContext = (memory: MemoryFlags) =>
  Context.layer.pipe(Layer.provideMerge(layerFor(memory)));

const seed = (text: string) =>
  Effect.gen(function* () {
    const memory = yield* MemoryService;
    yield* memory.add({ scope: "global", kind: "preference", text, source: "manual" });
  });

const build = (prompt: string) =>
  Effect.gen(function* () {
    const service = yield* CodeItLabContextService;
    return yield* service.buildTurnContext({ prompt });
  });

const enabled = { enabled: true, autoRecall: true };
const recallOff = { enabled: true, autoRecall: false };

describe("memory auto-recall reaches the turn context", () => {
  it.layer(layerWithContext(enabled))((it) => {
    it.effect("injects a stored memory that matches the prompt", () =>
      Effect.gen(function* () {
        yield* seed("We deploy with pnpm run deploy --prod.");

        const context = yield* build("how do we deploy this service");

        assert.include(context.instructions, "pnpm run deploy");
      }),
    );

    it.effect("labels the recalled block as memory", () =>
      Effect.gen(function* () {
        yield* seed("Prefer tabs over spaces in this repo.");

        const context = yield* build("tabs or spaces");

        assert.include(context.instructions, "## Recalled memory");
      }),
    );
  });
});

describe("memory auto-recall respects its settings", () => {
  it.layer(layerWithContext(recallOff))((it) => {
    it.effect("contributes nothing when autoRecall is off", () =>
      Effect.gen(function* () {
        yield* seed("We deploy with pnpm run deploy --prod.");

        const context = yield* build("how do we deploy this service");

        assert.notInclude(context.instructions, "pnpm run deploy");
      }),
    );
  });
});

describe("memory auto-recall at the turn hook", () => {
  it.layer(layerWithContext(enabled))((it) => {
    it.effect("reaches the text the provider actually receives", () =>
      Effect.gen(function* () {
        resetCodeItLabContextService();
        yield* seed("The parser lives in packages/parser.");

        const service = yield* CodeItLabContextService;
        registerCodeItLabContextService(service);

        const block = yield* resolveCodeItLabInstructions({
          prompt: "where is the parser",
        });

        assert.isString(block);
        assert.include(block ?? "", "packages/parser");
        resetCodeItLabContextService();
      }),
    );
  });
});
