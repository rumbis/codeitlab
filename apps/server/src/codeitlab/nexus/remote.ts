import type { NexusMcpServer, NexusSession, NexusSkill } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { skillId } from "./fingerprint.ts";
import { parseHermesMcpConfig } from "./mcp.ts";
import { parseSkillDocument } from "./skills.ts";

/**
 * Remote harness ingestion over SSH (which also covers tailnet hosts reachable
 * by `tailscale ssh`). The remote side only reads files: Nexus must never
 * mutate another machine's harness config during a catalog refresh.
 *
 * One script produces a small record protocol so a refresh is a single SSH
 * round trip instead of one call per file.
 */
export const buildRemoteIngestionScript = (): string =>
  [
    "export LC_ALL=C",
    'for root in "$HOME/.hermes/skills" "$HOME/.claude/skills"; do',
    '  [ -d "$root" ] || continue',
    '  find "$root" -name SKILL.md -type f 2>/dev/null | head -100 | while IFS= read -r f; do',
    '    printf "@@SKILL %s\\n" "$f"',
    '    head -n 40 "$f" 2>/dev/null',
    '    printf "\\n@@END\\n"',
    "  done",
    "done",
    'if [ -f "$HOME/.hermes/config.yaml" ]; then',
    '  printf "@@HERMES_CONFIG\\n"',
    `  awk 'BEGIN{inside=0} /^mcp_servers:/{inside=1} inside && /^[^[:space:]#]/{if ($0 !~ /^mcp_servers:/) exit} inside{print}' "$HOME/.hermes/config.yaml" | head -n 400`,
    '  printf "\\n@@END\\n"',
    "fi",
    'if [ -d "$HOME/.hermes/sessions" ]; then',
    `  find "$HOME/.hermes/sessions" -maxdepth 1 -name '*.jsonl' -type f 2>/dev/null | head -40 | while IFS= read -r f; do printf "@@SESSION hermes %s\\\\n" "$f"; done`,
    "fi",
    'if [ -d "$HOME/.claude/projects" ]; then',
    `  find "$HOME/.claude/projects" -name '*.jsonl' -type f 2>/dev/null | head -40 | while IFS= read -r f; do printf "@@SESSION claude %s\\\\n" "$f"; done`,
    "fi",
  ].join("\n");

export interface RemoteIngestionInput {
  readonly host: string;
  readonly transport: "ssh" | "tailscale";
  /** Provider instance these records belong to (e.g. a custom ACP agent id). */
  readonly providerInstanceId: string;
  readonly generatedAt: string;
}

export interface RemoteIngestionOutput {
  readonly skills: ReadonlyArray<NexusSkill>;
  readonly mcpServers: ReadonlyArray<NexusMcpServer>;
  readonly sessions: ReadonlyArray<NexusSession>;
  readonly warnings: ReadonlyArray<string>;
}

const skillSourceForPath = (filePath: string): NexusSkill["source"] => {
  if (filePath.includes("/.hermes/")) return "hermes";
  if (filePath.includes("/.claude/")) return "claude";
  return "filesystem";
};

const nameFromSkillPath = (filePath: string): string => {
  const parent =
    filePath
      .replace(/\/SKILL\.md$/u, "")
      .split("/")
      .pop() ?? "";
  return parent.replace(/[-_]+/gu, " ").trim();
};

export function parseRemoteIngestionOutput(
  stdout: string,
  input: RemoteIngestionInput,
): RemoteIngestionOutput {
  const skills: Array<NexusSkill> = [];
  const mcpServers: Array<NexusMcpServer> = [];
  const sessions: Array<NexusSession> = [];
  const warnings: Array<string> = [];

  const lines = stdout.split(/\r?\n/u);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.startsWith("@@SKILL ")) {
      const path = line.slice("@@SKILL ".length).trim();
      const body: Array<string> = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "") !== "@@END") {
        body.push(lines[index] ?? "");
        index += 1;
      }
      const frontmatter = parseSkillDocument(body.join("\n"));
      const name = frontmatter.name ?? nameFromSkillPath(path);
      if (name.length > 0) {
        const source = skillSourceForPath(path);
        skills.push({
          id: skillId(source, name),
          name,
          description: frontmatter.description ?? "",
          source,
          providerInstanceId: input.providerInstanceId,
          path,
          alsoAvailableIn: [],
        });
      }
    } else if (line === "@@HERMES_CONFIG") {
      const body: Array<string> = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "") !== "@@END") {
        body.push(lines[index] ?? "");
        index += 1;
      }
      mcpServers.push(
        ...parseHermesMcpConfig(body.join("\n"), ["hermes", input.providerInstanceId]),
      );
    } else if (line.startsWith("@@SESSION ")) {
      const [, provider, path] = line.split(/\s+/u);
      if (provider !== undefined && path !== undefined) {
        const id = (path.split("/").pop() ?? "").replace(/\.jsonl$/u, "");
        if (id.length > 0) {
          sessions.push({
            id,
            providerInstanceId: input.providerInstanceId,
            providerKind: provider,
            title: `Remote ${provider} session ${id}`,
            updatedAt: input.generatedAt,
            cwd: undefined,
            remote: true,
          });
        }
      }
    }
    index += 1;
  }

  if (skills.length === 0 && mcpServers.length === 0 && sessions.length === 0) {
    warnings.push(`Remote harness on ${input.host} returned no skills, MCP servers, or sessions.`);
  }
  return { skills, mcpServers, sessions, warnings };
}

export type RemoteCommandRunner = (input: {
  readonly host: string;
  readonly transport: "ssh" | "tailscale";
  readonly command: string;
  readonly timeoutMs?: number;
}) => Effect.Effect<
  { readonly stdout: string; readonly stderr: string },
  { readonly message: string }
>;

export const readRemoteHarnessCatalog = Effect.fn("Nexus.readRemoteHarnessCatalog")(function* (
  input: RemoteIngestionInput & { readonly runner: RemoteCommandRunner },
) {
  const script = buildRemoteIngestionScript();
  const result = yield* input
    .runner({
      host: input.host,
      transport: input.transport,
      command: script,
      timeoutMs: 20_000,
    })
    .pipe(Effect.result);
  if (result._tag === "Failure") {
    return {
      skills: [],
      mcpServers: [],
      sessions: [],
      warnings: [
        `Could not ingest harness on ${input.host} over ${input.transport}: ${result.failure.message}`,
      ],
    } satisfies RemoteIngestionOutput;
  }
  return parseRemoteIngestionOutput(result.success.stdout, input);
});

/** ACP/stdio descriptor for a merged Nexus MCP server, for the follow-up adapter hook. */
export function toAcpMcpServer(server: NexusMcpServer): {
  readonly name: string;
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly env: ReadonlyArray<{ readonly name: string; readonly value: string }>;
} | null {
  if (server.transport !== "stdio" || server.command === undefined || !server.enabled) return null;
  return {
    name: server.name.replace(/[^A-Za-z0-9_-]+/gu, "-"),
    command: server.command,
    args: server.args,
    // Env values are deliberately not stored in the catalog; callers resolve
    // them from the owning harness config before advertising the server.
    env: [],
  };
}
