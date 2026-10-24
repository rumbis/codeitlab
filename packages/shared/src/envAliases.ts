/**
 * `CIL_*` is the documented environment prefix. The processes underneath still
 * read `T3CODE_*`, and the desktop shell passes its environment to the server it
 * spawns, so entries copy `CIL_X` to `T3CODE_X` once at startup when the legacy
 * name is unset. An explicitly set legacy name always wins, which keeps pinned
 * installs and debugging setups working.
 */

export const CODEITLAB_ENV_PREFIX = "CIL_";
export const LEGACY_ENV_PREFIX = "T3CODE_";

/** Copies every `CIL_*` entry to its `T3CODE_*` counterpart. Returns the names written. */
export function applyCilEnvAliases(env: NodeJS.ProcessEnv = process.env): ReadonlyArray<string> {
  const applied: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(CODEITLAB_ENV_PREFIX) || value === undefined) continue;
    const legacyKey = `${LEGACY_ENV_PREFIX}${key.slice(CODEITLAB_ENV_PREFIX.length)}`;
    const existing = env[legacyKey];
    if (existing !== undefined && existing.trim() !== "") continue;
    env[legacyKey] = value;
    applied.push(legacyKey);
  }
  return applied;
}
