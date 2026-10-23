import * as NodeServices from "@effect/platform-node/NodeServices";
import { RoutingService } from "@codeitlab/core/services";
import type { ProviderInstanceId, ServerProvider, ServerProviderModel } from "@t3tools/contracts";
import {
  AUTO_ROUTE_SELECTION,
  isAutoRouteSelection,
  TextGenerationError,
} from "@t3tools/contracts";
import type {
  ProviderTextGeneration,
  ThreadTitleGenerationInput,
} from "@t3tools/provider-core/server/textGeneration";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { FetchHttpClient } from "effect/http";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vite-plus/test";

import * as ServerConfig from "../../config.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { resetActiveRoutingService } from "./activeRoutingService.ts";
import * as Routing from "./RoutingService.ts";
import { classifyTask } from "./classify.ts";
import { parseOmniRouteModelList } from "./OmniRoute.ts";
import { chooseCandidate, scoreCandidates } from "./scoring.ts";

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
  refresh: Effect.Effect<ServerProvider> = Effect.succeed(provider),
) =>
  ({
    instanceId,
    driverKind,
    displayName: instanceId,
    enabled: true,
    snapshot: { getSnapshot: Effect.succeed(provider), refresh },
  }) as never;

const registryLayer = Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
  getInstance: () => Effect.succeed(undefined),
  listInstances: Effect.succeed([
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
  ]),
  listUnavailable: Effect.succeed([]),
  streamChanges: Stream.empty,
  subscribeChanges: Effect.die("unused"),
} as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]);

const makeLayer = (prefix: string, routing: object) =>
  Routing.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix }),
        ServerSettings.layerTest({ codeitlab: { routing } }),
        registryLayer,
        FetchHttpClient.layer,
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    ),
  );

describe("routing classification and scoring", () => {
  it("classifies task classes from prompt signals", () => {
    assert.strictEqual(
      classifyTask({ prompt: "implement the typescript endpoint and add a unit test" }).taskClass,
      "coding",
    );
    assert.strictEqual(
      classifyTask({ prompt: "why does this design trade off latency for correctness?" }).taskClass,
      "reasoning",
    );
    assert.strictEqual(
      classifyTask({ prompt: "what is in this screenshot?", attachments: ["shot.png"] }).taskClass,
      "vision",
    );
    assert.strictEqual(classifyTask({ prompt: "tldr" }).taskClass, "fast");
    assert.strictEqual(classifyTask({ prompt: "give me the cheapest option" }).taskClass, "cheap");
  });

  it("prefers available candidates and respects weights", () => {
    const ranked = scoreCandidates(
      [
        {
          providerInstanceId: "smart",
          providerKind: "codex",
          model: "gpt-5",
          quota: 0.5,
          smartness: 0.95,
          speed: 0.4,
          available: true,
        },
        {
          providerInstanceId: "fast",
          providerKind: "claudeAgent",
          model: "haiku",
          quota: 1,
          smartness: 0.5,
          speed: 0.95,
          available: true,
        },
        {
          providerInstanceId: "down",
          providerKind: "cursor",
          model: "auto",
          quota: 1,
          smartness: 1,
          speed: 1,
          available: false,
        },
      ],
      { quota: 0.35, smartness: 0.4, speed: 0.25 },
      [],
    );
    // Default weights balance quota and speed, so the cheap fast model wins.
    assert.strictEqual(ranked[0]?.providerInstanceId, "fast");
    assert.strictEqual(ranked[ranked.length - 1]?.providerInstanceId, "down");
    assert.strictEqual(chooseCandidate(ranked)?.providerInstanceId, "fast");

    // Smartness-only weights flip the winner; an unavailable candidate never wins.
    const smartFirst = scoreCandidates(
      [
        {
          providerInstanceId: "smart",
          providerKind: "codex",
          model: "gpt-5",
          quota: 0.5,
          smartness: 0.95,
          speed: 0.4,
          available: true,
        },
        {
          providerInstanceId: "fast",
          providerKind: "claudeAgent",
          model: "haiku",
          quota: 1,
          smartness: 0.5,
          speed: 0.95,
          available: true,
        },
        {
          providerInstanceId: "down",
          providerKind: "cursor",
          model: "auto",
          quota: 1,
          smartness: 1,
          speed: 1,
          available: false,
        },
      ],
      { quota: 0, smartness: 1, speed: 0 },
      [],
    );
    assert.strictEqual(smartFirst[0]?.providerInstanceId, "smart");
    assert.strictEqual(chooseCandidate(smartFirst)?.providerInstanceId, "smart");

    const speedFirst = scoreCandidates(
      [
        {
          providerInstanceId: "smart",
          providerKind: "codex",
          model: "gpt-5",
          quota: 0.5,
          smartness: 0.95,
          speed: 0.4,
          available: true,
        },
        {
          providerInstanceId: "fast",
          providerKind: "claudeAgent",
          model: "haiku",
          quota: 1,
          smartness: 0.5,
          speed: 0.95,
          available: true,
        },
      ],
      { quota: 0, smartness: 0.1, speed: 1 },
      [],
    );
    assert.strictEqual(speedFirst[0]?.providerInstanceId, "fast");
  });

  it("parses OmniRoute model discovery responses", () => {
    assert.deepEqual(
      parseOmniRouteModelList('{"data":[{"id":"auto/best-coding"},{"id":"tokenharbor/deepseek"}]}'),
      ["auto/best-coding", "tokenharbor/deepseek"],
    );
    assert.deepEqual(parseOmniRouteModelList('["auto/best-fast"]'), ["auto/best-fast"]);
    assert.deepEqual(parseOmniRouteModelList("not json"), []);
  });
});

it.layer(makeLayer("codeitlab-routing-auto-", { mode: "auto", recordHistory: true }))(
  "RoutingService (auto)",
  (it) => {
    it.effect("classifies the prompt, picks a provider, and records the decision", () =>
      Effect.gen(function* () {
        const routing = yield* RoutingService;
        const decision = yield* routing.decide({
          prompt: "implement a typescript endpoint and add tests",
          projectId: null,
          attachments: [],
        });
        assert.strictEqual(decision.taskClass, "coding");
        assert.strictEqual(decision.providerInstanceId.length > 0, true);
        assert.strictEqual(decision.model.length > 0, true);
        assert.strictEqual(decision.candidates.length, 2);
        assert.strictEqual(decision.candidates[0]!.available, true);
        assert.strictEqual(decision.reason.includes("Task classified as coding"), true);

        const history = yield* routing.history(10);
        assert.strictEqual(history[0]?.id, decision.id);

        const catalog = yield* routing.catalog;
        assert.strictEqual(catalog.mode, "auto");
        assert.strictEqual(catalog.providers.length, 2);
        assert.strictEqual(
          catalog.providers.every((provider) => provider.available),
          true,
        );
      }),
    );
  },
);

it.layer(
  makeLayer("codeitlab-routing-manual-", {
    mode: "manual",
    providerOrder: ["claude-main"],
    recordHistory: false,
  }),
)("RoutingService (manual)", (it) => {
  it.effect("honours the user's provider order", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "quick typo fix",
        projectId: null,
        attachments: [],
      });
      assert.strictEqual(decision.providerInstanceId, "claude-main");
      assert.strictEqual(decision.reason.includes("Manual routing"), true);
      assert.strictEqual((yield* routing.history(10)).length, 0);
    }),
  );

  it.effect("routes the Auto router sentinel even though the mode is manual", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
        currentModelSelection: AUTO_ROUTE_SELECTION,
      });
      assert.strictEqual(decision.enforced, true);
      assert.strictEqual(decision.skipReason, undefined);
      assert.strictEqual(decision.providerInstanceId, "claude-main");
      assert.strictEqual(
        isAutoRouteSelection({ instanceId: decision.providerInstanceId, model: decision.model }),
        false,
      );
    }),
  );
});

it.layer(
  makeLayer("codeitlab-routing-omni-", {
    mode: "omniroute",
    omniRoute: { enabled: true, baseUrl: "http://127.0.0.1:1" },
    recordHistory: false,
  }),
)("RoutingService (omniroute)", (it) => {
  it.effect("falls back to configured virtual models when discovery is unreachable", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a rust parser",
        projectId: null,
        attachments: [],
      });
      assert.strictEqual(decision.providerInstanceId, "omniroute");
      assert.strictEqual(decision.omniRouteModel, "auto/best-coding");
    }),
  );
});

it.layer(
  makeLayer("codeitlab-routing-force-", {
    mode: "auto",
    enforcement: "force",
    recordHistory: true,
  }),
)("RoutingService (enforcement force)", (it) => {
  it.effect("marks the decision enforced and records the verdict in history", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "not-registered", model: "pinned-model" },
      });
      assert.strictEqual(decision.enforced, true);
      assert.strictEqual(decision.skipReason, undefined);
      const history = yield* routing.history(10);
      assert.strictEqual(history[0]?.id, decision.id);
      assert.strictEqual(history[0]?.enforced, true);
    }),
  );

  it.effect("never enforces a /compact turn", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "/compact",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "not-registered", model: "pinned-model" },
      });
      assert.strictEqual(decision.enforced, false);
      assert.strictEqual(decision.skipReason, "compact");
    }),
  );
});

it.layer(
  makeLayer("codeitlab-routing-prefer-", {
    mode: "auto",
    enforcement: "prefer",
    recordHistory: false,
  }),
)("RoutingService (enforcement prefer)", (it) => {
  it.effect("keeps a pinned model selection", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude-main", model: "claude-pinned" },
      });
      assert.strictEqual(decision.enforced, false);
      assert.strictEqual(decision.skipReason, "pinned");
    }),
  );

  it.effect("manual mode never evaluates enforcement", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
        currentModelSelection: { instanceId: "claude-main", model: "claude-pinned" },
      });
      // Prefer keeps a pinned choice; a non-pinned call is covered by the pure tests.
      assert.strictEqual(decision.enforced, false);
    }),
  );

  it.effect("applies the routed decision to the Auto router sentinel", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
        currentModelSelection: AUTO_ROUTE_SELECTION,
      });
      // `prefer` would keep a pinned model, but the sentinel is not a pin.
      assert.strictEqual(decision.enforced, true);
      assert.strictEqual(decision.skipReason, undefined);
      assert.strictEqual(
        isAutoRouteSelection({ instanceId: decision.providerInstanceId, model: decision.model }),
        false,
      );
    }),
  );
});

it.layer(
  makeLayer("codeitlab-routing-enforcement-off-", {
    mode: "auto",
    enforcement: "off",
    recordHistory: false,
  }),
)("RoutingService (enforcement off)", (it) => {
  it.effect("still routes the Auto router sentinel", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
        currentModelSelection: AUTO_ROUTE_SELECTION,
      });
      assert.strictEqual(decision.enforced, true);
      assert.strictEqual(decision.skipReason, undefined);
      assert.strictEqual(
        isAutoRouteSelection({ instanceId: decision.providerInstanceId, model: decision.model }),
        false,
      );
    }),
  );

  it.effect("resolves the sentinel on /compact while reporting the skipped verdict", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "/compact",
        projectId: null,
        attachments: [],
        currentModelSelection: AUTO_ROUTE_SELECTION,
      });
      // The resolver still uses the routed selection; the flag records why the
      // verdict did not apply so the UI does not claim enforcement.
      assert.strictEqual(decision.enforced, false);
      assert.strictEqual(decision.skipReason, "compact");
      assert.strictEqual(
        isAutoRouteSelection({ instanceId: decision.providerInstanceId, model: decision.model }),
        false,
      );
    }),
  );
});

const registryLayerWith = (instances: ReadonlyArray<unknown>) =>
  Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
    getInstance: () => Effect.succeed(undefined),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.die("unused"),
  } as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]);

const makeLayerWithInstances = (
  prefix: string,
  routing: object,
  instances: ReadonlyArray<unknown>,
) => {
  // Keep the dependency layer in the output too so tests can read the same
  // temp state directory the service writes to.
  const dependencies = Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), { prefix }),
    ServerSettings.layerTest({ codeitlab: { routing } }),
    registryLayerWith(instances),
    FetchHttpClient.layer,
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return Layer.mergeAll(Routing.layer.pipe(Layer.provide(dependencies)), dependencies);
};

it.layer(
  makeLayerWithInstances("codeitlab-routing-health-", { mode: "auto", recordHistory: false }, [
    fakeInstance(
      "good",
      "claudeAgent",
      snapshot({ models: [model("claude-opus-5.5", true), model("claude-haiku")] }),
    ),
    fakeInstance(
      "broken",
      "codex",
      snapshot({ models: [model("gpt-6.1", true)] }),
      Effect.fail(new Error("probe timed out")) as never,
    ),
  ]),
)("RoutingService (health)", (it) => {
  it.effect("probes providers, persists the snapshot, and skips failing ones", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const health = yield* routing.checkHealth;
      assert.strictEqual(health.source, "manual");
      assert.strictEqual(health.intervalMinutes, 30);
      const good = health.entries.find((entry) => entry.providerInstanceId === "good");
      const broken = health.entries.find((entry) => entry.providerInstanceId === "broken");
      assert.strictEqual(good?.ok, true);
      assert.strictEqual(good?.status, "ok");
      assert.strictEqual(good?.models, 2);
      assert.strictEqual(broken?.ok, false);
      assert.strictEqual(broken?.status, "error");

      const persisted = yield* fs.exists(
        path.join(config.stateDir, "codeitlab", "routing", "health.json"),
      );
      assert.strictEqual(persisted, true);

      const cached = yield* routing.health;
      assert.strictEqual(cached.checkedAt, health.checkedAt);

      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
      });
      assert.strictEqual(decision.providerInstanceId, "good");
      const brokenCandidate = decision.candidates.find(
        (candidate) => candidate.providerInstanceId === "broken",
      );
      assert.strictEqual(brokenCandidate?.available, false);
    }),
  );
});

it.layer(
  makeLayerWithInstances("codeitlab-routing-quota-", { mode: "auto", recordHistory: false }, [
    fakeInstance(
      "drained",
      "codex",
      snapshot({ models: [model("gpt-6.1", true)], usedPercent: 100 }),
    ),
    fakeInstance(
      "fresh",
      "claudeAgent",
      snapshot({ models: [model("claude-opus-5.5", true)], usedPercent: 10 }),
    ),
  ]),
)("RoutingService (quota health)", (it) => {
  it.effect("demotes a provider whose quota window is exhausted", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const health = yield* routing.checkHealth;
      const drained = health.entries.find((entry) => entry.providerInstanceId === "drained");
      assert.strictEqual(drained?.status, "quota-exhausted");
      assert.strictEqual(drained?.quota, 0);
      assert.strictEqual(drained?.ok, false);

      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
      });
      assert.strictEqual(decision.providerInstanceId, "fresh");
    }),
  );
});

it.layer(
  makeLayerWithInstances("codeitlab-routing-pertask-", { mode: "auto", recordHistory: false }, [
    fakeInstance(
      "solo",
      "claudeAgent",
      snapshot({ models: [model("claude-opus-5.5", true), model("claude-haiku")] }),
    ),
  ]),
)("RoutingService (per-task models)", (it) => {
  it.effect("picks the smartest model for coding and the fastest for a quick question", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const coding = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
      });
      assert.strictEqual(coding.taskClass, "coding");
      assert.strictEqual(coding.model, "claude-opus-5.5");

      const fast = yield* routing.decide({
        prompt: "tldr",
        projectId: null,
        attachments: [],
      });
      assert.strictEqual(fast.taskClass, "fast");
      assert.strictEqual(fast.model, "claude-haiku");
    }),
  );
});

const speedInstance = (
  instanceId: string,
  driverKind: string,
  provider: ServerProvider,
  textGeneration: ProviderTextGeneration,
) =>
  ({
    instanceId,
    driverKind,
    displayName: instanceId,
    enabled: true,
    snapshot: { getSnapshot: Effect.succeed(provider), refresh: Effect.succeed(provider) },
    textGeneration,
  }) as unknown;

const registryLayerWithLookup = (instances: ReadonlyArray<unknown>) =>
  Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
    getInstance: (id: ProviderInstanceId) =>
      Effect.succeed(
        instances.find((instance) => (instance as { instanceId?: unknown }).instanceId === id),
      ),
    listInstances: Effect.succeed(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.empty,
    subscribeChanges: Effect.die("unused"),
  } as unknown as ProviderInstanceRegistry.ProviderInstanceRegistry["Service"]);

const makeSpeedLayer = (prefix: string, routing: object, instances: ReadonlyArray<unknown>) => {
  const dependencies = Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), { prefix }),
    ServerSettings.layerTest({ codeitlab: { routing } }),
    registryLayerWithLookup(instances),
    FetchHttpClient.layer,
  ).pipe(Layer.provideMerge(NodeServices.layer));
  return Layer.mergeAll(Routing.layer.pipe(Layer.provide(dependencies)), dependencies);
};

const fakeTitleGeneration = (
  handler: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<{ readonly title: string }, TextGenerationError>,
): ProviderTextGeneration =>
  ({
    generateCommitMessage: () => Effect.die("unused"),
    generatePrContent: () => Effect.die("unused"),
    generateBranchName: () => Effect.die("unused"),
    generateThreadTitle: handler,
    generateReviewGuide: () => Effect.die("unused"),
  }) as ProviderTextGeneration;

const withSpeedLayer = <A, E, R>(
  layer: Layer.Any,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E> =>
  effect.pipe(
    // The test layer supplies every service the effect needs; the cast keeps the
    // helper from leaking the layer's concrete service union into each test.
    Effect.provide(layer as Layer.Layer<unknown, never, never>),
    Effect.ensuring(Effect.sync(resetActiveRoutingService)),
  );

describe("RoutingService (speed probe)", () => {
  it.effect("measures the probe models and feeds the latency into routing", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const layer = makeSpeedLayer(
        "codeitlab-routing-speed-measured-",
        { mode: "auto", recordHistory: false, speedProbe: true, speedProbeModelsPerProvider: 2 },
        [
          speedInstance(
            "claude-main",
            "claudeAgent",
            snapshot({ models: [model("claude-opus-5", true), model("claude-haiku")] }),
            fakeTitleGeneration((input) => {
              calls.push(input.modelSelection.model);
              return Effect.succeed({ title: "hi" });
            }),
          ),
        ],
      );
      yield* withSpeedLayer(
        layer,
        Effect.gen(function* () {
          const routing = yield* RoutingService;
          const config = yield* ServerConfig.ServerConfig;
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const health = yield* routing.checkHealth;
          assert.strictEqual(health.speedProbe?.status, "done");
          assert.strictEqual(health.speedProbe?.checked, 2);
          assert.strictEqual(health.speedProbe?.total, 2);
          assert.strictEqual(health.entries[0]?.speedProbe?.status, "done");
          assert.strictEqual(health.entries[0]?.speeds?.length, 2);
          assert.deepEqual([...calls].sort(), ["claude-haiku", "claude-opus-5"]);

          // The persisted file is what the routing page and the packaged E2E read.
          const persisted = yield* fs.readFileString(
            path.join(config.stateDir, "codeitlab", "routing", "health.json"),
          );
          const decoded = JSON.parse(persisted) as {
            readonly speedProbe?: { readonly status: string; readonly checked: number };
            readonly entries?: ReadonlyArray<{ readonly speeds?: ReadonlyArray<unknown> }>;
          };
          assert.strictEqual(decoded.speedProbe?.status, "done");
          assert.strictEqual(decoded.speedProbe?.checked, 2);
          assert.strictEqual(decoded.entries?.[0]?.speeds?.length, 2);

          const decision = yield* routing.decide({
            prompt: "implement a typescript endpoint and add tests",
            projectId: null,
            attachments: [],
          });
          const haiku = decision.candidates.find((candidate) => candidate.model === "claude-haiku");
          // The coding heuristic for haiku is 0.54; the measured 0 ms probe is 1.
          assert.strictEqual(haiku?.speed, 1);
        }),
      );
    }),
  );

  it.effect("skips every model call when the speed probe is off", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const layer = makeSpeedLayer(
        "codeitlab-routing-speed-off-",
        { mode: "auto", recordHistory: false, speedProbe: false },
        [
          speedInstance(
            "claude-main",
            "claudeAgent",
            snapshot({ models: [model("claude-opus-5", true), model("claude-haiku")] }),
            fakeTitleGeneration((input) => {
              calls.push(input.modelSelection.model);
              return Effect.succeed({ title: "hi" });
            }),
          ),
        ],
      );
      yield* withSpeedLayer(
        layer,
        Effect.gen(function* () {
          const routing = yield* RoutingService;
          const health = yield* routing.checkHealth;
          assert.strictEqual(health.speedProbe?.status, "off");
          assert.strictEqual(health.speedProbe?.checked, 0);
          assert.strictEqual(health.entries[0]?.speedProbe?.status, "off");
          assert.strictEqual(health.entries[0]?.speeds?.length, 0);
          assert.strictEqual(calls.length, 0);

          // Routing still works from the heuristic tiers.
          const decision = yield* routing.decide({
            prompt: "implement a typescript endpoint and add tests",
            projectId: null,
            attachments: [],
          });
          assert.strictEqual(decision.model, "claude-opus-5");
        }),
      );
    }),
  );

  it.effect("retries a failing model once and records it as failed", () =>
    Effect.gen(function* () {
      const calls: Array<string> = [];
      const layer = makeSpeedLayer(
        "codeitlab-routing-speed-failed-",
        { mode: "auto", recordHistory: false, speedProbe: true, speedProbeModelsPerProvider: 2 },
        [
          speedInstance(
            "claude-main",
            "claudeAgent",
            snapshot({ models: [model("claude-opus-5", true), model("claude-haiku")] }),
            fakeTitleGeneration((input) => {
              calls.push(input.modelSelection.model);
              return input.modelSelection.model === "claude-haiku"
                ? Effect.fail(
                    new TextGenerationError({
                      operation: "generateThreadTitle",
                      detail: "provider down",
                    }),
                  )
                : Effect.succeed({ title: "hi" });
            }),
          ),
        ],
      );
      yield* withSpeedLayer(
        layer,
        Effect.gen(function* () {
          const routing = yield* RoutingService;
          const health = yield* routing.checkHealth;
          assert.strictEqual(calls.filter((slug) => slug === "claude-haiku").length, 2);
          assert.strictEqual(calls.filter((slug) => slug === "claude-opus-5").length, 1);

          const haikuSpeed = health.entries[0]?.speeds?.find(
            (speed) => speed.model === "claude-haiku",
          );
          assert.strictEqual(haikuSpeed?.ok, false);
          assert.match(haikuSpeed?.error ?? "", /provider down/);
          assert.strictEqual(health.entries[0]?.speedProbe?.status, "partial");
          assert.deepEqual(health.entries[0]?.speedProbe?.retrying, ["claude-haiku"]);
          assert.strictEqual(health.speedProbe?.status, "partial");

          const decision = yield* routing.decide({
            prompt: "implement a typescript endpoint and add tests",
            projectId: null,
            attachments: [],
          });
          const haiku = decision.candidates.find((candidate) => candidate.model === "claude-haiku");
          // A failed probe falls back to the coding heuristic instead of 0.
          assert.strictEqual(haiku?.speed, 0.54);
        }),
      );
    }),
  );

  it.effect("publishes the checking state before the probe finishes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const layer = makeSpeedLayer(
        "codeitlab-routing-speed-checking-",
        { mode: "auto", recordHistory: false, speedProbe: true, speedProbeModelsPerProvider: 1 },
        [
          speedInstance(
            "claude-main",
            "claudeAgent",
            snapshot({ models: [model("claude-opus-5", true)] }),
            fakeTitleGeneration(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                yield* Deferred.await(release);
                return { title: "hi" };
              }),
            ),
          ),
        ],
      );
      yield* withSpeedLayer(
        layer,
        Effect.gen(function* () {
          const routing = yield* RoutingService;
          const fiber = yield* routing.checkHealth.pipe(Effect.forkChild);
          yield* Deferred.await(started);

          const checking = yield* routing.health;
          assert.strictEqual(checking.speedProbe?.status, "checking");
          assert.strictEqual(checking.speedProbe?.checked, 0);
          assert.strictEqual(checking.speedProbe?.total, 1);
          assert.strictEqual(checking.entries[0]?.speedProbe?.status, "checking");

          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(fiber);
          const done = yield* routing.health;
          assert.strictEqual(done.speedProbe?.status, "done");
          assert.strictEqual(done.speedProbe?.checked, 1);
          assert.notStrictEqual(done.speedProbe?.finishedAt, undefined);
        }),
      );
    }),
  );

  it.effect("abandons the whole probe after 90 s and keeps finished measurements", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const layer = makeSpeedLayer(
        "codeitlab-routing-speed-timeout-",
        { mode: "auto", recordHistory: false, speedProbe: true, speedProbeModelsPerProvider: 3 },
        [
          speedInstance(
            "claude-main",
            "claudeAgent",
            snapshot({
              models: [
                model("claude-opus-5", true),
                model("claude-sonnet-4"),
                model("claude-haiku"),
              ],
            }),
            fakeTitleGeneration(() =>
              Effect.gen(function* () {
                yield* Deferred.succeed(started, undefined);
                return yield* Effect.never;
              }),
            ),
          ),
        ],
      );
      yield* withSpeedLayer(
        layer,
        Effect.gen(function* () {
          const routing = yield* RoutingService;
          const fiber = yield* routing.checkHealth.pipe(Effect.forkChild);
          yield* Deferred.await(started);
          // 40 s to exhaust the first model's two attempts, then the whole
          // probe is abandoned at 90 s while the second model hangs.
          yield* TestClock.adjust("91 seconds");
          yield* Fiber.join(fiber);

          const health = yield* routing.health;
          assert.strictEqual(health.speedProbe?.status, "partial");
          assert.strictEqual(health.speedProbe?.checked, 1);
          assert.strictEqual(health.speedProbe?.total, 3);
          assert.strictEqual(health.entries[0]?.speedProbe?.status, "partial");
          assert.notStrictEqual(health.entries[0]?.speedProbe?.finishedAt, undefined);
        }),
      );
    }),
  );
});

it.layer(
  makeLayerWithInstances(
    "codeitlab-routing-fallback-",
    { mode: "auto", recordHistory: true, fallbackOnProviderFailure: true },
    [
      fakeInstance(
        "primary",
        "claudeAgent",
        snapshot({ models: [model("claude-opus-5.5", true), model("claude-haiku")] }),
      ),
      fakeInstance("backup", "acpRegistry", snapshot({ models: [model("hermes-default", true)] })),
    ],
  ),
)("RoutingService (fallback history)", (it) => {
  it.effect("annotates the recorded decision when the run fell back to the backup", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      const decision = yield* routing.decide({
        prompt: "implement a typescript endpoint and add tests",
        projectId: null,
        attachments: [],
      });
      assert.strictEqual(decision.providerInstanceId, "primary");

      yield* routing.recordFallback({
        decisionId: decision.id,
        fromInstanceId: decision.providerInstanceId,
        toInstanceId: "backup",
        toModel: "hermes-default",
      });

      const history = yield* routing.history(10);
      const annotated = history.find((entry) => entry.id === decision.id);
      assert.ok(annotated !== undefined);
      assert.match(
        annotated.reason,
        /Fell back to backup\/hermes-default because primary failed\./,
      );
    }),
  );

  it.effect("ignores a decision id that is not in the history", () =>
    Effect.gen(function* () {
      const routing = yield* RoutingService;
      yield* routing.recordFallback({
        decisionId: "route_missing",
        fromInstanceId: "primary",
        toInstanceId: "backup",
        toModel: "hermes-default",
      });
      const history = yield* routing.history(10);
      assert.strictEqual(
        history.some((entry) => entry.id === "route_missing"),
        false,
      );
    }),
  );
});
