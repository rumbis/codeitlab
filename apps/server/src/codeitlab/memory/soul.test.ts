import * as NodeServices from "@effect/platform-node/NodeServices";
import { MemoryService } from "@codeitlab/core/services";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as Extraction from "./MemoryExtractionService.ts";
import * as Memory from "./MemoryService.ts";
import * as MemoryStore from "./MemoryStore.ts";
import * as Soul from "./Soul.ts";

/**
 * Proves the two halves of "the agent writes its own memories": a completed turn
 * produces a memory in the corpus, and the human-readable soul files are rendered
 * from that corpus so a person can read and edit what the agent believes.
 */

const baseLayer = Layer.mergeAll(
  ServerConfig.layerTest(process.cwd(), { prefix: "codeitlab-soul-test-" }),
  ServerSettings.layerTest({
    codeitlab: { memory: { minScore: 0, retrievalTopK: 8, autoExtract: true } },
  }),
).pipe(Layer.provideMerge(NodeServices.layer));

const storeLayer = MemoryStore.layer.pipe(Layer.provide(baseLayer));
const testLayer = Layer.mergeAll(
  Memory.memoryLayer.pipe(Layer.provide(baseLayer)),
  Soul.layer.pipe(Layer.provide(storeLayer), Layer.provide(baseLayer)),
  storeLayer,
  baseLayer,
);

/**
 * Clears both halves of the state. The store alone is not enough: the soul files
 * persist the preamble from the previous test, and a stale file would make one
 * test's assertions depend on the order the tests ran in.
 */
const resetMemory = Effect.gen(function* () {
  const memory = yield* MemoryService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const entries = yield* memory.list();
  yield* Effect.forEach(entries, (entry) => memory.remove(entry.id), { discard: true });
  for (const name of Object.values(Soul.soulFileNames)) {
    const filePath = path.join(config.stateDir, "codeitlab", "memory", name);
    yield* fs.remove(filePath, { force: true }).pipe(Effect.orElseSucceed(() => undefined));
  }
});

it.layer(testLayer)("agent-written memory", (it) => {
  it.effect("turns a completed turn into a memory and renders the soul files", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const extraction = yield* Extraction.MemoryExtractionService;
      const memory = yield* MemoryService;
      const soul = yield* Soul.Soul;

      const stored = yield* extraction.extractTurn({
        prompt: "remember: we always run vp test run before committing anything",
        projectId: "project-soul",
      });
      assert.strictEqual(stored.length > 0, true);

      const listed = yield* memory.list({ projectId: "project-soul" });
      assert.strictEqual(
        listed.some((entry) => entry.text.includes("vp test run")),
        true,
      );

      const files = yield* soul.refresh;
      assert.strictEqual(files.memory.includes("vp test run"), true);
      assert.strictEqual(files.memory.includes("# What I have learned"), true);
      assert.strictEqual(files.user.includes("# Who I am working with"), true);
    }),
  );

  it.effect("separates what the user prefers from what the project requires", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const extraction = yield* Extraction.MemoryExtractionService;
      const soul = yield* Soul.Soul;

      yield* extraction.extractTurn({
        prompt: "I prefer you explain the reasoning before the diff, I never want a bare patch",
        projectId: "project-soul",
      });

      const files = yield* soul.refresh;
      // A preference describes the person, so it belongs in USER.md, not SOUL.md.
      assert.strictEqual(files.user.includes("I prefer"), true);
      assert.strictEqual(files.memory.includes("I prefer"), false);
    }),
  );

  it.effect("keeps a hand-written preamble across a refresh", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const soul = yield* Soul.Soul;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;

      const userPath = path.join(config.stateDir, "codeitlab", "memory", "USER.md");
      yield* fs.makeDirectory(path.dirname(userPath), { recursive: true });
      yield* fs.writeFileString(
        userPath,
        "# Who I am working with\n\nMy own note about this person.\n\n\u00a7\n\n- they like tests\n",
      );

      const files = yield* soul.refresh;
      assert.strictEqual(files.user.includes("My own note about this person."), true);
    }),
  );
  // A file with prose and no separator is the state after a user edits USER.md
  // before anything was learned. That text is theirs, so it must stay the
  // preamble instead of turning into a generated bullet on the next refresh.
  it.effect("keeps hand-written prose when nothing has been learned yet", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const soul = yield* Soul.Soul;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;

      const userPath = path.join(config.stateDir, "codeitlab", "memory", "USER.md");
      yield* fs.makeDirectory(path.dirname(userPath), { recursive: true });
      yield* fs.writeFileString(
        userPath,
        "# Who I am working with\n\nMy own note about this person.\n",
      );

      const files = yield* soul.refresh;
      assert.strictEqual(files.user.includes("My own note about this person."), true);
    }),
  );
  // The header is boilerplate written by this code, never by the user. Re-parsing
  // it as user preamble would copy it into the preamble and, on the next refresh,
  // bury whatever the user actually wrote underneath it.
  it.effect("never lets the generated header leak into the preamble", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const soul = yield* Soul.Soul;

      const memoryPath = path.join(config.stateDir, "codeitlab", "memory", "SOUL.md");
      yield* fs.makeDirectory(path.dirname(memoryPath), { recursive: true });
      const seeded = yield* soul.refresh;
      yield* fs.writeFileString(
        memoryPath,
        seeded.memory.trimEnd() + "\n\nIMPORTANT: staging is internal\n",
      );

      const files = yield* soul.refresh;
      assert.strictEqual(files.memory.includes("IMPORTANT: staging is internal"), true);
      assert.strictEqual(files.memory.split("Written by the agent itself").length - 1, 1);
    }),
  );
  // Someone appending a note to the bottom of the file is the most natural way to
  // add to it, and re-rendering replaces that region from the corpus.
  it.effect("keeps a note appended below the learned half", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const memory = yield* MemoryService;
      const extraction = yield* Extraction.MemoryExtractionService;
      const soul = yield* Soul.Soul;

      yield* memory.add({
        text: "Conventions live in AGENTS.md.",
        kind: "convention",
        scope: "project",
        source: "manual",
      });
      yield* extraction.extractTurn({ prompt: "remember: always run vp fmt before committing" });
      yield* soul.refresh;

      const memoryPath = path.join(config.stateDir, "codeitlab", "memory", "SOUL.md");
      const rendered = yield* fs.readFileString(memoryPath);
      yield* fs.writeFileString(memoryPath, rendered.trimEnd() + "\n\nStaging is internal.\n");

      const first = yield* soul.refresh;
      assert.strictEqual(first.memory.split("Staging is internal.").length - 1, 1);

      const second = yield* soul.refresh;
      assert.strictEqual(second.memory.split("Staging is internal.").length - 1, 1);
    }),
  );

  // The preamble and the learned half are joined with a blank line, so without an
  // explicit boundary a preamble line that looks like an entry re-parses as one.
  it.effect("does not fold learned entries into the preamble", () =>
    Effect.gen(function* () {
      yield* resetMemory;
      const memory = yield* MemoryService;
      const extraction = yield* Extraction.MemoryExtractionService;
      const soul = yield* Soul.Soul;

      yield* extraction.extractTurn({ prompt: "remember: always run vp fmt before committing" });
      yield* memory.add({
        text: "Deploys go out on Thursdays.",
        kind: "fact",
        scope: "global",
        source: "manual",
      });

      const first = yield* soul.refresh;
      const second = yield* soul.refresh;
      const third = yield* soul.refresh;
      assert.strictEqual(third.memory, second.memory);
      assert.strictEqual(first.memory, second.memory);
    }),
  );
});
