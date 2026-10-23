import type { TaskClass } from "@codeitlab/core/routing";
import type { ProviderTextGeneration } from "@t3tools/provider-core/server/textGeneration";
import type { ProviderInstanceId, ServerProviderModel } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { seedModelsForTask } from "./health.ts";

/**
 * Real model-speed measurement for the router.
 *
 * The name-based tier heuristics in `scoring.ts` are a good default, but they
 * cannot tell a fast provider from a slow one on this machine, on this network,
 * on this plan. The speed probe sends the smallest possible turn ("hi") to a
 * bounded set of candidate models and measures the wall-clock round trip, which
 * `buildSeeds` then feeds into the scorer as the `speed` signal.
 */

/** The one-word prompt: minimal tokens in, minimal tokens out. */
export const SPEED_PROBE_MESSAGE = "hi";

/** A single model attempt is abandoned after this long. */
export const SPEED_PROBE_TIMEOUT = "20 seconds";

/** Default and hard bound for `routing.speedProbeModelsPerProvider`. */
export const DEFAULT_SPEED_PROBE_MODELS = 3;
export const MAX_SPEED_PROBE_MODELS = 10;

/**
 * Latency → 0..1 speed score. This is deliberately linear and documented so the
 * routing page can explain a score: `≤ 800 ms` is full speed (1.0), `≥ 8 s` is
 * the floor (0.1), and everything between falls off linearly. Anything faster
 * than 800 ms is indistinguishable to a human, anything slower than 8 s is a
 * provider we should avoid unless it is the only one left.
 */
export const FAST_LATENCY_MS = 800;
export const SLOW_LATENCY_MS = 8_000;
export const FAST_SPEED_SCORE = 1;
export const SLOW_SPEED_SCORE = 0.1;

export const speedScoreFromLatency = (latencyMs: number): number => {
  if (!Number.isFinite(latencyMs) || latencyMs <= FAST_LATENCY_MS) return FAST_SPEED_SCORE;
  if (latencyMs >= SLOW_LATENCY_MS) return SLOW_SPEED_SCORE;
  const progress = (latencyMs - FAST_LATENCY_MS) / (SLOW_LATENCY_MS - FAST_LATENCY_MS);
  const score = FAST_SPEED_SCORE - progress * (FAST_SPEED_SCORE - SLOW_SPEED_SCORE);
  return Math.round(score * 1_000) / 1_000;
};

export interface SpeedProbeResult {
  readonly model: string;
  /** Wall-clock time of the final attempt, in ms (0 when the instance is gone). */
  readonly latencyMs: number;
  readonly ok: boolean;
  readonly error?: string;
}

export interface ProbeInstanceModelSpeedInput {
  readonly textGeneration: ProviderTextGeneration;
  readonly cwd: string;
  readonly instanceId: ProviderInstanceId;
  readonly model: string;
  /**
   * Deep scans measure thousands of models, so they skip the immediate retry
   * and use a shorter per-model timeout: one failed "hi" is enough evidence
   * that the model is not usable right now.
   */
  readonly retry?: boolean;
  readonly timeout?: Duration.Input;
}

const describeFailure = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause);
  if (error instanceof Error && error.message.trim().length > 0) return error.message.trim();
  return "Speed probe failed.";
};

/** One "hi" turn; resolves with the wall-clock ms even when the turn fails. */
const attemptSpeedProbe = Effect.fn("codeitlab.routing.attemptSpeedProbe")(function* (
  input: ProbeInstanceModelSpeedInput,
) {
  const startedAtMs = yield* Clock.currentTimeMillis;
  const exit = yield* input.textGeneration
    .generateThreadTitle({
      cwd: input.cwd,
      message: SPEED_PROBE_MESSAGE,
      modelSelection: { instanceId: input.instanceId, model: input.model },
    })
    .pipe(Effect.timeout(input.timeout ?? SPEED_PROBE_TIMEOUT), Effect.exit);
  const latencyMs = (yield* Clock.currentTimeMillis) - startedAtMs;
  return { latencyMs, exit };
});

/**
 * Measure one model with a single immediate retry: a transient CLI/network
 * hiccup must not mark a model as slow or broken for a whole check interval.
 * `ok: false` is only reported after the retry fails too.
 */
export const probeInstanceModelSpeed = Effect.fn("codeitlab.routing.probeInstanceModelSpeed")(
  function* (input: ProbeInstanceModelSpeedInput) {
    const first = yield* attemptSpeedProbe(input);
    if (Exit.isSuccess(first.exit)) {
      return { model: input.model, latencyMs: first.latencyMs, ok: true };
    }
    if (input.retry === false) {
      return {
        model: input.model,
        latencyMs: first.latencyMs,
        ok: false,
        error: describeFailure(first.exit.cause),
      };
    }
    const retry = yield* attemptSpeedProbe(input);
    if (Exit.isSuccess(retry.exit)) {
      return { model: input.model, latencyMs: retry.latencyMs, ok: true };
    }
    return {
      model: input.model,
      latencyMs: retry.latencyMs,
      ok: false,
      error: describeFailure(retry.exit.cause),
    };
  },
);

/**
 * The models worth measuring for a provider: the same seed set the scorer
 * competes (fastest, smartest, provider default), bounded so a gateway with
 * thousands of models cannot turn one health check into thousands of turns.
 */
export const selectProbeModels = (input: {
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly providerKind: string;
  readonly taskClass: TaskClass;
  readonly limit: number;
}): ReadonlyArray<string> => {
  const requested = Number.isFinite(input.limit)
    ? Math.trunc(input.limit)
    : DEFAULT_SPEED_PROBE_MODELS;
  const limit = Math.min(MAX_SPEED_PROBE_MODELS, Math.max(1, requested));
  return seedModelsForTask(input.models, input.providerKind, input.taskClass, limit);
};
