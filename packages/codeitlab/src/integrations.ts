import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Whitelabel integrations.
 *
 * CodeitLab fronts three self-hostable open-source tools as its own surfaces —
 * Shorts (OpenShorts), Crew (Rakazo) and Search (ModSearch) — with CodeitLab
 * branding, CodeitLab marks and one consistent settings language. The engine
 * behind each one is named honestly in the card and in the docs, because
 * pretending we wrote them would be a lie the user would pay for.
 *
 * Nothing here is bundled: each engine stays a separate service the user can
 * self-host, and this layer only configures it, probes it, and wires its agent
 * surface (MCP server or skill) into the unified catalog so agents use it
 * without being asked.
 */

export const CodeitlabIntegrationId = Schema.Literals(["shorts", "crew", "search"]);
export type CodeitlabIntegrationId = typeof CodeitlabIntegrationId.Type;

export const CodeitlabIntegrationConfig = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  /** Base URL of the self-hosted engine, when it has one. */
  baseUrl: Schema.optional(Schema.String),
  /** API key for engines that accept one. Never echoed back to clients. */
  apiKey: Schema.optional(Schema.String),
});
export type CodeitlabIntegrationConfig = typeof CodeitlabIntegrationConfig.Type;

export const CodeitlabIntegrationsSettings = Schema.Struct({
  shorts: CodeitlabIntegrationConfig.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ enabled: true })),
  ),
  crew: CodeitlabIntegrationConfig.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ enabled: true })),
  ),
  search: CodeitlabIntegrationConfig.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed({ enabled: true })),
  ),
});
export type CodeitlabIntegrationsSettings = typeof CodeitlabIntegrationsSettings.Type;

export const CodeitlabIntegrationState = Schema.Literals([
  "disabled",
  "not-configured",
  "unreachable",
  "ready",
]);
export type CodeitlabIntegrationState = typeof CodeitlabIntegrationState.Type;

export const CodeitlabIntegrationAction = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  /** `link` opens a URL, `copy` copies a command, `install` runs a local install. */
  kind: Schema.Literals(["link", "copy", "install"]),
  value: Schema.String,
  hint: Schema.optional(Schema.String),
});
export type CodeitlabIntegrationAction = typeof CodeitlabIntegrationAction.Type;

export const CodeitlabIntegrationStatus = Schema.Struct({
  id: CodeitlabIntegrationId,
  /** CodeitLab-facing name, e.g. "Shorts". */
  name: Schema.String,
  /** One line a first-time user can act on. */
  tagline: Schema.String,
  /** The open-source engine behind the surface, named honestly. */
  engine: Schema.String,
  enabled: Schema.Boolean,
  configured: Schema.Boolean,
  state: CodeitlabIntegrationState,
  baseUrl: Schema.optional(Schema.String),
  reachable: Schema.Boolean,
  latencyMs: Schema.optional(Schema.Number),
  detail: Schema.optional(Schema.String),
  /** Catalog entries this surface contributed, e.g. `mcp · openshorts`. */
  wired: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  actions: Schema.Array(CodeitlabIntegrationAction),
});
export type CodeitlabIntegrationStatus = typeof CodeitlabIntegrationStatus.Type;

export const CodeitlabIntegrationList = Schema.Struct({
  integrations: Schema.Array(CodeitlabIntegrationStatus),
  /** What this layer registered into the unified catalog, for the "works by itself" claim. */
  wired: Schema.Struct({
    mcpServers: Schema.Array(Schema.String),
    skills: Schema.Array(Schema.String),
  }),
});
export type CodeitlabIntegrationList = typeof CodeitlabIntegrationList.Type;

export const CodeitlabIntegrationPatch = Schema.Struct({
  id: CodeitlabIntegrationId,
  enabled: Schema.optional(Schema.Boolean),
  baseUrl: Schema.optional(Schema.String),
  apiKey: Schema.optional(Schema.String),
});
export type CodeitlabIntegrationPatch = typeof CodeitlabIntegrationPatch.Type;

/**
 * Shorts clip jobs.
 *
 * OpenShorts owns the pipeline; CodeitLab only submits a job, polls it, and
 * renders what came back. `acknowledged` is not a formality — the engine
 * refuses a job without a rights confirmation, and so do we.
 */
export const CodeitlabShortsJobState = Schema.Literals([
  "queued",
  "processing",
  "completed",
  "failed",
  "unknown",
]);
export type CodeitlabShortsJobState = typeof CodeitlabShortsJobState.Type;

export const CodeitlabShortsClip = Schema.Struct({
  title: Schema.String,
  startSeconds: Schema.optional(Schema.Number),
  endSeconds: Schema.optional(Schema.Number),
  /** Absolute URL when the engine returns one, relative path otherwise. */
  videoUrl: Schema.optional(Schema.String),
  youtubeTitle: Schema.optional(Schema.String),
  tiktokDescription: Schema.optional(Schema.String),
  instagramDescription: Schema.optional(Schema.String),
});
export type CodeitlabShortsClip = typeof CodeitlabShortsClip.Type;

export const CodeitlabShortsJobRequest = Schema.Struct({
  url: Schema.String,
  /** Rights confirmation; a job without it is rejected locally. */
  acknowledged: Schema.Boolean,
  targetClips: Schema.optional(Schema.Number),
  captions: Schema.optional(Schema.Boolean),
  autoHook: Schema.optional(Schema.Boolean),
  outputFormat: Schema.optional(Schema.Literals(["vertical", "horizontal", "square", "auto"])),
});
export type CodeitlabShortsJobRequest = typeof CodeitlabShortsJobRequest.Type;

export const CodeitlabShortsJobCreated = Schema.Struct({
  jobId: Schema.String,
  state: CodeitlabShortsJobState,
  partial: Schema.optional(Schema.Boolean),
});
export type CodeitlabShortsJobCreated = typeof CodeitlabShortsJobCreated.Type;

export const CodeitlabShortsJob = Schema.Struct({
  jobId: Schema.String,
  state: CodeitlabShortsJobState,
  /** Raw engine status string, for when the engine invents a new one. */
  engineStatus: Schema.optional(Schema.String),
  queuePosition: Schema.optional(Schema.Number),
  logs: Schema.Array(Schema.String),
  clips: Schema.Array(CodeitlabShortsClip),
  partial: Schema.optional(Schema.Boolean),
  detail: Schema.optional(Schema.String),
});
export type CodeitlabShortsJob = typeof CodeitlabShortsJob.Type;

/** Defaults: nothing is bundled, so a fresh install points at the usual local ports. */
export const DEFAULT_INTEGRATION_BASE_URLS = {
  shorts: "http://127.0.0.1:8000",
  crew: "http://127.0.0.1:5173",
} as const;

export const INTEGRATION_META = {
  shorts: {
    name: "Shorts",
    tagline: "Turn a long video into vertical clips without leaving CodeitLab.",
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
  CodeitlabIntegrationId,
  {
    readonly name: string;
    readonly tagline: string;
    readonly engine: string;
    readonly repo: string;
  }
>;
