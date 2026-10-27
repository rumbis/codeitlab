import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * OAuth ACP agents persist their credentials in the user's home directory
 * (`~/.claude`, `~/.gemini`, `~/.config/opencode`, ...), so every instance of
 * the same agent would share one account. Instances created as an additional
 * account get their own profile directory; pointing HOME and the XDG dirs at it
 * makes the agent store and read credentials there instead.
 */
export const withAccountProfile = Effect.fn("AcpRegistryAccountProfile.with")(function* (input: {
  readonly accountProfile: boolean;
  readonly stateDir: string;
  readonly instanceId: string;
  readonly environment: NodeJS.ProcessEnv;
}) {
  if (!input.accountProfile) return input.environment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const home = path.join(input.stateDir, "acp-accounts", input.instanceId);
  yield* fs.makeDirectory(home, { recursive: true }).pipe(Effect.ignore);
  // An isolated HOME would also hide the user's git identity and credential
  // helper, so the agent's own git commands keep reading the real global file.
  const realHome = input.environment.HOME;
  return {
    ...input.environment,
    HOME: home,
    ...(realHome === undefined ? {} : { GIT_CONFIG_GLOBAL: path.join(realHome, ".gitconfig") }),
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
  };
});
