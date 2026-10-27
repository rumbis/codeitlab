/** The CLI command CodeItLab installs and publishes. */
export const CLI_BINARY_NAME = "codeitlab";

/** Short alias created and recognised alongside the full command. */
export const CLI_ALIAS_BINARY_NAMES = ["cil"] as const;

export const CLI_BINARY_NAMES = [CLI_BINARY_NAME, ...CLI_ALIAS_BINARY_NAMES] as const;

export type CliBinaryName = (typeof CLI_BINARY_NAMES)[number];
