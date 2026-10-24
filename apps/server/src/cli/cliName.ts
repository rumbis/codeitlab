import { CLI_BINARY_NAME, CLI_BINARY_NAMES } from "@t3tools/contracts";

export { CLI_BINARY_NAME, CLI_BINARY_NAMES };

/**
 * The name our CLI is published, installed and displayed under. The upstream
 * `t3` package name is still accepted wherever a legacy install could be
 * talking to us (the `t3` npm package, a `t3.cmd` shim, a `bin/t3` symlink).
 */
export const CLI_NAME = CLI_BINARY_NAME;

/** npm package names this CLI recognises as itself, newest first. */
export const CLI_PACKAGE_NAMES: ReadonlyArray<string> = [...CLI_BINARY_NAMES];
