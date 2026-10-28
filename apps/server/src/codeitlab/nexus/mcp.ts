import { NexusMcpServer } from "@codeitlab/contracts";
import { readAppManagedMcpServers } from "@codeitlab/shared/codeitlabMcp";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { parse as parseYaml } from "yaml";

import { mcpFingerprint } from "./fingerprint.ts";
import type { NexusSourceResult } from "./skills.ts";

const MAX_CONFIG_BYTES = 1024 * 1024;
const MAX_MCP_SERVERS = 256;

const trimToUndefined = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
};

const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const envKeysOf = (value: unknown): ReadonlyArray<string> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : [];

function normalizeMcpServer(input: {
  readonly name: string;
  readonly command?: unknown;
  readonly args?: unknown;
  readonly env?: unknown;
  readonly url?: unknown;
  readonly transport?: unknown;
  readonly enabled?: unknown;
  readonly tools?: unknown;
  readonly sources: ReadonlyArray<string>;
}): NexusMcpServer | undefined {
  const command = trimToUndefined(input.command);
  const url = trimToUndefined(input.url);
  const transport =
    trimToUndefined(input.transport) === "sse" || trimToUndefined(input.transport) === "http"
      ? (trimToUndefined(input.transport) as "http" | "sse")
      : url !== undefined
        ? "http"
        : command !== undefined
          ? "stdio"
          : undefined;
  if (transport === undefined || (transport === "stdio" && command === undefined)) {
    return undefined;
  }
  const candidate = {
    id: "pending",
    name: input.name.trim() || command || url || "mcp",
    transport,
    ...(command !== undefined ? { command } : {}),
    args: [...stringArray(input.args)],
    ...(url !== undefined ? { url } : {}),
    envKeys: [...envKeysOf(input.env)],
    sources: [...input.sources],
    enabled: input.enabled !== false,
    tools: [...stringArray(input.tools)],
  } satisfies NexusMcpServer;
  return { ...candidate, id: mcpFingerprint(candidate) };
}

const readTextIfPresent = Effect.fn("Nexus.readMcpConfigFile")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const stat = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => undefined));
  if (stat === undefined || stat.type !== "File" || Number(stat.size) > MAX_CONFIG_BYTES) {
    return undefined;
  }
  return yield* fs.readFileString(filePath).pipe(Effect.orElseSucceed(() => undefined));
});

export const parseClaudeMcpConfig = (
  contents: string,
  sources: ReadonlyArray<string>,
): ReadonlyArray<NexusMcpServer> => {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(contents);
    } catch {
      return undefined;
    }
  })();
  if (parsed === null || typeof parsed !== "object") return [];
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (servers === null || typeof servers !== "object") return [];
  return Object.entries(servers as Record<string, unknown>).flatMap(([name, entry]) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const server = normalizeMcpServer({
      name,
      command: record.command,
      args: record.args,
      env: record.env,
      url: record.url ?? record.serverUrl,
      transport: record.type,
      enabled: (record.enabled ?? record.disabled === undefined) ? undefined : !record.disabled,
      tools: record.tools,
      sources,
    });
    return server === undefined ? [] : [server];
  });
};

export const parseHermesMcpConfig = (
  contents: string,
  sources: ReadonlyArray<string>,
): ReadonlyArray<NexusMcpServer> => {
  const parsed: unknown = (() => {
    try {
      return parseYaml(contents);
    } catch {
      return undefined;
    }
  })();
  if (parsed === null || typeof parsed !== "object") return [];
  const servers = (parsed as { mcp_servers?: unknown }).mcp_servers;
  if (servers === null || typeof servers !== "object") return [];
  return Object.entries(servers as Record<string, unknown>).flatMap(([name, entry]) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const include = (record.tools as { include?: unknown } | undefined)?.include;
    const server = normalizeMcpServer({
      name,
      command: record.command,
      args: record.args,
      env: record.env,
      url: record.url,
      enabled: record.enabled,
      tools: include,
      sources,
    });
    return server === undefined ? [] : [server];
  });
};

const parseTomlScalar = (raw: string): unknown => {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1);
    return [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/gu)].map((match) =>
      (match[1] ?? "").replace(/\\"/gu, '"'),
    );
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/gu, '"');
  }
  if (value === "true" || value === "false") return value === "true";
  return undefined;
};

/** Minimal `[mcp_servers.<name>]` reader; Codex has no JSON config and TOML is overkill here. */
export const parseCodexMcpConfig = (
  contents: string,
  sources: ReadonlyArray<string>,
): ReadonlyArray<NexusMcpServer> => {
  interface Section {
    readonly name: string;
    readonly fields: Record<string, unknown>;
    readonly envKeys: Array<string>;
  }
  const sections = new Map<string, Section>();
  let current: Section | undefined;
  let inEnv = false;
  for (const line of contents.split(/\r?\n/u)) {
    const header = /^\[([^\]]+)\]\s*$/u.exec(line.trim());
    if (header !== null) {
      const parts = (header[1] ?? "").split(".");
      inEnv = parts[0] === "mcp_servers" && parts.length === 3 && parts[2] === "env";
      current =
        parts[0] === "mcp_servers" && parts[1] !== undefined
          ? (sections.get(parts[1]) ?? {
              name: parts[1],
              fields: {},
              envKeys: [],
            })
          : undefined;
      if (current !== undefined) sections.set(parts[1]!, current);
      continue;
    }
    if (current === undefined) continue;
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(line.trim());
    if (assignment === null) continue;
    const [, key, rawValue] = assignment;
    if (key === undefined || rawValue === undefined) continue;
    if (inEnv) {
      current.envKeys.push(key);
      continue;
    }
    const value = parseTomlScalar(rawValue);
    if (value !== undefined) current.fields[key] = value;
  }
  return [...sections.values()].flatMap((section) => {
    const server = normalizeMcpServer({
      name: section.name,
      command: section.fields.command,
      args: section.fields.args,
      env: Object.fromEntries(section.envKeys.map((key) => [key, ""])),
      url: section.fields.url,
      enabled: section.fields.enabled,
      sources,
    });
    return server === undefined ? [] : [server];
  });
};

export const parseOpenCodeMcpConfig = (
  contents: string,
  sources: ReadonlyArray<string>,
): ReadonlyArray<NexusMcpServer> => {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(contents);
    } catch {
      return undefined;
    }
  })();
  if (parsed === null || typeof parsed !== "object") return [];
  const servers = (parsed as { mcp?: unknown }).mcp;
  if (servers === null || typeof servers !== "object") return [];
  return Object.entries(servers as Record<string, unknown>).flatMap(([name, entry]) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const command = Array.isArray(record.command) ? record.command[0] : record.command;
    const args = Array.isArray(record.command) ? record.command.slice(1) : record.args;
    const server = normalizeMcpServer({
      name,
      command,
      args,
      env: record.environment,
      url: record.url,
      enabled: record.enabled,
      sources,
    });
    return server === undefined ? [] : [server];
  });
};

export const readNexusMcpServers = Effect.fn("Nexus.readNexusMcpServers")(function* (input: {
  readonly homeDir: string;
  readonly appMcpDir: string;
}) {
  const items: Array<NexusMcpServer> = [];
  const warnings: Array<string> = [];
  const readConfig = (filePath: string) => readTextIfPresent(filePath);

  const hermes = yield* readConfig(`${input.homeDir}/.hermes/config.yaml`);
  if (hermes !== undefined) {
    items.push(...parseHermesMcpConfig(hermes, ["hermes"]));
  }
  const claude = yield* readConfig(`${input.homeDir}/.claude.json`);
  if (claude !== undefined) {
    items.push(...parseClaudeMcpConfig(claude, ["claude"]));
  }
  const codex = yield* readConfig(`${input.homeDir}/.codex/config.toml`);
  if (codex !== undefined) {
    items.push(...parseCodexMcpConfig(codex, ["codex"]));
  }
  const opencode = yield* readConfig(`${input.homeDir}/.config/opencode/opencode.json`);
  if (opencode !== undefined) {
    items.push(...parseOpenCodeMcpConfig(opencode, ["opencode"]));
  }

  // App-managed servers (REA, Graft, future CodeItLab toolkits) are written by
  // the services that own them; the parser is shared with the ACP injection
  // path so both read the same two registration shapes.
  const appManaged = yield* readAppManagedMcpServers({ directory: input.appMcpDir });
  items.push(...appManaged.servers.map((entry) => entry.server));
  warnings.push(...appManaged.warnings);

  return {
    items: items.slice(0, MAX_MCP_SERVERS),
    warnings,
  } satisfies NexusSourceResult<NexusMcpServer>;
});
