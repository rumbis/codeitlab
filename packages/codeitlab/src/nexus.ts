import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The unified ACP catalog ("Nexus"): one merged view of the skills, sessions and
 * MCP servers every configured harness exposes. Providers keep their own native
 * state; Nexus only ingests, dedupes and indexes it.
 */

export const NexusSkillSource = Schema.Literals([
  "hermes",
  "claude",
  "codex",
  "cursor",
  "opencode",
  "acp-registry",
  "codeitlab",
  "filesystem",
]);
export type NexusSkillSource = typeof NexusSkillSource.Type;

export const NexusSkill = Schema.Struct({
  /** Stable fingerprint: `<source>:<name>`. */
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  source: NexusSkillSource,
  /** Provider instance that supplied it, when applicable. */
  providerInstanceId: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  /** Union-merged skills keep every contributing source. */
  alsoAvailableIn: Schema.Array(NexusSkillSource).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type NexusSkill = typeof NexusSkill.Type;

export const NexusMcpTransport = Schema.Literals(["stdio", "http", "sse", "acp"]);
export type NexusMcpTransport = typeof NexusMcpTransport.Type;

export const NexusMcpServer = Schema.Struct({
  /** Dedupe fingerprint over command + args + env keys. */
  id: Schema.String,
  name: Schema.String,
  transport: NexusMcpTransport,
  command: Schema.optional(Schema.String),
  args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  url: Schema.optional(Schema.String),
  /** Env var names only; values never leave the server. */
  envKeys: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  sources: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Tools discovered from the server, when it was probed. */
  tools: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type NexusMcpServer = typeof NexusMcpServer.Type;

export const NexusSession = Schema.Struct({
  id: Schema.String,
  providerInstanceId: Schema.String,
  providerKind: Schema.String,
  title: Schema.String,
  updatedAt: Schema.String,
  cwd: Schema.optional(Schema.String),
  messageCount: Schema.optional(Schema.Number),
  /** Thread id when the session is already imported into CodeItLab. */
  threadId: Schema.optional(Schema.String),
  remote: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type NexusSession = typeof NexusSession.Type;

export const NexusProviderSummary = Schema.Struct({
  instanceId: Schema.String,
  driverKind: Schema.String,
  name: Schema.String,
  transport: Schema.Literals(["local", "ssh", "tailscale"]),
  available: Schema.Boolean,
  skills: Schema.Number,
  sessions: Schema.Number,
  mcpServers: Schema.Number,
  detail: Schema.optional(Schema.String),
});
export type NexusProviderSummary = typeof NexusProviderSummary.Type;

export const NexusCatalog = Schema.Struct({
  generatedAt: Schema.String,
  providers: Schema.Array(NexusProviderSummary).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  skills: Schema.Array(NexusSkill).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  mcpServers: Schema.Array(NexusMcpServer).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  sessions: Schema.Array(NexusSession).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  warnings: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type NexusCatalog = typeof NexusCatalog.Type;
