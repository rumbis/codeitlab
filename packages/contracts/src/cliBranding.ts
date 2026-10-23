/**
 * The CLI command CodeitLab installs and publishes. The upstream `t3` command is
 * still recognised wherever an older install may be talking to us, but every new
 * shim, symlink and message uses the branded name.
 */
export const CLI_BINARY_NAME = "codeitlab";

/** Commands written by earlier installs; accepted, never created. */
export const CLI_LEGACY_BINARY_NAMES = ["t3"] as const;

export const CLI_BINARY_NAMES = [CLI_BINARY_NAME, ...CLI_LEGACY_BINARY_NAMES] as const;

export type CliBinaryName = (typeof CLI_BINARY_NAMES)[number];
