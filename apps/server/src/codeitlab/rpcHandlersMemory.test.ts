import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CodeItLabTasksService,
  CredentialsService,
  EcosystemService,
  EngagementsService,
  IntegrationsService,
  NexusService,
  PolicyService,
  QuestsService,
  ReaService,
  RemoteService,
  RoutingService,
  SandboxService,
  StudioService,
  XpService,
} from "@codeitlab/core/services";
import { assert, it } from "@effect/vitest";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Memory from "./memory/MemoryService.ts";
import * as MemoryStore from "./memory/MemoryStore.ts";
import * as Soul from "./memory/Soul.ts";
import { makeCodeItLabRpcHandlers } from "./rpcHandlers.ts";

/**
 * The settings page reaches memory over RPC, but nothing tested the handler map
 * between the wire and the service: a handler could drop a field, apply a wrong
 * default, or bypass MemoryService and still look wired in the UI.
 *
 * The memory service is real, backed by the real store, so these tests observe
 * what actually lands rather than what was passed to a mock. The other features
 * are inert because a memory request must not depend on them.
 */

const inert = new Proxy(
  {},
  {
    get: () => () => Effect.void,
  },
) as never;

// Every required tag takes the same inert implementation. The cast is the point:
// these services are only read while the handler map builds, and a memory
// request must never reach them.
const stub = <Service extends Context.Service<any, any>>(tag: Service) =>
  Layer.succeed(tag, tag.of(inert));

const inertFeatures = Layer.mergeAll(
  stub(NexusService),
  stub(PolicyService),
  stub(ReaService),
  stub(RoutingService),
  stub(EcosystemService),
  stub(StudioService),
  stub(QuestsService),
  stub(CodeItLabTasksService),
  stub(RemoteService),
  stub(IntegrationsService),
  stub(CredentialsService),
  stub(SandboxService),
  stub(XpService),
  stub(EngagementsService),
);

// The store reads config, settings, and the other features while it builds, so
// they feed it rather than sit beside it in a mergeAll.
const memoryLayer = (memory: { readonly enabled: boolean }) =>
  Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), { prefix: "codeitlab-rpc-memory-test-" }),
    ServerSettings.ServerSettingsService.layerTest({
      codeitlab: { memory: { enabled: memory.enabled } },
    }),
  ).pipe(Layer.provideMerge(inertFeatures), Layer.provideMerge(NodeServices.layer));

// The store reads config and settings while it builds, so they feed it rather
// than sit beside it.
const handlersLayer = (memory: { readonly enabled: boolean }, withSoul = false) => {
  const base = Memory.memoryLayer.pipe(Layer.provideMerge(memoryLayer(memory)));
  if (!withSoul) return base;
  // Only the soul test needs it, so every other test also proves the handler map
  // still builds when the soul is absent.
  return Layer.merge(
    base,
    Soul.layer.pipe(Layer.provide(MemoryStore.layer), Layer.provide(memoryLayer(memory))),
  );
};

describe("memory RPC handlers", () => {
  it.effect("stores an entry that list returns", () =>
    Effect.gen(function* () {
      const handlers = yield* makeCodeItLabRpcHandlers;

      yield* handlers["codeitlab.memory.add"]({
        scope: "global",
        kind: "preference",
        text: "We deploy with pnpm run deploy.",
        source: "manual",
      });

      const listed = yield* handlers["codeitlab.memory.list"]({});

      assert.lengthOf(listed, 1);
      assert.include(listed[0]?.text ?? "", "pnpm run deploy");
    }).pipe(Effect.provide(handlersLayer({ enabled: true }))),
  );

  it.effect("search defaults to the UI's limit and threshold", () =>
    Effect.gen(function* () {
      const handlers = yield* makeCodeItLabRpcHandlers;

      yield* handlers["codeitlab.memory.add"]({
        scope: "global",
        kind: "fact",
        text: "The parser lives in packages/parser.",
        source: "manual",
      });

      const hits = yield* handlers["codeitlab.memory.search"]({
        query: "where is the parser",
      });

      assert.isAtLeast(hits.length, 1);
      assert.include(hits[0]?.entry.text ?? "", "packages/parser");
    }).pipe(Effect.provide(handlersLayer({ enabled: true }))),
  );

  it.effect("update then delete leaves the store empty", () =>
    Effect.gen(function* () {
      const handlers = yield* makeCodeItLabRpcHandlers;

      const created = yield* handlers["codeitlab.memory.add"]({
        scope: "global",
        kind: "fact",
        text: "Original text.",
        source: "manual",
      });

      const updated = yield* handlers["codeitlab.memory.update"]({
        id: created.id,
        text: "Revised text.",
      });
      // The store normalizes text, so assert on the change not the punctuation.
      assert.include(updated.text, "Revised text");

      yield* handlers["codeitlab.memory.delete"]({ id: created.id });

      const remaining = yield* handlers["codeitlab.memory.list"]({});
      assert.lengthOf(remaining, 0);
    }).pipe(Effect.provide(handlersLayer({ enabled: true }))),
  );

  it.effect("stats reports the stored total", () =>
    Effect.gen(function* () {
      const handlers = yield* makeCodeItLabRpcHandlers;

      yield* handlers["codeitlab.memory.add"]({
        scope: "global",
        kind: "fact",
        text: "A counted fact.",
        source: "manual",
      });

      const stats = yield* handlers["codeitlab.memory.stats"]();

      assert.isAtLeast(stats.total, 1);
    }).pipe(Effect.provide(handlersLayer({ enabled: true }))),
  );

  it.effect("soul renders the learned memory for the settings page", () =>
    Effect.gen(function* () {
      const handlers = yield* makeCodeItLabRpcHandlers;

      yield* handlers["codeitlab.memory.add"]({
        scope: "global",
        kind: "convention",
        text: "This project always runs the tests before a commit.",
        source: "manual",
      });

      const soul = yield* Soul.Soul;
      yield* soul.refresh;

      const files = yield* handlers["codeitlab.memory.soul"]();

      assert.include(files.memory, "runs the tests before a commit");
    }).pipe(Effect.provide(handlersLayer({ enabled: true }, true))),
  );
});
