/**
 * Recent model failures from a response check, used by the router to steer away
 * from a model that did not answer.
 *
 * A speed/health probe sends the one-word prompt and waits for the reply. When a
 * model fails that check the router records it here, so the next Auto router
 * turn skips that model — from the same ACP when it has a healthy one, otherwise
 * from the next ACP — instead of handing the turn to something that just failed.
 * A failed **model** does not take its provider down: siblings, including the
 * free models some providers run, stay routable.
 *
 * Failures cool down for a day by default. A later probe that succeeds clears the
 * record, which is the discreet way back in: nothing needs a banner, the model
 * simply returns to the pool once it answers again.
 *
 * Like `providerFailures.ts` this is a process-local map rather than an Effect
 * service: the probes run inside `RoutingService`, and everything that reads the
 * cooldown is built in the same process.
 */

import { DateTime } from "effect";

const MAX_TRACKED_FAILURES = 256;

/** One day: a model that failed the response check stays out until tomorrow. */
export const DEFAULT_MODEL_COOLDOWN_MINUTES = 24 * 60;

/** The clock is read through Effect so the module stays free of raw `Date` globals. */
const currentTimeMs = (): number => DateTime.toEpochMillis(DateTime.nowUnsafe());

export interface ModelCooldown {
  readonly providerInstanceId: string;
  readonly model: string;
  /** Why the response check failed, as reported by the probe. */
  readonly reason: string;
  readonly recordedAtMs: number;
  readonly untilMs: number;
}

const cooldowns = new Map<string, ModelCooldown>();

const keyOf = (providerInstanceId: string, model: string): string =>
  `${providerInstanceId}\u0000${model}`;

/** Record a failed response check for one model. */
export const recordModelCooldown = (input: {
  readonly providerInstanceId: string;
  readonly model: string;
  readonly reason: string;
  readonly cooldownMinutes?: number;
  readonly nowMs?: number;
}): ModelCooldown | undefined => {
  if (input.providerInstanceId.length === 0 || input.model.length === 0) return undefined;
  const nowMs = input.nowMs ?? currentTimeMs();
  const cooldownMs = Math.max(0, input.cooldownMinutes ?? DEFAULT_MODEL_COOLDOWN_MINUTES) * 60_000;
  const key = keyOf(input.providerInstanceId, input.model);
  const cooldown: ModelCooldown = {
    providerInstanceId: input.providerInstanceId,
    model: input.model,
    reason: input.reason.slice(0, 500),
    recordedAtMs: nowMs,
    untilMs: nowMs + cooldownMs,
  };
  cooldowns.delete(key);
  cooldowns.set(key, cooldown);
  while (cooldowns.size > MAX_TRACKED_FAILURES) {
    const oldest = cooldowns.keys().next();
    if (oldest.done === true) break;
    cooldowns.delete(oldest.value);
  }
  return cooldown;
};

export const isModelCoolingDown = (
  providerInstanceId: string,
  model: string,
  nowMs = currentTimeMs(),
): boolean => {
  const cooldown = cooldowns.get(keyOf(providerInstanceId, model));
  return cooldown !== undefined && cooldown.untilMs > nowMs;
};

export const coolingDownModels = (nowMs = currentTimeMs()): ReadonlyArray<ModelCooldown> =>
  [...cooldowns.values()].filter((cooldown) => cooldown.untilMs > nowMs);

export const modelCooldownFor = (
  providerInstanceId: string,
  model: string,
): ModelCooldown | undefined => cooldowns.get(keyOf(providerInstanceId, model));

/**
 * Put one model back in the pool before its day is up — the explicit half of the
 * "enable it discreetly" path. A successful response check calls this too.
 */
export const clearModelCooldown = (providerInstanceId: string, model: string): boolean =>
  cooldowns.delete(keyOf(providerInstanceId, model));

/** Test helper: forget every recorded cooldown. */
export const resetModelCooldowns = (): void => {
  cooldowns.clear();
};
