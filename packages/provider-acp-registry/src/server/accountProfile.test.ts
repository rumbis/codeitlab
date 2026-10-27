import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";

import { withAccountProfile } from "./accountProfile.ts";

it.effect("leaves the environment untouched without an account profile", () =>
  Effect.gen(function* () {
    const environment = { PATH: "/tools", HOME: "/Users/me" };
    const result = yield* withAccountProfile({
      accountProfile: false,
      stateDir: "/state",
      instanceId: "acpRegistry_gemini_2",
      environment,
    });
    assert.strictEqual(result, environment);
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("points HOME and the XDG dirs at the per-instance profile", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "cil-account-profile-" });
    const result = yield* withAccountProfile({
      accountProfile: true,
      stateDir,
      instanceId: "acpRegistry_gemini_2",
      environment: { PATH: "/tools", HOME: "/Users/me" },
    });
    const home = `${stateDir}/acp-accounts/acpRegistry_gemini_2`;
    assert.strictEqual(result.HOME, home);
    assert.strictEqual(result.XDG_CONFIG_HOME, `${home}/.config`);
    assert.strictEqual(result.XDG_DATA_HOME, `${home}/.local/share`);
    assert.strictEqual(result.XDG_STATE_HOME, `${home}/.local/state`);
    assert.strictEqual(result.PATH, "/tools");
    assert.strictEqual(result.GIT_CONFIG_GLOBAL, "/Users/me/.gitconfig");
    assert.isTrue(yield* fs.exists(home));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
