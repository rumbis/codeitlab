import type { ServerProvider, ServerProviderModel } from "@codeitlab/contracts";
import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import {
  clampHealthIntervalMinutes,
  healthVerdict,
  MAX_SEED_MODELS_PER_PROVIDER,
  nextCheckAtMs,
  seedModelsForTask,
} from "./health.ts";

const model = (slug: string, isDefault = false): ServerProviderModel =>
  ({ slug, name: slug, isDefault }) as unknown as ServerProviderModel;

const snapshot = (input: {
  readonly models?: ReadonlyArray<ServerProviderModel>;
  readonly usedPercent?: number;
  readonly installed?: boolean;
  readonly enabled?: boolean;
  readonly status?: "ready" | "error";
  readonly availability?: "available" | "unavailable";
  readonly auth?: "authenticated" | "unauthenticated";
}): ServerProvider =>
  ({
    enabled: input.enabled ?? true,
    installed: input.installed ?? true,
    status: input.status ?? "ready",
    availability: input.availability ?? "available",
    auth: { status: input.auth ?? "authenticated" },
    models: input.models ?? [],
    ...(input.usedPercent === undefined
      ? {}
      : {
          usageLimits: {
            windows: [{ id: "session", label: "Session", usedPercent: input.usedPercent }],
          },
        }),
  }) as unknown as ServerProvider;

describe("routing health helpers", () => {
  it("clamps the check interval and treats zero as disabled", () => {
    assert.strictEqual(clampHealthIntervalMinutes(30), 30);
    assert.strictEqual(clampHealthIntervalMinutes(0), 0);
    assert.strictEqual(clampHealthIntervalMinutes(-5), 0);
    assert.strictEqual(clampHealthIntervalMinutes(Number.NaN), 0);
    assert.strictEqual(clampHealthIntervalMinutes(1), 5);
    assert.strictEqual(clampHealthIntervalMinutes(60.4), 60);
    assert.strictEqual(clampHealthIntervalMinutes(10_000), 1_440);
  });

  it("computes the next check timestamp", () => {
    assert.strictEqual(nextCheckAtMs(1_000, 30), 1_000 + 30 * 60_000);
    assert.strictEqual(nextCheckAtMs(1_000, 0), 1_000);
  });

  it("classifies provider snapshots into routable health verdicts", () => {
    assert.deepEqual(healthVerdict({ enabled: true, snapshot: snapshot({}) }), {
      ok: true,
      status: "ok",
    });
    assert.strictEqual(
      healthVerdict({ enabled: false, snapshot: snapshot({}) }).status,
      "disabled",
    );
    assert.strictEqual(
      healthVerdict({ enabled: true, snapshot: snapshot({ installed: false }) }).status,
      "missing",
    );
    assert.strictEqual(
      healthVerdict({ enabled: true, snapshot: snapshot({ auth: "unauthenticated" }) }).status,
      "unauthenticated",
    );
    assert.strictEqual(
      healthVerdict({ enabled: true, snapshot: snapshot({ status: "error" }) }).status,
      "error",
    );
    assert.strictEqual(
      healthVerdict({ enabled: true, snapshot: snapshot({ availability: "unavailable" }) }).status,
      "error",
    );
    assert.strictEqual(
      healthVerdict({ enabled: true, snapshot: snapshot({ usedPercent: 100 }) }).status,
      "quota-exhausted",
    );
    const low = healthVerdict({ enabled: true, snapshot: snapshot({ usedPercent: 95 }) });
    assert.strictEqual(low.ok, true);
    assert.strictEqual(low.status, "degraded");
    assert.strictEqual(
      healthVerdict({
        enabled: true,
        snapshot: snapshot({}),
        failure: "probe timed out",
      }).status,
      "error",
    );
  });

  it("seeds the task's best smart and fast models without flooding the candidate list", () => {
    const models = [
      model("claude-opus-5.5", true),
      model("claude-haiku"),
      model("claude-sonnet-5"),
    ];

    const coding = seedModelsForTask(models, "claudeAgent", "coding");
    assert.strictEqual(coding[0], "claude-opus-5.5");
    assert.strictEqual(coding.length <= MAX_SEED_MODELS_PER_PROVIDER, true);
    assert.strictEqual(new Set(coding).size, coding.length);

    const fast = seedModelsForTask(models, "claudeAgent", "fast");
    assert.strictEqual(fast[0], "claude-haiku");

    assert.deepEqual(seedModelsForTask([], "codex", "coding"), []);
    assert.deepEqual(
      seedModelsForTask(
        [{ slug: "legacy", isLegacy: true } as unknown as ServerProviderModel],
        "codex",
        "coding",
      ),
      [],
    );
  });
});
