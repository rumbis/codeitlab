// @effect-diagnostics nodeBuiltinImport:off -- the test seeds a corrupt JSONL line directly.
import * as NodeFS from "node:fs";
import * as NodeOs from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../../config.ts";
import { layer as memoryStoreLayer, MemoryStore } from "./MemoryStore.ts";

const withStore = <A, E>(baseDir: string, effect: Effect.Effect<A, E, MemoryStore>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const configLayer = ServerConfig.layerTest(process.cwd(), baseDir).pipe(
        Layer.provideMerge(NodeServices.layer),
      );
      const context = yield* Layer.build(memoryStoreLayer.pipe(Layer.provide(configLayer)));
      return yield* effect.pipe(Effect.provide(context));
    }),
  );

const withTempBaseDir = <A, E, R>(use: (baseDir: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOs.tmpdir(), "codeitlab-store-test-"))),
    use,
    (baseDir) => Effect.sync(() => NodeFS.rmSync(baseDir, { recursive: true, force: true })),
  );

it.effect("persists entries and extraction time across store instances", () =>
  withTempBaseDir((baseDir) =>
    Effect.gen(function* () {
      const added = yield* withStore(
        baseDir,
        Effect.gen(function* () {
          const store = yield* MemoryStore;
          const result = yield* store.add({
            scope: "project",
            projectId: "project-1",
            kind: "convention",
            text: "Memory survives a server restart.",
            tags: ["persistence"],
            confidence: 0.9,
            source: "manual",
            maxEntries: 100,
          });
          yield* store.setLastExtractionAt("2026-10-22T00:00:00.000Z");
          return result.entry;
        }),
      );

      const reloaded = yield* withStore(
        baseDir,
        Effect.gen(function* () {
          const store = yield* MemoryStore;
          return {
            entries: yield* store.read,
            lastExtractionAt: yield* store.readLastExtractionAt,
            stats: yield* store.stats,
          };
        }),
      );

      assert.strictEqual(reloaded.entries.length, 1);
      assert.strictEqual(reloaded.entries[0]?.id, added.id);
      assert.strictEqual(reloaded.entries[0]?.text, "Memory survives a server restart");
      assert.deepEqual(reloaded.entries[0]?.tags, ["persistence"]);
      assert.strictEqual(reloaded.lastExtractionAt, "2026-10-22T00:00:00.000Z");
      assert.strictEqual(reloaded.stats.total, 1);
    }),
  ),
);

it.effect("skips malformed lines instead of losing the whole corpus", () =>
  withTempBaseDir((baseDir) =>
    Effect.gen(function* () {
      yield* withStore(
        baseDir,
        Effect.gen(function* () {
          const store = yield* MemoryStore;
          yield* store.add({
            scope: "global",
            projectId: null,
            kind: "fact",
            text: "A valid memory line.",
            tags: [],
            confidence: 0.8,
            source: "manual",
            maxEntries: 100,
          });
        }),
      );

      const corpusPath = NodePath.join(baseDir, "userdata", "codeitlab", "memory", "memory.jsonl");
      NodeFS.appendFileSync(corpusPath, "{not json}\n");

      const entries = yield* withStore(
        baseDir,
        Effect.gen(function* () {
          const store = yield* MemoryStore;
          return yield* store.read;
        }),
      );
      assert.strictEqual(entries.length, 1);
      assert.strictEqual(entries[0]?.text, "A valid memory line");
    }),
  ),
);
