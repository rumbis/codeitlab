import * as NodeServices from "@effect/platform-node/NodeServices";
import { MemoryService } from "@codeitlab/core/services";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Extraction from "./MemoryExtractionService.ts";
import * as Memory from "./MemoryService.ts";
import * as Transfer from "./MemoryTransfer.ts";

const baseLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "codeitlab-memory-test-" }),
  ServerSettings.layerTest({
    codeitlab: {
      memory: { minScore: 0, retrievalTopK: 8 },
    },
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

const testLayer = Memory.memoryLayer.pipe(Layer.provide(baseLayer));

const resetMemory = Effect.gen(function* () {
  const memory = yield* MemoryService;
  const entries = yield* memory.list();
  yield* Effect.forEach(entries, (entry) => memory.remove(entry.id), { discard: true });
});

it.layer(testLayer)("MemoryService", (it) => {
  it.effect("stores, searches, recalls, updates and removes entries", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const memory = yield* MemoryService;
      const stored = yield* memory.add({
        scope: "project",
        projectId: "project-1",
        kind: "convention",
        text: "Focused tests run with vp test run before any commit.",
        tags: ["testing"],
      });
      assert.strictEqual(stored.id.startsWith("mem_"), true);

      const listed = yield* memory.list({ projectId: "project-1" });
      assert.strictEqual(listed.length, 1);

      const hits = yield* memory.search({
        query: "how do we run tests",
        projectId: "project-1",
        limit: 10,
        minScore: 0,
      });
      assert.strictEqual(hits[0]?.entry.id, stored.id);

      const recall = yield* memory.recall({
        query: "how do we run tests",
        projectId: "project-1",
      });
      assert.strictEqual(recall.injectedText.includes("vp test run"), true);

      const updated = yield* memory.update(stored.id, { tags: ["testing", "workflow"] });
      assert.deepEqual(updated.tags, ["testing", "workflow"]);

      const stats = yield* memory.stats;
      assert.strictEqual(stats.total, 1);
      assert.strictEqual(stats.project, 1);

      yield* memory.remove(stored.id);
      assert.strictEqual((yield* memory.list()).length, 0);
    }),
  );

  it.effect("keeps project memories scoped and global memories shared", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const memory = yield* MemoryService;
      yield* memory.add({
        scope: "global",
        kind: "preference",
        text: "Prefer direct answers without preamble.",
      });
      yield* memory.add({
        scope: "project",
        projectId: "project-a",
        kind: "fact",
        text: "Project A deploys with fly.io.",
      });
      yield* memory.add({
        scope: "project",
        projectId: "project-b",
        kind: "fact",
        text: "Project B deploys with railway.",
      });

      const forA = yield* memory.list({ projectId: "project-a" });
      assert.strictEqual(forA.length, 2);
      assert.strictEqual(
        forA.some((entry) => entry.text.includes("railway")),
        false,
      );

      const globalOnly = yield* memory.list({ scope: "global" });
      assert.strictEqual(globalOnly.length, 1);
    }),
  );

  it.effect("rejects credential-shaped memories instead of storing them", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const memory = yield* MemoryService;
      const failure = yield* Effect.flip(
        memory.add({
          scope: "global",
          kind: "fact",
          text: "The API key is sk-abcdefghijklmnopqrstuvwxyz012345.",
        }),
      );
      assert.strictEqual(failure._tag, "CodeItLabServiceError");
      assert.strictEqual(failure.operation, "memory.add");
      assert.strictEqual((yield* memory.list()).length, 0);
    }),
  );

  it.effect("extracts durable memories after a turn", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const extraction = yield* Extraction.MemoryExtractionService;
      const memory = yield* MemoryService;
      const stored = yield* extraction.extractTurn({
        prompt: "remember: the deploy command is pnpm run deploy and it needs FLY_API_TOKEN",
        projectId: "project-1",
      });
      assert.strictEqual(stored.length > 0, true);
      const listed = yield* memory.list({ projectId: "project-1" });
      assert.strictEqual(
        listed.some((entry) => entry.source === "turn"),
        true,
      );
    }),
  );

  it.effect("exports and re-imports without duplicating entries", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const transfer = yield* Transfer.MemoryTransferService;
      const memory = yield* MemoryService;
      yield* memory.add({ scope: "global", kind: "fact", text: "Memory exports are JSON." });
      const json = yield* transfer.exportJson;
      const before = (yield* memory.list()).length;
      const result = yield* transfer.importJson(json);
      assert.strictEqual(result.total, before);
      assert.strictEqual(result.imported, 0);
    }),
  );
});
