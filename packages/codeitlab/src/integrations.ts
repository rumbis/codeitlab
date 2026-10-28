import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Whitelabel integrations.
 *
 * CodeItLab fronts three self-hostable open-source tools as its own surfaces —
 * Shorts (OpenShorts), Crew (Rakazo) and Search (ModSearch) — with CodeItLab
 * branding, CodeItLab marks and one consistent settings language. The engine
 * behind each one is named honestly in the card and in the docs, because
 * pretending we wrote them would be a lie the user would pay for.
 *
 * Nothing here is bundled: each engine stays a separate service the user can
 * self-host, and this layer only configures it, probes it, and wires its agent
 * surface (MCP server or skill) into the unified catalog so agents use it
 * without being asked.
 */

export const CodeItLabIntegrationId = Schema.Literals(["shorts", "crew", "search"]);
export type CodeItLabIntegrationId = typeof CodeItLabIntegrationId.Type;

export const CodeItLabIntegrationConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Base URL of the self-hosted engine, when it has one. */
  baseUrl: Schema.optional(Schema.String),
  /** API key for engines that accept one. Never echoed back to clients. */
  apiKey: Schema.optional(Schema.String),
});
export type CodeItLabIntegrationConfig = typeof CodeItLabIntegrationConfig.Type;

export const CodeItLabIntegrationsSettings = Schema.Struct({
  shorts: CodeItLabIntegrationConfig.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ enabled: true })),
  ),
  crew: CodeItLabIntegrationConfig.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ enabled: true })),
  ),
  search: CodeItLabIntegrationConfig.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ enabled: true })),
  ),
});
export type CodeItLabIntegrationsSettings = typeof CodeItLabIntegrationsSettings.Type;

export const CodeItLabIntegrationState = Schema.Literals([
  "disabled",
  "not-configured",
  "unreachable",
  "ready",
]);
export type CodeItLabIntegrationState = typeof CodeItLabIntegrationState.Type;

export const CodeItLabIntegrationAction = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  /** `link` opens a URL, `copy` copies a command, `install` runs a local install. */
  kind: Schema.Literals(["link", "copy", "install"]),
  value: Schema.String,
  hint: Schema.optional(Schema.String),
});
export type CodeItLabIntegrationAction = typeof CodeItLabIntegrationAction.Type;

export const CodeItLabIntegrationStatus = Schema.Struct({
  id: CodeItLabIntegrationId,
  /** CodeItLab-facing name, e.g. "Shorts". */
  name: Schema.String,
  /** One line a first-time user can act on. */
  tagline: Schema.String,
  /** The open-source engine behind the surface, named honestly. */
  engine: Schema.String,
  enabled: Schema.Boolean,
  configured: Schema.Boolean,
  state: CodeItLabIntegrationState,
  baseUrl: Schema.optional(Schema.String),
  reachable: Schema.Boolean,
  latencyMs: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.String),
  /** Catalog entries this surface contributed, e.g. `mcp · openshorts`. */
  wired: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  actions: Schema.Array(CodeItLabIntegrationAction),
});
export type CodeItLabIntegrationStatus = typeof CodeItLabIntegrationStatus.Type;

export const CodeItLabIntegrationList = Schema.Struct({
  integrations: Schema.Array(CodeItLabIntegrationStatus),
  /** What this layer registered into the unified catalog, for the "works by itself" claim. */
  wired: Schema.Struct({
    mcpServers: Schema.Array(Schema.String),
    skills: Schema.Array(Schema.String),
  }),
});
export type CodeItLabIntegrationList = typeof CodeItLabIntegrationList.Type;

export const CodeItLabIntegrationPatch = Schema.Struct({
  id: CodeItLabIntegrationId,
  enabled: Schema.optional(Schema.Boolean),
  baseUrl: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
});
export type CodeItLabIntegrationPatch = typeof CodeItLabIntegrationPatch.Type;

/**
 * Shorts clip jobs.
 *
 * OpenShorts owns the pipeline; CodeItLab only submits a job, polls it, and
 * renders what came back. `acknowledged` is not a formality — the engine
 * refuses a job without a rights confirmation, and so do we.
 */
export const CodeItLabShortsJobState = Schema.Literals([
  "queued",
  "processing",
  "completed",
  "failed",
  "unknown",
]);
export type CodeItLabShortsJobState = typeof CodeItLabShortsJobState.Type;

export const CodeItLabShortsClip = Schema.Struct({
  title: Schema.String,
  startSeconds: Schema.optional(Schema.Number),
  endSeconds: Schema.optional(Schema.Number),
  /** Absolute URL when the engine returns one, relative path otherwise. */
  videoUrl: Schema.optional(Schema.String),
  youtubeTitle: Schema.optional(Schema.String),
  tiktokDescription: Schema.optional(Schema.String),
  instagramDescription: Schema.optional(Schema.String),
});
export type CodeItLabShortsClip = typeof CodeItLabShortsClip.Type;

export const CodeItLabShortsJobRequest = Schema.Struct({
  url: Schema.String,
  /** Rights confirmation; a job without it is rejected locally. */
  acknowledged: Schema.Boolean,
  targetClips: Schema.optional(Schema.Number),
  captions: Schema.optional(Schema.Boolean),
  autoHook: Schema.optional(Schema.Boolean),
  outputFormat: Schema.optional(Schema.Literals(["vertical", "horizontal", "square", "auto"])),
});
export type CodeItLabShortsJobRequest = typeof CodeItLabShortsJobRequest.Type;

export const CodeItLabShortsJobCreated = Schema.Struct({
  jobId: Schema.String,
  state: CodeItLabShortsJobState,
  partial: Schema.optional(Schema.Boolean),
});
export type CodeItLabShortsJobCreated = typeof CodeItLabShortsJobCreated.Type;

export const CodeItLabShortsJob = Schema.Struct({
  jobId: Schema.String,
  state: CodeItLabShortsJobState,
  /** Raw engine status string, for when the engine invents a new one. */
  engineStatus: Schema.optional(Schema.String),
  queuePosition: Schema.optional(Schema.Number),
  logs: Schema.Array(Schema.String),
  clips: Schema.Array(CodeItLabShortsClip),
  partial: Schema.optional(Schema.Boolean),
  detail: Schema.optional(Schema.String),
});
export type CodeItLabShortsJob = typeof CodeItLabShortsJob.Type;

/** Defaults: nothing is bundled, so a fresh install points at the usual local ports. */
export const DEFAULT_INTEGRATION_BASE_URLS = {
  shorts: "http://127.0.0.1:8000",
  crew: "http://127.0.0.1:5173",
} as const;

export const INTEGRATION_META = {
  shorts: {
    name: "Shorts",
    tagline: "Turn a long video into vertical clips without leaving CodeItLab.",
    engine: "OpenShorts",
    repo: "https://github.com/mutonby/openshorts",
  },
  crew: {
    name: "Crew",
    tagline: "Persistent teammate bots with their own memory and routines.",
    engine: "Rakazo",
    repo: "https://github.com/elie222/rakazo",
  },
  search: {
    name: "Search",
    tagline: "Free web and X search for models that have none, with failover.",
    engine: "ModSearch",
    repo: "https://github.com/liustack/modsearch",
  },
} as const satisfies Record<
  CodeItLabIntegrationId,
  {
    readonly name: string;
    readonly tagline: string;
    readonly engine: string;
    readonly repo: string;
  }
>;
