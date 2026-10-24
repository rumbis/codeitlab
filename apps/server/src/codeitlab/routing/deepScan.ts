import type { TaskClass } from "@codeitlab/core/routing";
import type { ServerProviderModel } from "@t3tools/contracts";

import { taskClassTier } from "./scoring.ts";

/**
 * Deep model scan: every model a provider advertises gets one real "hi" turn so
 * the router knows which models answer and how fast they are.
 *
 * The scheduled light probe measures a shortlist per provider (it runs every 30
 * minutes and must stay cheap). A gateway such as Hermes can advertise
 * thousands of custom models, and the router used to pick an untested model
 * from that catalog with only name-based heuristics. The deep scan fills the
 * gap: it runs on first boot and whenever the provider's model list changes,
 * measures each model once, and the router then only competes models that
 * actually answered.
 */

/** Hard bound on models measured per provider in one deep scan. */
export const DEEP_SCAN_MAX_MODELS = 4_096;
export const DEFAULT_DEEP_SCAN_CONCURRENCY = 8;
export const MIN_DEEP_SCAN_CONCURRENCY = 1;
export const MAX_DEEP_SCAN_CONCURRENCY = 16;
export const DEFAULT_DEEP_SCAN_TIMEOUT_SECONDS = 12;
export const MIN_DEEP_SCAN_TIMEOUT_SECONDS = 5;
export const MAX_DEEP_SCAN_TIMEOUT_SECONDS = 60;

/** A deep scan older than this is refreshed on the next boot/check. */
export const DEEP_SCAN_REFRESH_MS = 6 * 60 * 60 * 1_000;

export const clampDeepScanConcurrency = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_DEEP_SCAN_CONCURRENCY;
  return Math.min(
    MAX_DEEP_SCAN_CONCURRENCY,
    Math.max(MIN_DEEP_SCAN_CONCURRENCY, Math.round(value)),
  );
};

export const clampDeepScanTimeoutSeconds = (value: number): number => {
  if (!Number.isFinite(value)) return DEFAULT_DEEP_SCAN_TIMEOUT_SECONDS;
  return Math.min(
    MAX_DEEP_SCAN_TIMEOUT_SECONDS,
    Math.max(MIN_DEEP_SCAN_TIMEOUT_SECONDS, Math.round(value)),
  );
};

/** Models a deep scan should measure: non-legacy, non-empty, de-duplicated. */
export const deepScanModelSlugs = (
  models: ReadonlyArray<ServerProviderModel>,
): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const model of models) {
    if (model.isLegacy === true) continue;
    const slug = model.slug.trim();
    if (slug.length === 0 || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= DEEP_SCAN_MAX_MODELS) break;
  }
  return slugs;
};

/**
 * Stable fingerprint of a provider's model list. A changed fingerprint means
 * the previous deep scan is stale (models were added or removed), so the scan
 * runs again instead of trusting old measurements.
 */
export const deepScanFingerprint = (models: ReadonlyArray<ServerProviderModel>): string => {
  const slugs = [...deepScanModelSlugs(models)].sort((left, right) => left.localeCompare(right));
  let hash = 0x811c9dc5;
  for (const slug of slugs) {
    for (let index = 0; index < slug.length; index += 1) {
      hash ^= slug.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    // Separator so ["ab","c"] and ["a","bc"] do not collide.
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${slugs.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const VISION_PATTERN =
  /\b(?:vision|vl|vlm|llava|pixtral|omni|image|multimodal|qwen-vl|gpt-4o|gpt-4\.1|gemini-1\.5|gemini-2|claude-3|claude-4)\b/iu;

export const looksVisionCapable = (model: string): boolean => VISION_PATTERN.test(model);

export interface MeasuredModelSpeed {
  readonly model: string;
  readonly latencyMs: number;
  readonly ok: boolean;
}

/**
 * Rank the models a deep scan proved usable for one task class. Only measured
 * models are returned — an untested model must never win a routed turn, which
 * is exactly the bug the deep scan exists to fix.
 */
export const rankTestedModels = (input: {
  readonly speeds: ReadonlyArray<MeasuredModelSpeed>;
  readonly providerKind: string;
  readonly taskClass: TaskClass;
  readonly limit?: number;
}): ReadonlyArray<string> => {
  const limit = Math.max(1, Math.min(DEEP_SCAN_MAX_MODELS, input.limit ?? DEEP_SCAN_MAX_MODELS));
  const scored = input.speeds
    .filter((speed) => speed.ok && speed.model.length > 0)
    .map((speed) => ({
      slug: speed.model,
      latencyMs: Math.max(0, speed.latencyMs),
      tier: taskClassTier(speed.model, input.providerKind, input.taskClass),
      vision: looksVisionCapable(speed.model),
    }));
  const byLatency = (left: (typeof scored)[number], right: (typeof scored)[number]) =>
    left.latencyMs - right.latencyMs || left.slug.localeCompare(right.slug);
  const bySmartness = (left: (typeof scored)[number], right: (typeof scored)[number]) =>
    right.tier.smartness - left.tier.smartness || byLatency(left, right);
  switch (input.taskClass) {
    case "fast":
    case "cheap":
      // The whole point of these classes is wall-clock time: measured latency
      // wins, the name tier only breaks ties.
      scored.sort((left, right) => byLatency(left, right) || right.tier.speed - left.tier.speed);
      break;
    case "vision":
      scored.sort(
        (left, right) => Number(right.vision) - Number(left.vision) || bySmartness(left, right),
      );
      break;
    case "coding":
    case "reasoning":
      scored.sort(
        (left, right) =>
          right.tier.smartness - left.tier.smartness ||
          right.tier.speed - left.tier.speed ||
          byLatency(left, right),
      );
      break;
    case "chat":
    default:
      scored.sort(
        (left, right) =>
          right.tier.smartness * 0.6 +
            right.tier.speed * 0.4 -
            (left.tier.smartness * 0.6 + left.tier.speed * 0.4) || byLatency(left, right),
      );
      break;
  }
  return scored.slice(0, limit).map((entry) => entry.slug);
};

/** Best measured model for a provider when the user did not ask for per-task routing. */
export const rankTestedModelsByDefault = (input: {
  readonly speeds: ReadonlyArray<MeasuredModelSpeed>;
  readonly providerKind: string;
  readonly limit?: number;
}): ReadonlyArray<string> => {
  const limit = Math.max(1, Math.min(DEEP_SCAN_MAX_MODELS, input.limit ?? DEEP_SCAN_MAX_MODELS));
  const scored = input.speeds
    .filter((speed) => speed.ok && speed.model.length > 0)
    .map((speed) => ({
      slug: speed.model,
      latencyMs: Math.max(0, speed.latencyMs),
      tier: taskClassTier(speed.model, input.providerKind, "chat"),
    }))
    .sort(
      (left, right) =>
        right.tier.smartness * 0.6 +
          right.tier.speed * 0.4 -
          (left.tier.smartness * 0.6 + left.tier.speed * 0.4) ||
        left.latencyMs - right.latencyMs ||
        left.slug.localeCompare(right.slug),
    );
  return scored.slice(0, limit).map((entry) => entry.slug);
};

/** Summary of one provider's deep-scan progress, for logs and the UI. */
export const deepScanProgress = (input: {
  readonly checked: number;
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
}): { readonly percent: number; readonly done: boolean } => ({
  percent: input.total === 0 ? 100 : Math.min(100, Math.round((input.checked / input.total) * 100)),
  done: input.checked >= input.total,
});
