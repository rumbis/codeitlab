import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  chooseCandidate,
  DEFAULT_ROUTING_WEIGHTS,
  scoreCandidate,
  scoreCandidates,
  weightsForTask,
  type CandidateSeed,
} from "./scoring.ts";

const seed = (input: Partial<CandidateSeed> & Pick<CandidateSeed, "model">): CandidateSeed => ({
  providerInstanceId: "provider",
  providerKind: "hermes",
  quota: 1,
  smartness: 0.7,
  speed: 0.7,
  available: true,
  ...input,
});

const pick = (
  seeds: ReadonlyArray<CandidateSeed>,
  taskClass: Parameters<typeof weightsForTask>[0],
) =>
  chooseCandidate(scoreCandidates(seeds, weightsForTask(taskClass, DEFAULT_ROUTING_WEIGHTS), []))
    ?.model;

const FAST = seed({ model: "fast-model", smartness: 0.55, speed: 1 });
const SMART = seed({ model: "smart-model", smartness: 0.92, speed: 0.8 });

describe("free models", () => {
  it("wins a near-tie and still loses to a clearly better model", () => {
    const paid = seed({ model: "paid", quota: 0.5, smartness: 0.5, speed: 0.5 });
    const free = seed({ model: "free", quota: 0.5, smartness: 0.5, speed: 0.5, free: true });
    const better = seed({ model: "better", quota: 0.5, smartness: 0.9, speed: 0.5 });

    assert.isAbove(
      scoreCandidate(free, DEFAULT_ROUTING_WEIGHTS),
      scoreCandidate(paid, DEFAULT_ROUTING_WEIGHTS),
    );
    assert.isAbove(
      scoreCandidate(better, DEFAULT_ROUTING_WEIGHTS),
      scoreCandidate(free, DEFAULT_ROUTING_WEIGHTS),
    );
  });
});

describe("per-task routing weights", () => {
  it("picks the fast model for a fast turn and the smart model for a coding turn", () => {
    assert.strictEqual(pick([FAST, SMART], "fast"), "fast-model");
    assert.strictEqual(pick([FAST, SMART], "coding"), "smart-model");
    assert.strictEqual(pick([FAST, SMART], "reasoning"), "smart-model");
  });

  it("keeps a genuinely slow smart model out of fast turns", () => {
    const slowSmart = seed({ model: "slow-smart", smartness: 0.92, speed: 0.1 });
    assert.strictEqual(pick([FAST, slowSmart], "fast"), "fast-model");
    assert.strictEqual(pick([FAST, slowSmart], "coding"), "slow-smart");
  });

  it("picks the quota-rich model for a cheap turn", () => {
    const budget = seed({ model: "budget-model", quota: 1, smartness: 0.55, speed: 1 });
    const premium = seed({ model: "premium-model", quota: 0.2, smartness: 0.92, speed: 0.8 });
    assert.strictEqual(pick([budget, premium], "cheap"), "budget-model");
    // With equal quota the smarter model wins a coding turn again.
    assert.strictEqual(
      pick(
        [budget, seed({ model: "premium-model", quota: 1, smartness: 0.92, speed: 0.8 })],
        "coding",
      ),
      "premium-model",
    );
  });

  it("respects the user's own weights while shifting their emphasis", () => {
    const weights = weightsForTask("fast", { quota: 0, smartness: 1, speed: 0.5 });
    assert.strictEqual(weights.quota, 0);
    assert.ok(weights.speed > weights.smartness);
  });
});
