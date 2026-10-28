import { assert, it } from "@effect/vitest";
import type { ServerProviderModel } from "@codeitlab/contracts";
import { describe } from "vite-plus/test";

import {
  clampDeepScanConcurrency,
  clampDeepScanTimeoutSeconds,
  DEEP_SCAN_MAX_MODELS,
  deepScanFingerprint,
  deepScanModelSlugs,
  rankTestedModels,
  rankTestedModelsByDefault,
} from "./deepScan.ts";

const model = (slug: string, isLegacy = false): ServerProviderModel =>
  ({ slug, name: slug, isDefault: false, isLegacy }) as unknown as ServerProviderModel;

const speed = (name: string, latencyMs: number, ok = true) => ({ model: name, latencyMs, ok });

describe("deep scan planning", () => {
  it("clamps concurrency and timeout into their supported ranges", () => {
    assert.strictEqual(clampDeepScanConcurrency(0), 1);
    assert.strictEqual(clampDeepScanConcurrency(8), 8);
    assert.strictEqual(clampDeepScanConcurrency(99), 16);
    assert.strictEqual(clampDeepScanConcurrency(Number.NaN), 8);
    assert.strictEqual(clampDeepScanTimeoutSeconds(1), 5);
    assert.strictEqual(clampDeepScanTimeoutSeconds(12), 12);
    assert.strictEqual(clampDeepScanTimeoutSeconds(500), 60);
  });

  it("deduplicates, skips legacy models, and bounds the model list", () => {
    const slugs = deepScanModelSlugs([
      model("a"),
      model("a"),
      model("b", true),
      model("c"),
      model(" "),
    ]);
    assert.deepEqual(slugs, ["a", "c"]);
    const many = Array.from({ length: DEEP_SCAN_MAX_MODELS + 10 }, (_, index) =>
      model(`model-${index}`),
    );
    assert.strictEqual(deepScanModelSlugs(many).length, DEEP_SCAN_MAX_MODELS);
  });

  it("fingerprints the model set, not its order", () => {
    const first = deepScanFingerprint([model("a"), model("b"), model("c")]);
    const reordered = deepScanFingerprint([model("c"), model("a"), model("b")]);
    const changed = deepScanFingerprint([model("a"), model("b")]);
    assert.strictEqual(first, reordered);
    assert.notStrictEqual(first, changed);
    assert.match(first, /^3:[0-9a-f]{8}$/);
  });
});

describe("deep scan ranking", () => {
  it("picks the fastest measured model for fast/cheap tasks", () => {
    const ranked = rankTestedModels({
      speeds: [
        speed("claude-opus-5", 900),
        speed("claude-haiku", 120),
        speed("claude-sonnet-4", 400),
      ],
      providerKind: "claudeAgent",
      taskClass: "fast",
    });
    assert.deepEqual(ranked, ["claude-haiku", "claude-sonnet-4", "claude-opus-5"]);
  });

  it("picks the smartest measured model for coding/reasoning", () => {
    // opus and sonnet-4 share the strong tier, so measured latency breaks the
    // tie in favour of the faster model; the small model stays last.
    const ranked = rankTestedModels({
      speeds: [
        speed("claude-haiku", 120),
        speed("claude-opus-5", 900),
        speed("claude-sonnet-4", 400),
      ],
      providerKind: "claudeAgent",
      taskClass: "coding",
    });
    assert.deepEqual(ranked, ["claude-sonnet-4", "claude-opus-5", "claude-haiku"]);
  });

  it("prefers vision-capable models for vision tasks", () => {
    const ranked = rankTestedModels({
      speeds: [speed("claude-haiku", 100), speed("qwen2-vl-7b", 900)],
      providerKind: "acpRegistry",
      taskClass: "vision",
    });
    assert.strictEqual(ranked[0], "qwen2-vl-7b");
  });

  it("never returns a model the scan proved broken or did not measure", () => {
    const ranked = rankTestedModels({
      speeds: [speed("good-model", 300), speed("broken-model", 100, false)],
      providerKind: "claudeAgent",
      taskClass: "chat",
    });
    assert.deepEqual(ranked, ["good-model"]);
  });

  it("ranks a default-model shortlist without task classification", () => {
    const ranked = rankTestedModelsByDefault({
      speeds: [speed("tiny-model", 90), speed("big-model", 800)],
      providerKind: "acpRegistry",
    });
    assert.strictEqual(ranked.length, 2);
    assert.ok(ranked.includes("tiny-model"));
    assert.ok(ranked.includes("big-model"));
  });
});
