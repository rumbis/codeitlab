import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * OmniRoute-style multi-provider routing: when the user does not pick a harness,
 * CodeItLab classifies the task and picks a provider instance + model by quota,
 * smartness and speed. Every decision carries a human-readable reason so the UI
 * can explain itself.
 */

export const TaskClass = Schema.Literals([
  "coding",
  "reasoning",
  "vision",
  "chat",
  "fast",
  "cheap",
]);
export type TaskClass = typeof TaskClass.Type;

export const RoutingCandidate = Schema.Struct({
  providerInstanceId: Schema.String,
  providerKind: Schema.String,
  model: Schema.String,
  /** Remaining quota, 0..1; 1 means unconstrained or unknown. */
  quota: Schema.Number,
  /** Relative quality for the task class, 0..1. */
  smartness: Schema.Number,
  /** Relative speed for the task class, 0..1. */
  speed: Schema.Number,
  /** Weighted score used to pick the winner. */
  score: Schema.Number,
  available: Schema.Boolean,
});
export type RoutingCandidate = typeof RoutingCandidate.Type;

export const RoutingDecision = Schema.Struct({
  id: Schema.String,
  decidedAt: Schema.String,
  taskClass: TaskClass,
  providerInstanceId: Schema.String,
  providerKind: Schema.String,
  model: Schema.String,
  reason: Schema.String,
  candidates: Schema.Array(RoutingCandidate).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Set when the decision came from OmniRoute virtual models. */
  omniRouteModel: Schema.optional(Schema.String),
  /** True when a per-task override pinned this model instead of scoring. */
  override: Schema.optional(Schema.Boolean),
  /**
   * True when the provider routes with its own router (OmniRoute, or a kind the
   * user declared in `delegatedProviderKinds`). The app reports the choice; it
   * does not second-guess it.
   */
  delegated: Schema.optional(Schema.Boolean),
  /** True when this decision was applied to the run's provider/model selection. */
  enforced: Schema.optional(Schema.Boolean),
  /** Why enforcement did not apply (`off`, `compact`, `pinned`, ...). */
  skipReason: Schema.optional(Schema.String),
});
export type RoutingDecision = typeof RoutingDecision.Type;

export const RoutingDecideInput = Schema.Struct({
  prompt: Schema.String,
  projectId: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  attachments: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Force a task class instead of classifying. */
  taskClass: Schema.optional(TaskClass),
  /**
   * Selection the run would use without routing. When set, `decide` also
   * evaluates enforcement and marks the decision `enforced`/`skipReason`.
   */
  currentModelSelection: Schema.optional(
    Schema.Struct({ instanceId: Schema.String, model: Schema.String }),
  ),
  /** Callers that render advice only (context injection) pass false. */
  recordHistory: Schema.optional(Schema.Boolean),
});
export type RoutingDecideInput = typeof RoutingDecideInput.Type;

export const RoutingCatalog = Schema.Struct({
  mode: Schema.Literals(["manual", "auto", "omniroute"]),
  providers: Schema.Array(
    Schema.Struct({
      providerInstanceId: Schema.String,
      providerKind: Schema.String,
      name: Schema.String,
      models: Schema.Array(Schema.String),
      /** The instance's default model, used to tell a pinned choice from a default. */
      defaultModel: Schema.optional(Schema.String),
      /** Every non-legacy model the provider advertises (not just the ones shown). */
      modelCount: Schema.optional(Schema.Number),
      available: Schema.Boolean,
      quota: Schema.Number,
      speed: Schema.Number,
      smartness: Schema.Number,
    }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  omniRouteModels: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type RoutingCatalog = typeof RoutingCatalog.Type;

// Quota health — periodic provider probes

/**
 * Scheduled health checks keep the routing catalog honest: a provider that
 * cannot start, lost its login, or burned its quota is demoted before the next
 * turn instead of failing at dispatch time.
 */
export const RoutingHealthStatus = Schema.Literals([
  "ok",
  "degraded",
  "quota-exhausted",
  "unauthenticated",
  "missing",
  "error",
  "disabled",
]);
export type RoutingHealthStatus = typeof RoutingHealthStatus.Type;

export const RoutingHealthEntry = Schema.Struct({
  providerInstanceId: Schema.String,
  providerKind: Schema.String,
  name: Schema.String,
  /** True only when the provider can serve a turn right now. */
  ok: Schema.Boolean,
  status: RoutingHealthStatus,
  /** Remaining quota headroom, 0..1; 1 means unknown or unconstrained. */
  quota: Schema.Number,
  /** Round-trip time of the probe, when it produced a snapshot. */
  latencyMs: Schema.optional(Schema.Number),
  /** Number of non-legacy models the probe returned. */
  models: Schema.Number,
  /** Human-readable cause for a non-ok status. */
  detail: Schema.optional(Schema.String),
  /**
   * Measured model speed from the "hi" probe: one entry per model the router
   * would consider for this provider. Sorted fastest first.
   */
  speeds: Schema.optional(
    Schema.Array(
      Schema.Struct({
        model: Schema.String,
        /** Wall-clock time from dispatch to the first model output, in ms. */
        latencyMs: Schema.Number,
        ok: Schema.Boolean,
        checkedAt: Schema.String,
        error: Schema.optional(Schema.String),
      }),
    ),
  ),
  /** Progress of the speed probe for this provider (`checking` while running). */
  speedProbe: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(["checking", "done", "partial", "error", "off"]),
      startedAt: Schema.String,
      finishedAt: Schema.optional(Schema.String),
      checked: Schema.Number,
      total: Schema.Number,
      /** `light` = scheduled candidate probe, `deep` = every advertised model. */
      mode: Schema.optional(Schema.Literals(["light", "deep"])),
      /** Models that answered the probe. */
      okCount: Schema.optional(Schema.Number),
      /** Models that failed the probe. */
      failedCount: Schema.optional(Schema.Number),
      /** Models the provider advertises (deep-scan denominator). */
      modelCount: Schema.optional(Schema.Number),
      /** Hash of the provider's model list when the deep scan ran. */
      fingerprint: Schema.optional(Schema.String),
      /** Models that failed the probe and are being retried automatically. */
      retrying: Schema.optional(Schema.Array(Schema.String)),
    }),
  ),
});
export type RoutingHealthEntry = typeof RoutingHealthEntry.Type;

export const RoutingHealth = Schema.Struct({
  checkedAt: Schema.String,
  intervalMinutes: Schema.Number,
  nextCheckAt: Schema.String,
  source: Schema.Literals(["startup", "scheduled", "manual"]),
  entries: Schema.Array(RoutingHealthEntry).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /**
   * Models the response check set aside, so the UI can show them and offer a
   * re-check instead of hiding why a model stopped appearing.
   */
  modelCooldowns: Schema.optional(
    Schema.Array(
      Schema.Struct({
        providerInstanceId: Schema.String,
        model: Schema.String,
        reason: Schema.String,
        untilMs: Schema.Number,
      }),
    ),
  ),
  /** Aggregate speed-probe state across providers, for the "checking" banner. */
  speedProbe: Schema.optional(
    Schema.Struct({
      status: Schema.Literals(["checking", "done", "partial", "error", "off"]),
      startedAt: Schema.String,
      finishedAt: Schema.optional(Schema.String),
      checked: Schema.Number,
      total: Schema.Number,
      mode: Schema.optional(Schema.Literals(["light", "deep"])),
      okCount: Schema.optional(Schema.Number),
      failedCount: Schema.optional(Schema.Number),
      /** Per-provider deep-scan fingerprints, so staleness is per provider. */
      fingerprints: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
});
export type RoutingHealth = typeof RoutingHealth.Type;
