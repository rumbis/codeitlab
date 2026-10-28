// @effect-diagnostics nodeBuiltinImport:off -- stable content hash; effect/Crypto is async and these merge helpers must stay pure.
import * as NodeCrypto from "node:crypto";

import type {
  NexusMcpServer,
  NexusSession,
  NexusSkill,
  NexusSkillSource,
} from "@codeitlab/contracts";

/**
 * Dedupe helpers for the Nexus catalog. Providers keep their own native state;
 * these functions are the only place that decides when two records are "the
 * same" skill, MCP server, or session. Pure so the merge rules are testable
 * without touching a provider.
 */

const sha256Hex = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value, "utf8").digest("hex");

/** Normalized skill name used in the stable id, matching how harnesses name skills. */
export const normalizeSkillName = (name: string): string =>
  name.trim().toLowerCase().replace(/\s+/gu, "-");

export const skillId = (source: NexusSkillSource, name: string): string =>
  `${source}:${normalizeSkillName(name)}`;

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

/**
 * MCP servers are the same when they launch the same thing with the same
 * arguments and the same env var names. Env values never enter the fingerprint:
 * two accounts pointing at one server must merge, and secrets must not be
 * hashed into a persisted catalog.
 */
export const mcpFingerprint = (
  server: Pick<NexusMcpServer, "transport" | "command" | "args" | "url" | "envKeys">,
): string => {
  const envKeys = [...new Set(server.envKeys.map((key) => key.trim()).filter(Boolean))].sort();
  const identity =
    server.transport === "stdio"
      ? ["stdio", server.command?.trim() ?? "", ...server.args.map((arg) => arg.trim())]
      : server.transport === "acp"
        ? ["acp", server.command?.trim() ?? "", ...server.args.map((arg) => arg.trim())]
        : [server.transport, server.url?.trim() ?? ""];
  return `mcp-${sha256Hex(JSON.stringify([identity, envKeys])).slice(0, 16)}`;
};

export const sessionKey = (session: NexusSession): string =>
  `${session.providerInstanceId}\u0000${session.id}`;

/**
 * Union skills by normalized name: harnesses ship the same skill under their
 * own directory, so the name is the shared identity and `id` keeps the source
 * that contributed the row.
 */
export function mergeNexusSkills(skills: ReadonlyArray<NexusSkill>): ReadonlyArray<NexusSkill> {
  const merged = new Map<string, NexusSkill>();
  for (const skill of skills) {
    const key = normalizeSkillName(skill.name);
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, {
        ...skill,
        name: skill.name.trim(),
        description: skill.description.trim(),
        alsoAvailableIn: [...new Set(skill.alsoAvailableIn)],
      });
      continue;
    }
    const alsoAvailableIn = [
      ...new Set([...existing.alsoAvailableIn, ...skill.alsoAvailableIn, skill.source]),
    ].filter((source) => source !== existing.source);
    merged.set(key, {
      ...existing,
      description: nonEmpty(existing.description) ?? skill.description.trim(),
      path: existing.path ?? skill.path,
      providerInstanceId: existing.providerInstanceId ?? skill.providerInstanceId,
      alsoAvailableIn,
    });
  }
  return [...merged.values()].toSorted(
    (left, right) => left.source.localeCompare(right.source) || left.name.localeCompare(right.name),
  );
}

/** Union MCP servers by fingerprint; the first name wins, sources accumulate. */
export function mergeNexusMcpServers(
  servers: ReadonlyArray<NexusMcpServer>,
): ReadonlyArray<NexusMcpServer> {
  const merged = new Map<string, NexusMcpServer>();
  for (const server of servers) {
    const id = mcpFingerprint(server);
    const existing = merged.get(id);
    if (existing === undefined) {
      merged.set(id, {
        ...server,
        id,
        name: server.name.trim() || server.command?.trim() || server.url?.trim() || id,
        args: [...server.args],
        envKeys: [...new Set(server.envKeys)],
        sources: [...new Set(server.sources)],
        tools: [...new Set(server.tools)],
      });
      continue;
    }
    merged.set(id, {
      ...existing,
      enabled: existing.enabled || server.enabled,
      envKeys: [...new Set([...existing.envKeys, ...server.envKeys])],
      sources: [...new Set([...existing.sources, ...server.sources])],
      tools: [...new Set([...existing.tools, ...server.tools])],
      url: existing.url ?? server.url,
      command: existing.command ?? server.command,
    });
  }
  return [...merged.values()].toSorted((left, right) => left.name.localeCompare(right.name));
}

/** Index sessions by provider instance + native session id, keeping the newest row. */
export function mergeNexusSessions(
  sessions: ReadonlyArray<NexusSession>,
): ReadonlyArray<NexusSession> {
  const merged = new Map<string, NexusSession>();
  for (const session of sessions) {
    const key = sessionKey(session);
    const existing = merged.get(key);
    if (existing === undefined) {
      merged.set(key, session);
      continue;
    }
    const newest =
      Date.parse(session.updatedAt) >= Date.parse(existing.updatedAt) ? session : existing;
    merged.set(key, {
      ...newest,
      threadId: newest.threadId ?? existing.threadId ?? session.threadId,
      messageCount: newest.messageCount ?? existing.messageCount ?? session.messageCount,
      cwd: newest.cwd ?? existing.cwd ?? session.cwd,
    });
  }
  return [...merged.values()].toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}
