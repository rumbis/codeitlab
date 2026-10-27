import type { RoutingCandidate, TaskClass } from "@codeitlab/core/routing";
import type { ServerProviderModel, ServerProviderUsageLimits } from "@codeitlab/contracts";

/**
 * Candidate scoring for auto-routing. Pure and deterministic: the same
 * candidate set and weights always produce the same order, so the UI can
 * explain a decision and tests can pin it.
 *
 * Tiers are name-based heuristics, not measured benchmarks. They are good
 * enough to pick between a fast and a smart model per provider; real latency
 * history can refine them later without changing this interface.
 */

export interface RoutingWeights {
  readonly quota: number;
  readonly smartness: number;
  readonly speed: number;
}

export const DEFAULT_ROUTING_WEIGHTS: RoutingWeights = {
  quota: 0.35,
  smartness: 0.4,
  speed: 0.25,
};

export interface CandidateSeed {
  readonly providerInstanceId: string;
  readonly providerKind: string;
  readonly model: string;
  readonly quota: number;
  readonly smartness: number;
  readonly speed: number;
  readonly available: boolean;
}

export interface ModelTier {
  readonly smartness: number;
  readonly speed: number;
}

const SMART_PATTERN =
  /\b(?:opus|gpt-5|gpt-6|o3|o4|pro|max|ultra|thinking|reasoning|deepseek-v4|sonnet-4|grok-4|gemini-2\.5-pro)\b/iu;
const MID_PATTERN =
  /\b(?:sonnet|gpt-4|gpt-4\.1|gemini|grok-3|deepseek|qwen|llama|mistral|command)\b/iu;
const FAST_PATTERN = /\b(?:haiku|flash|mini|nano|lite|small|fast|turbo|instant|8b|7b)\b/iu;

export const modelTier = (model: string, providerKind: string): ModelTier => {
  const name = `${providerKind}/${model}`;
  if (FAST_PATTERN.test(name)) return { smartness: 0.55, speed: 0.9 };
  if (SMART_PATTERN.test(name)) return { smartness: 0.92, speed: 0.45 };
  if (MID_PATTERN.test(name)) return { smartness: 0.78, speed: 0.65 };
  return { smartness: 0.7, speed: 0.65 };
};

/**
 * The user's weights say how much quota, smartness and speed matter overall.
 * The task class says which of those decides *this* turn: a "fast" turn is
 * wall-clock time, a coding turn is capability, a cheap turn is quota. Measured
 * latency saturates at 800 ms, so without this shift a fast turn would keep
 * picking the smarter model for a difference a human cannot feel.
 */
const TASK_WEIGHT_MULTIPLIERS: Record<TaskClass, RoutingWeights> = {
  fast: { quota: 0.6, smartness: 0.35, speed: 2.5 },
  cheap: { quota: 2, smartness: 0.35, speed: 0.8 },
  coding: { quota: 0.7, smartness: 1.5, speed: 0.7 },
  reasoning: { quota: 0.7, smartness: 1.5, speed: 0.7 },
  vision: { quota: 0.8, smartness: 1.3, speed: 0.7 },
  chat: { quota: 1, smartness: 1, speed: 1 },
};

export const weightsForTask = (taskClass: TaskClass, base: RoutingWeights): RoutingWeights => {
  const multiplier = TASK_WEIGHT_MULTIPLIERS[taskClass] ?? TASK_WEIGHT_MULTIPLIERS.chat;
  return {
    quota: base.quota * multiplier.quota,
    smartness: base.smartness * multiplier.smartness,
    speed: base.speed * multiplier.speed,
  };
};

export const taskClassTier = (
  model: string,
  providerKind: string,
  taskClass: TaskClass,
): ModelTier => {
  const tier = modelTier(model, providerKind);
  switch (taskClass) {
    case "fast":
      return { smartness: tier.smartness * 0.7, speed: tier.speed };
    case "cheap":
      return { smartness: tier.smartness * 0.5, speed: tier.speed };
    case "reasoning":
    case "coding":
      return { smartness: tier.smartness, speed: tier.speed * 0.6 };
    case "vision":
    case "chat":
    default:
      return tier;
  }
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const normalizeWeights = (weights: RoutingWeights): RoutingWeights => {
  const quota = Math.max(0, weights.quota);
  const smartness = Math.max(0, weights.smartness);
  const speed = Math.max(0, weights.speed);
  const total = quota + smartness + speed;
  if (total <= 0) return DEFAULT_ROUTING_WEIGHTS;
  return { quota: quota / total, smartness: smartness / total, speed: speed / total };
};

export const scoreCandidate = (seed: CandidateSeed, weights: RoutingWeights): number => {
  const normalized = normalizeWeights(weights);
  const raw =
    normalized.quota * clamp01(seed.quota) +
    normalized.smartness * clamp01(seed.smartness) +
    normalized.speed * clamp01(seed.speed);
  return Math.round(raw * 1_000) / 1_000;
};

export const scoreCandidates = (
  seeds: ReadonlyArray<CandidateSeed>,
  weights: RoutingWeights,
  providerOrder: ReadonlyArray<string>,
): ReadonlyArray<RoutingCandidate> =>
  seeds
    .map((seed) => ({
      providerInstanceId: seed.providerInstanceId,
      providerKind: seed.providerKind,
      model: seed.model,
      quota: clamp01(seed.quota),
      smartness: clamp01(seed.smartness),
      speed: clamp01(seed.speed),
      score: scoreCandidate(seed, weights),
      available: seed.available,
    }))
    .sort((left, right) => {
      if (left.available !== right.available) return left.available ? -1 : 1;
      if (right.score !== left.score) return right.score - left.score;
      const leftOrder = providerOrder.indexOf(left.providerInstanceId);
      const rightOrder = providerOrder.indexOf(right.providerInstanceId);
      const leftIndex = leftOrder < 0 ? Number.MAX_SAFE_INTEGER : leftOrder;
      const rightIndex = rightOrder < 0 ? Number.MAX_SAFE_INTEGER : rightOrder;
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      const byInstance = left.providerInstanceId.localeCompare(right.providerInstanceId);
      if (byInstance !== 0) return byInstance;
      return left.model.localeCompare(right.model);
    });

export const chooseCandidate = (
  candidates: ReadonlyArray<RoutingCandidate>,
): RoutingCandidate | undefined => candidates.find((candidate) => candidate.available);

/** Remaining headroom across every reported usage window; 1 means unknown/unconstrained. */
export const remainingQuota = (usageLimits: ServerProviderUsageLimits | undefined): number => {
  if (usageLimits === undefined || usageLimits.unavailable !== undefined) return 1;
  if (usageLimits.windows.length === 0) return 1;
  const used = Math.max(...usageLimits.windows.map((window) => window.usedPercent));
  return clamp01(1 - used / 100);
};

export const defaultModel = (
  models: ReadonlyArray<ServerProviderModel>,
): ServerProviderModel | undefined =>
  models.find((model) => model.isDefault === true) ??
  models.find((model) => model.isLegacy !== true) ??
  models[0];

/** Provider-level tier used by the catalog: best model for the requested class. */
export const bestProviderTier = (
  models: ReadonlyArray<ServerProviderModel>,
  providerKind: string,
  taskClass: TaskClass,
): ModelTier => {
  let best: ModelTier = { smartness: 0, speed: 0 };
  for (const model of models) {
    const tier = taskClassTier(model.slug, providerKind, taskClass);
    const score = tier.smartness * 0.6 + tier.speed * 0.4;
    const bestScore = best.smartness * 0.6 + best.speed * 0.4;
    if (score > bestScore) best = tier;
  }
  return best.smartness === 0 && best.speed === 0 ? modelTier("", providerKind) : best;
};
