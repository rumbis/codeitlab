import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { ServerConfig } from "../../config.ts";
import { makeThreadOverrideStore, readPackOverrideCommand } from "./threadOverrides.ts";

const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "thread-overrides-test-",
}).pipe(Layer.provideMerge(NodeServices.layer));

it("detects the stop phrases a user actually types", () => {
  assert.strictEqual(readPackOverrideCommand("stop caveman"), "off");
  assert.strictEqual(readPackOverrideCommand("Stop caveman."), "off");
  assert.strictEqual(readPackOverrideCommand("normal mode"), "off");
  assert.strictEqual(readPackOverrideCommand("  stop   terse! "), "off");
  assert.strictEqual(readPackOverrideCommand("caveman mode"), "on");
  assert.strictEqual(readPackOverrideCommand("ponytail mode"), "on");
});

it("does not treat a normal sentence containing a phrase as a command", () => {
  assert.isUndefined(readPackOverrideCommand("why did the caveman mode break the build?"));
  assert.isUndefined(readPackOverrideCommand("add a normal mode toggle to settings"));
  assert.isUndefined(
    readPackOverrideCommand(
      "normal mode should probably keep the risk line, explain how that works in the context renderer",
    ),
  );
});

it.effect("persists an override per thread and clears it", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const store = yield* makeThreadOverrideStore({ stateDir: config.stateDir });

    assert.isUndefined(yield* store.get("thread-a"));
    yield* store.set("thread-a", "off");
    assert.strictEqual(yield* store.get("thread-a"), "off");
    assert.isUndefined(yield* store.get("thread-b"));

    // A second store instance reads the same file (survives a restart).
    const reopened = yield* makeThreadOverrideStore({ stateDir: config.stateDir });
    assert.strictEqual(yield* reopened.get("thread-a"), "off");

    yield* store.set("thread-a", undefined);
    assert.isUndefined(yield* store.get("thread-a"));

    const file = path.join(config.stateDir, "codeitlab", "ecosystem", "threadOverrides.json");
    assert.isTrue(yield* fs.exists(file));
  }).pipe(Effect.provide(configLayer)),
);

it.effect("treats a malformed override file as empty", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(config.stateDir, "codeitlab", "ecosystem", "threadOverrides.json");
    yield* fs.makeDirectory(path.dirname(file), { recursive: true });
    yield* fs.writeFileString(file, "{not json");
    const store = yield* makeThreadOverrideStore({ stateDir: config.stateDir });
    assert.isUndefined(yield* store.get("thread-a"));
  }).pipe(Effect.provide(configLayer)),
);
