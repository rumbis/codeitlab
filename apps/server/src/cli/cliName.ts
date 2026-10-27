import { CLI_BINARY_NAME, CLI_BINARY_NAMES } from "@codeitlab/contracts";

export { CLI_BINARY_NAME, CLI_BINARY_NAMES };

/**
 * The name our CLI is published, installed and displayed under. The upstream
 * `codeitlab` package name is still accepted wherever a legacy install could be
 * talking to us (the `codeitlab` npm package, a `cil.cmd` shim, a `bin/codeitlab` symlink).
 */
export const CLI_NAME = CLI_BINARY_NAME;

/** npm package names this CLI recognises as itself, newest first. */
export const CLI_PACKAGE_NAMES: ReadonlyArray<string> = [...CLI_BINARY_NAMES];
