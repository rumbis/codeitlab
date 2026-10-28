/**
 * Recent provider failures, used by the router to steer away from a harness
 * that just failed a turn.
 *
 * The orchestration layer sees the failure (the provider returned an error, a
 * quota/auth problem, a transport failure) and records it here; routing then
 * marks that provider unavailable for `providerFailureCooldownMinutes` so the
 * next Auto router turn goes to the configured backup provider instead of
 * failing the same way again.
 *
 * This is deliberately a small module-level map instead of an Effect service:
 * the recorder is called from `Orchestrator` (built before the CodeItLab
 * layer) and read from `RoutingService`/`enforcedRoute` (built later), and the
 * state is process-local and disposable — the same pattern as
 * `activeRoutingService.ts`.
 */

import { DateTime } from "effect";

const MAX_TRACKED_FAILURES = 64;

/** The clock is read through Effect so the module stays free of raw `Date` globals. */
const currentTimeMs = (): number => DateTime.toEpochMillis(DateTime.nowUnsafe());

export interface ProviderFailure {
  readonly providerInstanceId: string;
  /** Provider failure class as classified by orchestration. */
  readonly failureClass: string;
  readonly reason: string;
  readonly recordedAtMs: number;
  readonly untilMs: number;
}

const failures = new Map<string, ProviderFailure>();

/** Failure classes that should not skip a provider (the prompt itself was bad). */
const NON_PROVIDER_FAILURE_CLASSES: ReadonlySet<string> = new Set([
  "validation_error",
  "cancelled",
  "aborted",
]);

export const isProviderFailureClass = (failureClass: string | undefined): boolean =>
  failureClass !== undefined && failureClass.length > 0
    ? !NON_PROVIDER_FAILURE_CLASSES.has(failureClass)
    : false;

/**
 * Record that a provider failed a turn. `cooldownMinutes` comes from the
 * routing settings at call time; `<= 0` still records the failure but with no
 * cooldown (useful for history/tests).
 */
export const recordProviderFailure = (input: {
  readonly providerInstanceId: string;
  readonly failureClass: string;
  readonly reason: string;
  readonly cooldownMinutes: number;
  readonly nowMs?: number;
}): ProviderFailure | undefined => {
  if (input.providerInstanceId.length === 0) return undefined;
  if (!isProviderFailureClass(input.failureClass)) return undefined;
  const nowMs = input.nowMs ?? currentTimeMs();
  const cooldownMs = Math.max(0, input.cooldownMinutes) * 60_000;
  const failure: ProviderFailure = {
    providerInstanceId: input.providerInstanceId,
    failureClass: input.failureClass,
    reason: input.reason.slice(0, 500),
    recordedAtMs: nowMs,
    untilMs: nowMs + cooldownMs,
  };
  failures.delete(input.providerInstanceId);
  failures.set(input.providerInstanceId, failure);
  while (failures.size > MAX_TRACKED_FAILURES) {
    const oldest = failures.keys().next();
    if (oldest.done === true) break;
    failures.delete(oldest.value);
  }
  return failure;
};

export const isProviderCoolingDown = (
  providerInstanceId: string,
  nowMs = currentTimeMs(),
): boolean => {
  const failure = failures.get(providerInstanceId);
  return failure !== undefined && failure.untilMs > nowMs;
};

export const coolingDownProviderIds = (nowMs = currentTimeMs()): ReadonlyArray<string> =>
  [...failures.values()]
    .filter((failure) => failure.untilMs > nowMs)
    .map((failure) => failure.providerInstanceId);

export const providerFailureFor = (providerInstanceId: string): ProviderFailure | undefined =>
  failures.get(providerInstanceId);

/** Test helper: forget every recorded failure. */
export const resetProviderFailures = (): void => {
  failures.clear();
};
