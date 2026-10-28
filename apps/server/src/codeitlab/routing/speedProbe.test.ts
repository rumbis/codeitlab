import { assert, it } from "@effect/vitest";
import { ProviderInstanceId, TextGenerationError } from "@codeitlab/contracts";
import type { ServerProviderModel } from "@codeitlab/contracts";
import type {
  ProviderTextGeneration,
  ThreadTitleGenerationInput,
} from "@codeitlab/provider-core/server/textGeneration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vite-plus/test";

import { probeInstanceModelSpeed, selectProbeModels, speedScoreFromLatency } from "./speedProbe.ts";

const model = (slug: string, isDefault = false, isLegacy = false): ServerProviderModel =>
  ({ slug, name: slug, isDefault, isLegacy }) as unknown as ServerProviderModel;

const textGeneration = (
  handler: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<{ readonly title: string }, TextGenerationError>,
): ProviderTextGeneration =>
  ({
    generateCommitMessage: () => Effect.die("unused"),
    generatePrContent: () => Effect.die("unused"),
    generateBranchName: () => Effect.die("unused"),
    generateThreadTitle: handler,
    generateThreadPurpose: () => Effect.die("unused"),
    generateReviewGuide: () => Effect.die("unused"),
    generateDeliveryHandoff: () => Effect.die("unused"),
  }) as ProviderTextGeneration;

const probe = (generation: ProviderTextGeneration) =>
  probeInstanceModelSpeed({
    textGeneration: generation,
    cwd: process.cwd(),
    instanceId: ProviderInstanceId.make("claude-main"),
    model: "claude-haiku",
  });

const generationError = (detail: string) =>
  new TextGenerationError({ operation: "generateThreadTitle", detail });

describe("speed score mapping", () => {
  it("maps latency linearly between the fast and slow bounds", () => {
    assert.strictEqual(speedScoreFromLatency(0), 1);
    assert.strictEqual(speedScoreFromLatency(800), 1);
    assert.strictEqual(speedScoreFromLatency(4_400), 0.55);
    assert.strictEqual(speedScoreFromLatency(8_000), 0.1);
    assert.strictEqual(speedScoreFromLatency(20_000), 0.1);
    assert.strictEqual(speedScoreFromLatency(Number.NaN), 1);
  });

  it("is monotonically non-increasing and stays in 0.1..1", () => {
    let previous = speedScoreFromLatency(0);
    for (let latencyMs = 0; latencyMs <= 10_000; latencyMs += 250) {
      const score = speedScoreFromLatency(latencyMs);
      assert.ok(score <= previous, `score grew at ${latencyMs} ms`);
      assert.ok(score >= 0.1 && score <= 1);
      previous = score;
    }
  });
});

describe("probe model selection", () => {
  const models = [
    model("claude-haiku"),
    model("claude-opus-5", true),
    model("claude-sonnet-4"),
    model("claude-legacy", false, true),
  ];

  it("prefers the scorer's seed models (smartest, fastest, default)", () => {
    assert.deepEqual(
      selectProbeModels({
        models,
        providerKind: "claudeAgent",
        taskClass: "coding",
        limit: 3,
      }),
      ["claude-opus-5", "claude-haiku", "claude-sonnet-4"],
    );
  });

  it("skips legacy models and bounds the probe count", () => {
    const one = selectProbeModels({
      models,
      providerKind: "claudeAgent",
      taskClass: "coding",
      limit: 1,
    });
    assert.strictEqual(one.length, 1);
    assert.deepEqual(one, ["claude-opus-5"]);

    const all = selectProbeModels({
      models,
      providerKind: "claudeAgent",
      taskClass: "coding",
      limit: 10,
    });
    assert.strictEqual(all.includes("claude-legacy"), false);
    assert.strictEqual(all.length, 3);

    // A malformed setting must not turn into an unbounded probe.
    const clamped = selectProbeModels({
      models,
      providerKind: "claudeAgent",
      taskClass: "coding",
      limit: Number.NaN,
    });
    assert.strictEqual(clamped.length, 3);
  });
});

describe("model speed probing", () => {
  it.effect("measures a successful turn", () =>
    Effect.gen(function* () {
      const result = yield* probe(textGeneration(() => Effect.succeed({ title: "hi" })));
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.model, "claude-haiku");
      assert.strictEqual(result.latencyMs, 0);
      assert.strictEqual(result.error, undefined);
    }),
  );

  it.effect("retries a failing model once and keeps the retry latency", () =>
    Effect.gen(function* () {
      let calls = 0;
      const generation = textGeneration(() => {
        calls += 1;
        return calls === 1
          ? Effect.fail(generationError("transient hiccup"))
          : Effect.succeed({ title: "hi" });
      });
      const result = yield* probe(generation);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(calls, 2);
    }),
  );

  it.effect("records ok:false with the retry error after two failures", () =>
    Effect.gen(function* () {
      let calls = 0;
      const generation = textGeneration(() => {
        calls += 1;
        return Effect.fail(generationError("provider is down"));
      });
      const result = yield* probe(generation);
      assert.strictEqual(result.ok, false);
      assert.strictEqual(calls, 2);
      assert.match(result.error ?? "", /provider is down/);
    }),
  );

  it.effect("times each attempt out instead of hanging the probe", () =>
    Effect.gen(function* () {
      let calls = 0;
      const generation = textGeneration(() => {
        calls += 1;
        return Effect.never;
      });
      const fiber = yield* probe(generation).pipe(Effect.forkChild);
      // Two attempts, each abandoned after the 20 s per-attempt timeout.
      yield* TestClock.adjust("21 seconds");
      yield* TestClock.adjust("21 seconds");
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(calls, 2);
      assert.strictEqual(result.ok, false);
      assert.match(result.error ?? "", /timed out/i);
    }),
  );
});
