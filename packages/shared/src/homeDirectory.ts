/**
 * CodeItLab keeps its state in `~/.cil`.
 *
 * The path is built here rather than inline so the server (Effect FileSystem)
 * and the desktop shell (Node fs) agree on one directory, and so tests can
 * resolve it without touching the filesystem.
 */

export const CIL_HOME_DIRECTORY = ".cil";

export function cilHomePath(input: {
  readonly homeDirectory: string;
  readonly joinPath: (first: string, ...segments: string[]) => string;
}): string {
  return input.joinPath(input.homeDirectory, CIL_HOME_DIRECTORY);
}
