/**
 * The CLI command CodeitLab installs and publishes. `cil` is the short alias
 * created next to it; the upstream `t3` command is still recognised wherever an
 * older install may be talking to us, but every new shim, symlink and message
 * uses a CodeitLab name.
 */
export const CLI_BINARY_NAME = "codeitlab";

/** Short alias created and recognised alongside the full command. */
export const CLI_ALIAS_BINARY_NAMES = ["cil"] as const;

/** Commands written by earlier installs; accepted, never created. */
export const CLI_LEGACY_BINARY_NAMES = ["t3"] as const;

export const CLI_BINARY_NAMES = [
  CLI_BINARY_NAME,
  ...CLI_ALIAS_BINARY_NAMES,
  ...CLI_LEGACY_BINARY_NAMES,
] as const;

export type CliBinaryName = (typeof CLI_BINARY_NAMES)[number];
