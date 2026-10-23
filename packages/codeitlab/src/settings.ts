import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CodeitlabEcosystemSettings } from "./ecosystem.ts";
import { CodeitlabStudioSettings } from "./studio.ts";
import { CodeitlabIntegrationsSettings } from "./integrations.ts";
import { CodeitlabCredentialsSettings } from "./credentials.ts";

/**
 * CodeitLab settings live under a single `codeitlab` key in ServerSettings so
 * every feature's configuration lands in one schema and one patch. Each block
 * owns its own defaults; the whole struct must decode from `{}`.
 */

export const CodeitlabSchemaVersion = Schema.Literal(1);
export type CodeitlabSchemaVersion = typeof CodeitlabSchemaVersion.Type;

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const NumberDefault = (value: number) =>
  Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const TrimmedStringDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const StringArrayDefault = (value: ReadonlyArray<string>) =>
  Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([...value])));

// ---------------------------------------------------------------------------
// Effects (3D + SFX)
// ---------------------------------------------------------------------------

export const CodeitlabEffectsQuality = Schema.Literals(["off", "low", "medium", "high"]);
export type CodeitlabEffectsQuality = typeof CodeitlabEffectsQuality.Type;

export const CodeitlabSfxEventSettings = Schema.Struct({
  click: BooleanDefault(true),
  send: BooleanDefault(true),
  success: BooleanDefault(true),
  error: BooleanDefault(true),
  ambient: BooleanDefault(false),
});
export type CodeitlabSfxEventSettings = typeof CodeitlabSfxEventSettings.Type;

export const CodeitlabEffectsSettings = Schema.Struct({
  /** 3D ambient scenes. `off` is authoritative and overrides quality. */
  threeD: CodeitlabEffectsQuality.pipe(
    Schema.withDecodingDefault(Effect.succeed("medium" as const)),
  ),
  /** Honour the OS reduced-motion setting in addition to the user's choice. */
  respectReducedMotion: BooleanDefault(true),
  /** Cap the 3D render loop; the scene is throttled, never free-running. */
  maxFps: NumberDefault(30),
  sfxEnabled: BooleanDefault(true),
  sfxVolume: NumberDefault(0.35),
  sfxEvents: CodeitlabSfxEventSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeitlabEffectsSettings = typeof CodeitlabEffectsSettings.Type;

// ---------------------------------------------------------------------------
// Nexus (unified ACP: skills + sessions + MCP)
// ---------------------------------------------------------------------------

export const CodeitlabAcpTransport = Schema.Literals(["local", "ssh", "tailscale"]);
export type CodeitlabAcpTransport = typeof CodeitlabAcpTransport.Type;

export const CodeitlabCustomAcpAgent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  env: Schema.Record(Schema.String, Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  transport: CodeitlabAcpTransport.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const)),
  ),
  /** SSH host alias or tailnet hostname for remote transports. */
  host: Schema.optional(Schema.String),
  enabled: BooleanDefault(true),
});
export type CodeitlabCustomAcpAgent = typeof CodeitlabCustomAcpAgent.Type;

export const CodeitlabNexusSettings = Schema.Struct({
  enabled: BooleanDefault(true),
  /** Ingest skills from every configured harness. */
  includeSkills: BooleanDefault(true),
  includeSessions: BooleanDefault(true),
  includeMcp: BooleanDefault(true),
  /**
   * Inject the app-managed MCP registrations (Graft, REA) into ACP sessions so
   * the ecosystem tools are callable without the user asking for them.
   */
  injectMcp: BooleanDefault(true),
  /** Inject the merged catalog summary into every turn automatically. */
  autoInject: BooleanDefault(true),
  refreshIntervalMins: NumberDefault(15),
  customAcpAgents: Schema.Array(CodeitlabCustomAcpAgent).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type CodeitlabNexusSettings = typeof CodeitlabNexusSettings.Type;

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export const CodeitlabMemoryScope = Schema.Literals(["global", "project"]);
export type CodeitlabMemoryScope = typeof CodeitlabMemoryScope.Type;

export const CodeitlabMemorySettings = Schema.Struct({
  enabled: BooleanDefault(true),
  defaultScope: CodeitlabMemoryScope.pipe(
    Schema.withDecodingDefault(Effect.succeed("project" as const)),
  ),
  /** Extract durable facts after a turn finishes. */
  autoExtract: BooleanDefault(true),
  /** Recall relevant memories and inject them into the next turn. */
  autoRecall: BooleanDefault(true),
  maxEntries: NumberDefault(5000),
  retrievalTopK: NumberDefault(8),
  /** Minimum score for a recall hit to be injected. */
  minScore: NumberDefault(0.2),
});
export type CodeitlabMemorySettings = typeof CodeitlabMemorySettings.Type;

// ---------------------------------------------------------------------------
// Routing (OmniRoute-style multi-provider auto route)
// ---------------------------------------------------------------------------

export const CodeitlabRoutingMode = Schema.Literals(["manual", "auto", "omniroute"]);
export type CodeitlabRoutingMode = typeof CodeitlabRoutingMode.Type;

export const CodeitlabRoutingWeights = Schema.Struct({
  quota: NumberDefault(0.35),
  smartness: NumberDefault(0.4),
  speed: NumberDefault(0.25),
});
export type CodeitlabRoutingWeights = typeof CodeitlabRoutingWeights.Type;

export const CodeitlabOmniRouteSettings = Schema.Struct({
  enabled: BooleanDefault(false),
  baseUrl: TrimmedStringDefault("http://127.0.0.1:20128"),
  apiKeyEnv: TrimmedStringDefault("CODEITLAB_OMNIROUTE_API_KEY"),
  /** Virtual auto models the router exposes, e.g. `auto/best-coding`. */
  virtualModels: StringArrayDefault([
    "auto/best-coding",
    "auto/best-reasoning",
    "auto/best-fast",
    "auto/best-vision",
    "auto/best-chat",
    "auto/cheap",
  ]),
});
export type CodeitlabOmniRouteSettings = typeof CodeitlabOmniRouteSettings.Type;

/**
 * How strongly OmniRoute's decision is applied to a turn.
 * - `off`: describe only, never switch.
 * - `prefer`: switch when the thread has no pinned model (its model is the
 *   provider's default); keep an explicit user choice.
 * - `force`: switch even over an explicit per-thread model choice.
 * `/compact` turns and unavailable providers/models are never overridden.
 */
export const CodeitlabRoutingEnforcement = Schema.Literals(["off", "prefer", "force"]);
export type CodeitlabRoutingEnforcement = typeof CodeitlabRoutingEnforcement.Type;

export const CodeitlabRoutingSettings = Schema.Struct({
  /**
   * `auto` is the CodeitLab default: every turn is classified and routed to the
   * best provider/model that the quota health check says is usable. Users who
   * prefer to pick by hand switch to `manual`.
   */
  mode: CodeitlabRoutingMode.pipe(Schema.withDecodingDefault(Effect.succeed("auto" as const))),
  enforcement: CodeitlabRoutingEnforcement.pipe(
    Schema.withDecodingDefault(Effect.succeed("prefer" as const)),
  ),
  weights: CodeitlabRoutingWeights.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** Provider instance ids in the user's preference order. */
  providerOrder: StringArrayDefault([]),
  allowFallback: BooleanDefault(true),
  recordHistory: BooleanDefault(true),
  /**
   * Pick the model that fits each classified task inside the winning provider
   * (fastest for `fast`, smartest for `coding`/`reasoning`) instead of always
   * using the provider's default model.
   */
  routePerTask: BooleanDefault(true),
  /** Minutes between background provider/quota probes; 0 disables them. */
  healthCheckMinutes: NumberDefault(30),
  /**
   * Send a tiny "hi" turn to each candidate model on every probe and use the
   * measured latency as the router's speed signal. Failing models are retried
   * automatically on the next probe (and once immediately).
   */
  speedProbe: BooleanDefault(true),
  /** How many models per provider the speed probe measures (1–10). */
  speedProbeModelsPerProvider: NumberDefault(3),
  /**
   * Automatic provider fallback: when a turn fails with a provider error
   * (auth, quota, HTTP 4xx/5xx, transport), CodeitLab skips that provider for
   * new auto-routed turns for a while and routes them to the backup provider.
   */
  fallbackOnProviderFailure: BooleanDefault(true),
  /** Backup provider instance id; empty = first healthy enabled instance. */
  fallbackInstanceId: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** Backup model; empty = the backup provider's default/seed model. */
  fallbackModel: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** How long a provider stays skipped after a failed turn (minutes). */
  providerFailureCooldownMinutes: NumberDefault(10),
  omniRoute: CodeitlabOmniRouteSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeitlabRoutingSettings = typeof CodeitlabRoutingSettings.Type;

// ---------------------------------------------------------------------------
// Policy (uncensored mode)
// ---------------------------------------------------------------------------

export const CodeitlabPolicySettings = Schema.Struct({
  /**
   * Replaces CodeitLab's own conservative instruction scaffolding with a
   * permissive profile. It cannot change an upstream provider's policy.
   */
  uncensored: BooleanDefault(false),
  /** Provider instance ids the profile applies to; empty means all. */
  applyToProviders: StringArrayDefault([]),
  /** Record which turns ran under the permissive profile. */
  auditTrail: BooleanDefault(true),
});
export type CodeitlabPolicySettings = typeof CodeitlabPolicySettings.Type;

// ---------------------------------------------------------------------------
// REA (reverse engineer anything) — always on
// ---------------------------------------------------------------------------

export const CodeitlabReaSettings = Schema.Struct({
  enabled: BooleanDefault(true),
  /** Agents reach for REA on analysis tasks without the user asking. */
  autoActivate: BooleanDefault(true),
  mcpCommand: TrimmedStringDefault("npx"),
  mcpArgs: StringArrayDefault(["-y", "rea-agents@6.7.0", "--mcp"]),
  /** Seed the bundled REA skill into the app-managed skills directory. */
  installSkill: BooleanDefault(true),
});
export type CodeitlabReaSettings = typeof CodeitlabReaSettings.Type;

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export const CodeitlabSettings = Schema.Struct({
  schemaVersion: CodeitlabSchemaVersion.pipe(
    Schema.withDecodingDefault(Effect.succeed(1 as const)),
  ),
  effects: CodeitlabEffectsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  nexus: CodeitlabNexusSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  memory: CodeitlabMemorySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  routing: CodeitlabRoutingSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  policy: CodeitlabPolicySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  rea: CodeitlabReaSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  ecosystem: CodeitlabEcosystemSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  studio: CodeitlabStudioSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  integrations: CodeitlabIntegrationsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  credentials: CodeitlabCredentialsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeitlabSettings = typeof CodeitlabSettings.Type;

export const DEFAULT_CODEITLAB_SETTINGS: CodeitlabSettings = Schema.decodeSync(CodeitlabSettings)(
  {},
);
