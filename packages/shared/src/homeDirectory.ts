/**
 * CodeItLab keeps its state in `~/.cil`. Installs from before the rename used
 * `~/.t3`, so the first launch that sees only the old directory moves it once.
 *
 * The decision is separated from the filesystem so both the server (Effect
 * FileSystem) and the desktop shell (Node fs) can share it. A failed move is
 * never data loss: the caller keeps using the old directory and the next launch
 * tries again.
 */

export const CODEITLAB_HOME_DIRECTORY = ".cil";
export const LEGACY_HOME_DIRECTORY = ".t3";

export type HomeDirectoryDecision =
  /** Use this directory. */
  | { readonly kind: "use"; readonly path: string }
  /** Move `from` to `to`, then use `to`; fall back to `from` if the move fails. */
  | { readonly kind: "migrate"; readonly from: string; readonly to: string };

export function decideHomeDirectory(input: {
  readonly homeDirectory: string;
  readonly joinPath: (first: string, ...segments: string[]) => string;
  readonly currentExists: boolean;
  readonly legacyExists: boolean;
}): HomeDirectoryDecision {
  const current = input.joinPath(input.homeDirectory, CODEITLAB_HOME_DIRECTORY);
  if (input.currentExists) {
    return { kind: "use", path: current };
  }
  if (input.legacyExists) {
    const legacy = input.joinPath(input.homeDirectory, LEGACY_HOME_DIRECTORY);
    return { kind: "migrate", from: legacy, to: current };
  }
  return { kind: "use", path: current };
}
