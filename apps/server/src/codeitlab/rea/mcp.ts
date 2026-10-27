import type { NexusMcpServer } from "@codeitlab/core/nexus";
import type { CodeItLabReaSettings } from "@codeitlab/core/settings";

/**
 * REA is always-on: the MCP server is registered for every provider session and
 * the skill is seeded into the app-managed skills directory. Both are written
 * under `<stateDir>/codeitlab/` so Nexus can ingest them without importing this
 * module (see docs/codeitlab/MEMORY-REA-ROUTING.md).
 */

export const REA_MCP_SERVER_ID = "codeitlab-rea";
export const REA_SKILL_NAME = "reverse-engineer-anything";

/** `rea --mcp` is the stdio server; `rea mcp add|doctor` only register/validate it. */
export const REA_SERVER_FLAG = "--mcp";

const REA_SUBCOMMAND_FLAGS = new Set(["mcp", "--mcp"]);

/**
 * Settings store the MCP server invocation. Older defaults ended with `mcp`,
 * which prints help instead of starting a server, so strip any trailing
 * subcommand/flag and append the verified `--mcp` form.
 */
export const reaServerArgs = (settings: CodeItLabReaSettings): ReadonlyArray<string> => {
  const args = [...settings.mcpArgs];
  while (args.length > 0) {
    const last = args[args.length - 1];
    if (last === undefined || !REA_SUBCOMMAND_FLAGS.has(last)) break;
    args.pop();
  }
  return [...args, REA_SERVER_FLAG];
};

/** Base `npx -y rea-agents@<version>` arguments without the server flag. */
export const reaCliArgs = (settings: CodeItLabReaSettings): ReadonlyArray<string> => {
  const args = [...reaServerArgs(settings)];
  args.pop();
  return args;
};

export const reaMcpServer = (settings: CodeItLabReaSettings): NexusMcpServer => ({
  id: REA_MCP_SERVER_ID,
  name: "REA",
  transport: "stdio",
  command: settings.mcpCommand,
  args: [...reaServerArgs(settings)],
  envKeys: [],
  sources: ["codeitlab", "rea"],
  enabled: settings.enabled,
  tools: [],
});
