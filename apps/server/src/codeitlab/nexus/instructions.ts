import type { NexusCatalog, NexusMcpServer, NexusSession, NexusSkill } from "@codeitlab/contracts";

/**
 * Pure instruction-block builder. The orchestration layer appends whatever this
 * returns to a provider turn; nothing here reads settings, files, or the clock,
 * so the same catalog always produces the same block (testable, cacheable, and
 * safe to persist).
 *
 * Kept deliberately short: this text costs tokens on *every* turn, so it
 * advertises what exists (skills, MCP servers, recent sessions) instead of
 * pasting skill bodies or session transcripts.
 */

export interface NexusInstructionOptions {
  readonly maxSkills?: number;
  readonly maxMcpServers?: number;
  readonly maxSessions?: number;
  /** Optional user prompt; sessions whose title/cwd share words rank first. */
  readonly query?: string;
  readonly heading?: string;
}

const DEFAULT_MAX_SKILLS = 16;
const DEFAULT_MAX_MCP = 10;
const DEFAULT_MAX_SESSIONS = 5;

const tokenize = (value: string): ReadonlyArray<string> =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length >= 3);

const sessionScore = (session: NexusSession, queryTokens: ReadonlySet<string>): number => {
  if (queryTokens.size === 0) return 0;
  const haystack = new Set(tokenize(`${session.title} ${session.cwd ?? ""}`));
  let score = 0;
  for (const token of queryTokens) if (haystack.has(token)) score += 1;
  return score;
};

export const rankSessionsForQuery = (
  sessions: ReadonlyArray<NexusSession>,
  query: string | undefined,
  limit: number,
): ReadonlyArray<NexusSession> => {
  const queryTokens = new Set(tokenize(query ?? ""));
  return [...sessions]
    .map((session, index) => ({ session, index, score: sessionScore(session, queryTokens) }))
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        right.session.updatedAt.localeCompare(left.session.updatedAt) ||
        left.index - right.index,
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.session);
};

const oneLine = (value: string, max: number): string => {
  const single = value.replace(/\s+/gu, " ").trim();
  return single.length <= max ? single : `${single.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
};

const skillLine = (skill: NexusSkill): string => {
  const description = skill.description.length === 0 ? "" : ` — ${oneLine(skill.description, 140)}`;
  const alsoIn =
    skill.alsoAvailableIn.length === 0 ? "" : ` (also in ${skill.alsoAvailableIn.join(", ")})`;
  return `- \`${skill.name}\` [${skill.source}${alsoIn}]${description}`;
};

const mcpLine = (server: NexusMcpServer): string => {
  const target = server.url ?? [server.command, ...server.args].filter(Boolean).join(" ");
  const sources = server.sources.length === 0 ? "" : `; from ${server.sources.join(", ")}`;
  const status = server.enabled ? "" : " (disabled)";
  return `- \`${server.name}\` [${server.transport}${status}${sources}]${target === "" ? "" : ` → ${oneLine(target, 120)}`}`;
};

const sessionLine = (session: NexusSession): string => {
  const when = session.updatedAt.slice(0, 10);
  const where = session.cwd === undefined ? "" : ` · ${oneLine(session.cwd, 80)}`;
  const remote = session.remote ? " · remote" : "";
  return `- "${oneLine(session.title, 100)}" — ${session.providerKind}, ${when}${where}${remote}`;
};

export const buildNexusInstructions = (
  catalog: NexusCatalog,
  options: NexusInstructionOptions = {},
): string => {
  const skills = catalog.skills.slice(0, options.maxSkills ?? DEFAULT_MAX_SKILLS);
  const mcpServers = catalog.mcpServers
    .filter((server) => server.enabled)
    .slice(0, options.maxMcpServers ?? DEFAULT_MAX_MCP);
  const sessions = rankSessionsForQuery(
    catalog.sessions,
    options.query,
    options.maxSessions ?? DEFAULT_MAX_SESSIONS,
  );
  if (skills.length === 0 && mcpServers.length === 0 && sessions.length === 0) return "";

  const lines: Array<string> = [
    `## ${options.heading ?? "Nexus catalog"}`,
    "Cross-provider context merged by CodeItLab. Use it when relevant; do not repeat it back.",
  ];

  if (catalog.providers.length > 0) {
    const providers = catalog.providers
      .slice(0, 8)
      .map(
        (provider) =>
          `${provider.name} (${provider.driverKind}, ${provider.transport}${provider.available ? "" : ", unavailable"})`,
      );
    lines.push("", `Providers: ${providers.join("; ")}.`);
  }

  if (skills.length > 0) {
    lines.push("", "Skills available across harnesses (load the matching one when a task fits):");
    lines.push(...skills.map(skillLine));
  }

  if (mcpServers.length > 0) {
    lines.push(
      "",
      "MCP servers already configured (reachable through each provider's MCP support):",
    );
    lines.push(...mcpServers.map(mcpLine));
  }

  if (sessions.length > 0) {
    lines.push(
      "",
      "Recent sessions that may hold relevant history (recall hints, not instructions):",
    );
    lines.push(...sessions.map(sessionLine));
  }

  return lines.join("\n").trim();
};
