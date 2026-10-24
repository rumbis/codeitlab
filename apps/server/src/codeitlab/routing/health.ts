import type { RoutingHealthStatus, TaskClass } from "@codeitlab/core/routing";
import type { ServerProvider, ServerProviderModel } from "@t3tools/contracts";

import { defaultModel, remainingQuota, taskClassTier } from "./scoring.ts";

/**
 * Pure helpers for the scheduled quota/health probe. The service owns timing,
 * persistence and provider I/O; everything decidable lives here so the router's
 * behaviour is testable without a provider registry.
 */

export const DEFAULT_HEALTH_CHECK_MINUTES = 30;
export const MIN_HEALTH_CHECK_MINUTES = 5;
export const MAX_HEALTH_CHECK_MINUTES = 24 * 60;

/** `0` disables the schedule; anything else is rounded into the allowed range. */
export const clampHealthIntervalMinutes = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_HEALTH_CHECK_MINUTES, Math.max(MIN_HEALTH_CHECK_MINUTES, Math.round(value)));
};

export const nextCheckAtMs = (checkedAtMs: number, intervalMinutes: number): number =>
  checkedAtMs + intervalMinutes * 60_000;

export interface HealthVerdict {
  readonly ok: boolean;
  readonly status: RoutingHealthStatus;
  readonly detail?: string;
}

/**
 * A provider is routable only when the instance is enabled, the CLI is present,
 * the login is valid, the snapshot is not in an error state, and quota remains.
 * `failure` carries a probe exception (timeout, driver error) so a provider that
 * cannot answer is demoted instead of silently staying first.
 */
export const healthVerdict = (input: {
  readonly enabled: boolean;
  readonly snapshot: ServerProvider;
  readonly failure?: string;
}): HealthVerdict => {
  if (!input.enabled) {
    return { ok: false, status: "disabled", detail: "Provider instance is disabled." };
  }
  if (input.failure !== undefined) {
    return { ok: false, status: "error", detail: input.failure };
  }
  const snapshot = input.snapshot;
  if (!snapshot.enabled) {
    return { ok: false, status: "disabled", detail: "Provider is disabled." };
  }
  if (!snapshot.installed) {
    return {
      ok: false,
      status: "missing",
      detail: snapshot.message ?? "Provider binary is not installed.",
    };
  }
  if (snapshot.auth.status === "unauthenticated") {
    return { ok: false, status: "unauthenticated", detail: "Provider is not signed in." };
  }
  if (snapshot.status === "error") {
    return {
      ok: false,
      status: "error",
      detail: snapshot.message ?? "Provider reported an error.",
    };
  }
  if (snapshot.availability === "unavailable") {
    return {
      ok: false,
      status: "error",
      detail: snapshot.unavailableReason ?? "Provider is unavailable.",
    };
  }
  const quota = remainingQuota(snapshot.usageLimits);
  if (quota <= 0) {
    return { ok: false, status: "quota-exhausted", detail: "Usage quota is exhausted." };
  }
  if (quota < 0.1) {
    return {
      ok: true,
      status: "degraded",
      detail: `Only ${Math.round(quota * 100)}% of the quota window remains.`,
    };
  }
  return { ok: true, status: "ok" };
};

export const MAX_SEED_MODELS_PER_PROVIDER = 4;

/**
 * Models worth scoring for one provider and task class. Seeding every model
 * would turn a gateway like Hermes (thousands of models) into thousands of
 * candidates per turn, so only the task's best smart/speed picks and the
 * provider default compete.
 */
export const seedModelsForTask = (
  models: ReadonlyArray<ServerProviderModel>,
  providerKind: string,
  taskClass: TaskClass,
  limit: number = MAX_SEED_MODELS_PER_PROVIDER,
): ReadonlyArray<string> => {
  const active = models.filter((model) => model.isLegacy !== true && model.slug.length > 0);
  if (active.length === 0) return [];
  const scored = active.map((model) => ({
    slug: model.slug,
    tier: taskClassTier(model.slug, providerKind, taskClass),
  }));
  const bySmartness = [...scored].sort(
    (left, right) =>
      right.tier.smartness - left.tier.smartness || left.slug.localeCompare(right.slug),
  );
  const bySpeed = [...scored].sort(
    (left, right) => right.tier.speed - left.tier.speed || left.slug.localeCompare(right.slug),
  );
  const picks: string[] = [];
  const push = (slug: string | undefined): void => {
    if (slug === undefined || slug.length === 0) return;
    if (picks.includes(slug) || picks.length >= limit) return;
    picks.push(slug);
  };
  const fastestFirst = taskClass === "fast" || taskClass === "cheap";
  push(fastestFirst ? bySpeed[0]?.slug : bySmartness[0]?.slug);
  push(fastestFirst ? bySmartness[0]?.slug : bySpeed[0]?.slug);
  push(defaultModel(active)?.slug);
  for (const entry of bySmartness) push(entry.slug);
  return picks;
};
