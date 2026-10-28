import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CodeItLabMarketplaceSettings } from "./engagements.ts";
import { CodeItLabXpSettings } from "./xp.ts";
import { TaskClass } from "./routing.ts";
import { CodeItLabEcosystemSettings } from "./ecosystem.ts";
import { CodeItLabStudioSettings } from "./studio.ts";
import { CodeItLabIntegrationsSettings } from "./integrations.ts";
import { CodeItLabCredentialsSettings } from "./credentials.ts";
import { CodeItLabBoardSettings } from "./board.ts";
import { CodeItLabBotsSettings } from "./bots.ts";
import { CodeItLabBudgetSettings } from "./budget.ts";
import { CodeItLabContextSettings } from "./context.ts";
import { CodeItLabIssuesSettings } from "./issues.ts";
import { CodeItLabWallpaperSettings } from "./wallpaper.ts";
import { CodeItLabSketchSettings } from "./sketch.ts";
import { CodeItLabMoodBoardsSettings } from "./moodboard.ts";
import { CodeItLabDeploySettings } from "./deploy.ts";
import { CodeItLabTeamSettings } from "./team.ts";
import { CodeItLabProfileSettings } from "./profile.ts";
import { CodeItLabProgressSettings } from "./progress.ts";
import { CodeItLabModelsSettings } from "./models.ts";

/**
 * CodeItLab settings live under a single `codeitlab` key in ServerSettings so
 * every feature's configuration lands in one schema and one patch. Each block
 * owns its own defaults; the whole struct must decode from `{}`.
 */

export const CodeItLabSchemaVersion = Schema.Literal(1);
export type CodeItLabSchemaVersion = typeof CodeItLabSchemaVersion.Type;

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const NumberDefault = (value: number) =>
  Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const TrimmedStringDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const StringArrayDefault = (value: ReadonlyArray<string>) =>
  Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([...value])));

// Effects (3D + SFX)

export const CodeItLabEffectsQuality = Schema.Literals(["off", "low", "medium", "high"]);
export type CodeItLabEffectsQuality = typeof CodeItLabEffectsQuality.Type;

export const CodeItLabSfxEventSettings = Schema.Struct({
  click: BooleanDefault(true),
  send: BooleanDefault(true),
  success: BooleanDefault(true),
  error: BooleanDefault(true),
  ambient: BooleanDefault(false),
});
export type CodeItLabSfxEventSettings = typeof CodeItLabSfxEventSettings.Type;

export const CodeItLabEffectsSettings = Schema.Struct({
  /** 3D ambient scenes. `off` is authoritative and overrides quality. */
  threeD: CodeItLabEffectsQuality.pipe(
    Schema.withDecodingDefault(Effect.succeed("medium" as const)),
  ),
  /** Honour the OS reduced-motion setting in addition to the user's choice. */
  respectReducedMotion: BooleanDefault(true),
  /** Cap the 3D render loop; the scene is throttled, never free-running. */
  maxFps: NumberDefault(30),
  /** Off until the user asks for it: UI.md says silence is the default state. */
  sfxEnabled: BooleanDefault(false),
  sfxVolume: NumberDefault(0.35),
  sfxEvents: CodeItLabSfxEventSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeItLabEffectsSettings = typeof CodeItLabEffectsSettings.Type;

// Nexus (unified ACP: skills + sessions + MCP)

export const CodeItLabAcpTransport = Schema.Literals(["local", "ssh", "tailscale"]);
export type CodeItLabAcpTransport = typeof CodeItLabAcpTransport.Type;

export const CodeItLabCustomAcpAgent = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  command: Schema.String,
  args: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  env: Schema.Record(Schema.String, Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
  transport: CodeItLabAcpTransport.pipe(
    Schema.withDecodingDefault(Effect.succeed("local" as const)),
  ),
  /** SSH host alias or tailnet hostname for remote transports. */
  host: Schema.optional(Schema.String),
  enabled: BooleanDefault(true),
});
export type CodeItLabCustomAcpAgent = typeof CodeItLabCustomAcpAgent.Type;

export const CodeItLabNexusSettings = Schema.Struct({
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
  customAcpAgents: Schema.Array(CodeItLabCustomAcpAgent).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type CodeItLabNexusSettings = typeof CodeItLabNexusSettings.Type;

// Memory

export const CodeItLabMemoryScope = Schema.Literals(["global", "project"]);
export type CodeItLabMemoryScope = typeof CodeItLabMemoryScope.Type;

export const CodeItLabMemorySettings = Schema.Struct({
  enabled: BooleanDefault(true),
  defaultScope: CodeItLabMemoryScope.pipe(
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
export type CodeItLabMemorySettings = typeof CodeItLabMemorySettings.Type;

// Routing (OmniRoute-style multi-provider auto route)

export const CodeItLabRoutingMode = Schema.Literals(["manual", "auto", "omniroute"]);
export type CodeItLabRoutingMode = typeof CodeItLabRoutingMode.Type;

export const CodeItLabRoutingWeights = Schema.Struct({
  quota: NumberDefault(0.35),
  smartness: NumberDefault(0.4),
  speed: NumberDefault(0.25),
});
export type CodeItLabRoutingWeights = typeof CodeItLabRoutingWeights.Type;

/**
 * A per-task pin. The user says "coding turns always run on this model", and the
 * router stops scoring that task class instead of second-guessing the choice.
 * An override still respects a thread that already pinned its own model.
 */
export const CodeItLabRoutingTaskOverride = Schema.Struct({
  taskClass: TaskClass,
  providerInstanceId: Schema.String,
  model: Schema.String,
});
export type CodeItLabRoutingTaskOverride = typeof CodeItLabRoutingTaskOverride.Type;

export const CodeItLabOmniRouteSettings = Schema.Struct({
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
export type CodeItLabOmniRouteSettings = typeof CodeItLabOmniRouteSettings.Type;

/**
 * How strongly OmniRoute's decision is applied to a turn.
 * - `off`: describe only, never switch.
 * - `prefer`: switch when the thread has no pinned model (its model is the
 *   provider's default); keep an explicit user choice.
 * - `force`: switch even over an explicit per-thread model choice.
 * `/compact` turns and unavailable providers/models are never overridden.
 */
export const CodeItLabRoutingEnforcement = Schema.Literals(["off", "prefer", "force"]);
export type CodeItLabRoutingEnforcement = typeof CodeItLabRoutingEnforcement.Type;

export const CodeItLabRoutingSettings = Schema.Struct({
  /**
   * `auto` is the CodeItLab default: every turn is classified and routed to the
   * best provider/model that the quota health check says is usable. Users who
   * prefer to pick by hand switch to `manual`.
   */
  mode: CodeItLabRoutingMode.pipe(Schema.withDecodingDefault(Effect.succeed("auto" as const))),
  /**
   * `prefer` (the default) only routes the Auto router selection: a concrete
   * model the picker shows is the model the turn runs. `force` also replaces a
   * concrete/pinned selection; `off` disables routing for concrete selections
   * (the sentinel still routes).
   */
  enforcement: CodeItLabRoutingEnforcement.pipe(
    Schema.withDecodingDefault(Effect.succeed("prefer" as const)),
  ),
  weights: CodeItLabRoutingWeights.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
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
  /** Pinned model per task class; the router honors these before scoring. */
  taskOverrides: Schema.Array(CodeItLabRoutingTaskOverride).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  /**
   * Provider kinds that route with their own router (a gateway's auto mode).
   * The app then stops scoring their models and reports the provider's choice
   * instead of duplicating it.
   */
  delegatedProviderKinds: StringArrayDefault([]),
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
   * Deep scan: on the first run (and whenever the provider's model list
   * changes) measure every model a gateway advertises — availability and real
   * "hi" latency — instead of only the few candidates the light probe picks.
   * A gateway like Hermes can advertise thousands of custom models; the router
   * must know which of them actually answer before it can rank them per task.
   */
  deepScan: BooleanDefault(true),
  /** Parallel "hi" probes during a deep scan (1–16). */
  deepScanConcurrency: NumberDefault(8),
  /** Per-model timeout for a deep-scan probe, in seconds (5–60). */
  deepScanTimeoutSeconds: NumberDefault(12),
  /**
   * Automatic provider fallback: when a turn fails with a provider error
   * (auth, quota, HTTP 4xx/5xx, transport), CodeItLab skips that provider for
   * new auto-routed turns for a while and routes them to the backup provider.
   */
  fallbackOnProviderFailure: BooleanDefault(true),
  /** Backup provider instance id; empty = first healthy enabled instance. */
  fallbackInstanceId: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** Backup model; empty = the backup provider's default/seed model. */
  fallbackModel: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** How long a provider stays skipped after a failed turn (minutes). */
  providerFailureCooldownMinutes: NumberDefault(10),
  omniRoute: CodeItLabOmniRouteSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeItLabRoutingSettings = typeof CodeItLabRoutingSettings.Type;

// Policy (uncensored mode)

export const CodeItLabPolicySettings = Schema.Struct({
  /**
   * Replaces CodeItLab's own conservative instruction scaffolding with a
   * permissive profile. It cannot change an upstream provider's policy.
   */
  uncensored: BooleanDefault(false),
  /** Provider instance ids the profile applies to; empty means all. */
  applyToProviders: StringArrayDefault([]),
  /** Record which turns ran under the permissive profile. */
  auditTrail: BooleanDefault(true),
});
export type CodeItLabPolicySettings = typeof CodeItLabPolicySettings.Type;

// REA (reverse engineer anything) — always on

export const CodeItLabReaSettings = Schema.Struct({
  enabled: BooleanDefault(true),
  /** Agents reach for REA on analysis tasks without the user asking. */
  autoActivate: BooleanDefault(true),
  mcpCommand: TrimmedStringDefault("npx"),
  mcpArgs: StringArrayDefault(["-y", "rea-agents@6.7.0", "--mcp"]),
  /** Seed the bundled REA skill into the app-managed skills directory. */
  installSkill: BooleanDefault(true),
});
export type CodeItLabReaSettings = typeof CodeItLabReaSettings.Type;

// Root

export const CodeItLabSettings = Schema.Struct({
  schemaVersion: CodeItLabSchemaVersion.pipe(
    Schema.withDecodingDefault(Effect.succeed(1 as const)),
  ),
  effects: CodeItLabEffectsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  nexus: CodeItLabNexusSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  memory: CodeItLabMemorySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  routing: CodeItLabRoutingSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  policy: CodeItLabPolicySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  rea: CodeItLabReaSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  ecosystem: CodeItLabEcosystemSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  studio: CodeItLabStudioSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  integrations: CodeItLabIntegrationsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  credentials: CodeItLabCredentialsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  team: CodeItLabTeamSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  board: CodeItLabBoardSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  bots: CodeItLabBotsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  budget: CodeItLabBudgetSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  context: CodeItLabContextSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  moodboards: CodeItLabMoodBoardsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  issues: CodeItLabIssuesSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  wallpaper: CodeItLabWallpaperSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  sketch: CodeItLabSketchSettings,
  deploy: CodeItLabDeploySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** Small, deterministic completion count and streak kept by the board. */
  progress: CodeItLabProgressSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** XP ledger for the send button: real events only, recomputed on read. */
  xp: CodeItLabXpSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /**
   * The user's own marketplace deployment: the URL they configured and whether
   * the bridge is opted in. The token lives in the vault, never here. Empty means
   * "not deployed yet", and the panel says that instead of linking a placeholder.
   */
  marketplace: CodeItLabMarketplaceSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** Declared by the person, never inferred: domain of interest and skillset. */
  profile: CodeItLabProfileSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  /** Custom OpenAI-compatible endpoints plus the models the picker hides. */
  models: CodeItLabModelsSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeItLabSettings = typeof CodeItLabSettings.Type;

export const DEFAULT_CODEITLAB_SETTINGS: CodeItLabSettings = Schema.decodeSync(CodeItLabSettings)(
  {},
);
