import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";

import { NexusMcpServer } from "@t3tools/contracts";

/**
 * Reader for the app-managed MCP registrations CodeitLab writes under
 * `<stateDir>/codeitlab/mcp/*.json`.
 *
 * Two shapes exist in the wild and both are accepted:
 * - a single `NexusMcpServer` (REA writes this), and
 * - `{ mcpServers: { <id>: { command, args, env, transport, source, version } } }`
 *   (the ecosystem installer writes this so one file can carry several servers).
 *
 * The reader lives in `@t3tools/shared` because both the Nexus catalog
 * (ingestion/dedupe) and the ACP runtime (injecting the servers into a session)
 * must agree on the parse. It is read-only: the services that write these files
 * own them.
 */

const MAX_REGISTRATION_BYTES = 256 * 1024;
const MAX_REGISTRATION_FILES = 32;

export interface AppManagedMcpServer {
  readonly server: NexusMcpServer;
  /** Env *values* are needed to spawn the server; the catalog only stores keys. */
  readonly env: Readonly<Record<string, string>>;
}

export interface AppManagedMcpReadResult {
  readonly servers: ReadonlyArray<AppManagedMcpServer>;
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Canonical identity for dedupe: transport + command/url + args + env key names.
 * Kept hash-free so it is safe in browser-adjacent shared code; the Nexus
 * catalog hashes the same fields for its persisted ids.
 */
export const mcpServerIdentity = (server: {
  readonly transport: string;
  readonly command?: string | undefined;
  readonly args: ReadonlyArray<string>;
  readonly url?: string | undefined;
  readonly envKeys: ReadonlyArray<string>;
}): string => {
  const envKeys = [...new Set(server.envKeys.map((key) => key.trim()).filter(Boolean))].sort();
  const identity =
    server.transport === "stdio" || server.transport === "acp"
      ? [server.transport, server.command?.trim() ?? "", ...server.args.map((arg) => arg.trim())]
      : [server.transport, server.url?.trim() ?? ""];
  return JSON.stringify([identity, envKeys]);
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

const stringArray = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const envRecord = (value: unknown): Readonly<Record<string, string>> => {
  const record = asRecord(value);
  if (record === undefined) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
};

const normalizeTransport = (value: unknown): NexusMcpServer["transport"] | undefined => {
  if (value === "stdio" || value === "http" || value === "sse" || value === "acp") return value;
  return undefined;
};

const decodeNexusServer = Schema.decodeUnknownOption(NexusMcpServer);

const fromSingleServer = (parsed: unknown): ReadonlyArray<AppManagedMcpServer> => {
  const decoded = decodeNexusServer(parsed);
  return decoded._tag === "Some" ? [{ server: decoded.value, env: {} }] : [];
};

const fromEnvelope = (
  mcpServers: Readonly<Record<string, unknown>>,
): ReadonlyArray<AppManagedMcpServer> => {
  const servers: Array<AppManagedMcpServer> = [];
  for (const [id, rawEntry] of Object.entries(mcpServers)) {
    const entry = asRecord(rawEntry);
    if (entry === undefined) continue;
    const command = typeof entry.command === "string" ? entry.command.trim() : undefined;
    const url = typeof entry.url === "string" ? entry.url.trim() : undefined;
    const transport = normalizeTransport(entry.transport) ?? (url !== undefined ? "http" : "stdio");
    if (transport === "stdio" && (command === undefined || command.length === 0)) continue;
    const env = envRecord(entry.env);
    const candidate = {
      id: mcpServerIdentity({
        transport,
        command,
        args: stringArray(entry.args),
        url,
        envKeys: Object.keys(env),
      }),
      name: typeof entry.name === "string" && entry.name.trim().length > 0 ? entry.name.trim() : id,
      transport,
      ...(command === undefined ? {} : { command }),
      args: stringArray(entry.args),
      ...(url === undefined ? {} : { url }),
      envKeys: Object.keys(env),
      sources:
        typeof entry.source === "string" && entry.source.trim().length > 0
          ? [entry.source.trim()]
          : ["codeitlab"],
      enabled: entry.enabled !== false,
      tools: stringArray(entry.tools),
    };
    const decoded = decodeNexusServer(candidate);
    if (decoded._tag === "Some") servers.push({ server: decoded.value, env });
  }
  return servers;
};

/** Parse one registration document; tolerant so one bad file never hides the others. */
export const decodeAppManagedMcpDocument = (
  contents: string,
): { readonly servers: ReadonlyArray<AppManagedMcpServer>; readonly warning?: string } => {
  const parsed: unknown = (() => {
    try {
      return JSON.parse(contents);
    } catch {
      return undefined;
    }
  })();
  if (parsed === undefined) return { servers: [], warning: "not valid JSON" };
  const envelope = asRecord(asRecord(parsed)?.mcpServers);
  if (envelope !== undefined) return { servers: fromEnvelope(envelope) };
  const single = fromSingleServer(parsed);
  return single.length > 0
    ? { servers: single }
    : { servers: [], warning: "not a Nexus MCP server" };
};

export const appManagedMcpDirectory = (stateDir: string): string =>
  `${stateDir.replace(/[\\/]+$/u, "")}/codeitlab/mcp`;

/** Resolve a command the way a shell would, so a missing binary is a warning not a spawn failure. */
export const commandIsAvailable = (
  command: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<boolean, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (command.includes("/") || command.includes("\\")) {
      return yield* fs.exists(command).pipe(Effect.orElseSucceed(() => false));
    }
    const pathValue = environment.PATH ?? environment.Path ?? "";
    const separator = pathValue.includes(";") ? ";" : ":";
    const directories = pathValue.split(separator).filter((entry) => entry.length > 0);
    // Windows resolves bare names through PATHEXT; checking the common suffixes is enough here.
    const candidates = pathValue.includes(";")
      ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
      : [command];
    for (const directory of directories) {
      for (const candidate of candidates) {
        const exists = yield* fs
          .exists(`${directory.replace(/[\\/]+$/u, "")}/${candidate}`)
          .pipe(Effect.orElseSucceed(() => false));
        if (exists) return true;
      }
    }
    return false;
  });

/** Read every `*.json` registration in the app-managed MCP directory. */
export const readAppManagedMcpServers = (input: {
  readonly directory: string;
}): Effect.Effect<AppManagedMcpReadResult, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const servers: Array<AppManagedMcpServer> = [];
    const warnings: Array<string> = [];
    const entries = yield* fs
      .readDirectory(input.directory)
      .pipe(Effect.orElseSucceed((): Array<string> => []));
    for (const entry of entries.toSorted().slice(0, MAX_REGISTRATION_FILES)) {
      if (!entry.endsWith(".json") || entry.startsWith(".")) continue;
      const filePath = `${input.directory}/${entry}`;
      const stat = yield* fs.stat(filePath).pipe(Effect.orElseSucceed(() => undefined));
      if (
        stat === undefined ||
        stat.type !== "File" ||
        Number(stat.size) > MAX_REGISTRATION_BYTES
      ) {
        warnings.push(`Skipped app-managed MCP registration ${entry}: unreadable or too large.`);
        continue;
      }
      const contents = yield* fs
        .readFileString(filePath)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (contents === undefined) {
        warnings.push(`Skipped app-managed MCP registration ${entry}: unreadable.`);
        continue;
      }
      const decoded = decodeAppManagedMcpDocument(contents);
      if (decoded.warning !== undefined) {
        warnings.push(`Ignored app-managed MCP registration ${entry}: ${decoded.warning}.`);
        continue;
      }
      servers.push(...decoded.servers);
    }
    return { servers, warnings };
  });
