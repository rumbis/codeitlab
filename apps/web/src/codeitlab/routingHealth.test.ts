import { assert, it } from "@effect/vitest";
import type { RoutingHealth, RoutingHealthEntry } from "@codeitlab/contracts";
import { describe } from "vite-plus/test";

import {
  fastestSpeed,
  formatHealthAge,
  formatHealthInterval,
  formatHealthLatency,
  formatModelCount,
  formatModelLatency,
  formatNextCheck,
  HEALTH_INTERVAL_OPTIONS,
  healthStatusLabel,
  healthStatusVariant,
  SPEED_PROBE_MODEL_OPTIONS,
  deepScanProgress,
  deepScanSummary,
  DEEP_SCAN_CONCURRENCY_OPTIONS,
  DEEP_SCAN_TIMEOUT_OPTIONS,
  providerScanSummary,
  speedProbeChecking,
  speedProbeSummary,
} from "./routingHealth.ts";

const NOW = Date.parse("2026-10-23T02:00:00.000Z");
const CHECKED_AT = "2026-10-23T01:59:00.000Z";

function healthEntry(
  input: Partial<RoutingHealthEntry> & Pick<RoutingHealthEntry, "providerInstanceId" | "name">,
): RoutingHealthEntry {
  return {
    providerKind: "codex",
    ok: true,
    status: "ok",
    quota: 0.7,
    models: 4,
    ...input,
  };
}

function health(input: {
  readonly speedProbe?: RoutingHealth["speedProbe"];
  readonly entries: ReadonlyArray<RoutingHealthEntry>;
}): RoutingHealth {
  return {
    checkedAt: CHECKED_AT,
    intervalMinutes: 30,
    nextCheckAt: "2026-10-23T02:29:00.000Z",
    source: "manual",
    ...(input.speedProbe === undefined ? {} : { speedProbe: input.speedProbe }),
    entries: input.entries,
  };
}

describe("routing health display", () => {
  it("labels every status", () => {
    assert.strictEqual(healthStatusLabel("ok"), "Healthy");
    assert.strictEqual(healthStatusLabel("degraded"), "Low quota");
    assert.strictEqual(healthStatusLabel("quota-exhausted"), "Quota spent");
    assert.strictEqual(healthStatusLabel("unauthenticated"), "Signed out");
    assert.strictEqual(healthStatusLabel("missing"), "Not installed");
    assert.strictEqual(healthStatusLabel("error"), "Failing");
    assert.strictEqual(healthStatusLabel("disabled"), "Disabled");
  });

  it("maps statuses to badge variants", () => {
    assert.strictEqual(healthStatusVariant("ok"), "success");
    assert.strictEqual(healthStatusVariant("degraded"), "warning");
    assert.strictEqual(healthStatusVariant("quota-exhausted"), "warning");
    assert.strictEqual(healthStatusVariant("unauthenticated"), "error");
    assert.strictEqual(healthStatusVariant("missing"), "error");
    assert.strictEqual(healthStatusVariant("error"), "error");
    assert.strictEqual(healthStatusVariant("disabled"), "secondary");
  });

  it("offers the interval choices and formats them", () => {
    assert.deepEqual([...HEALTH_INTERVAL_OPTIONS], [0, 5, 15, 30, 60]);
    assert.strictEqual(formatHealthInterval(0), "Off");
    assert.strictEqual(formatHealthInterval(-5), "Off");
    assert.strictEqual(formatHealthInterval(Number.NaN), "Off");
    assert.strictEqual(formatHealthInterval(5), "Every 5 min");
    assert.strictEqual(formatHealthInterval(30), "Every 30 min");
    assert.strictEqual(formatHealthInterval(60), "Every hour");
    assert.strictEqual(formatHealthInterval(90), "Every 90 min");
  });

  it("formats the age of the last check", () => {
    assert.strictEqual(formatHealthAge("2026-10-23T01:59:30.000Z", NOW), "just now");
    assert.strictEqual(formatHealthAge("2026-10-23T01:56:00.000Z", NOW), "4 min ago");
    assert.strictEqual(formatHealthAge("2026-10-23T00:48:00.000Z", NOW), "1 h 12 min ago");
    assert.strictEqual(formatHealthAge("2026-10-22T02:00:00.000Z", NOW), "24 h ago");
    assert.strictEqual(formatHealthAge("not-a-date", NOW), "never");
  });

  it("formats when the next check is due", () => {
    assert.strictEqual(formatNextCheck("2026-10-23T02:28:00.000Z", NOW), "in 28 min");
    assert.strictEqual(formatNextCheck("2026-10-23T02:02:00.000Z", NOW), "in 2 min");
    assert.strictEqual(formatNextCheck("2026-10-23T01:59:00.000Z", NOW), "due now");
    assert.strictEqual(formatNextCheck("not-a-date", NOW), "due now");
    assert.strictEqual(formatNextCheck("2026-10-23T03:30:00.000Z", NOW), "in 1 h 30 min");
  });

  it("formats probe latency", () => {
    assert.strictEqual(formatHealthLatency(undefined), null);
    assert.strictEqual(formatHealthLatency(Number.NaN), null);
    assert.strictEqual(formatHealthLatency(-1), null);
    assert.strictEqual(formatHealthLatency(0), "0 ms");
    assert.strictEqual(formatHealthLatency(840), "840 ms");
    assert.strictEqual(formatHealthLatency(1_840), "1.8 s");
  });

  it("formats model counts", () => {
    assert.strictEqual(formatModelCount(2_899), "2,899 models");
    assert.strictEqual(formatModelCount(0), "0 models");
    assert.strictEqual(formatModelCount(-3), "0 models");
  });

  it("formats measured model latency", () => {
    assert.strictEqual(formatModelLatency(Number.NaN), "—");
    assert.strictEqual(formatModelLatency(-1), "—");
    assert.strictEqual(formatModelLatency(0), "0 ms");
    assert.strictEqual(formatModelLatency(840), "840 ms");
    assert.strictEqual(formatModelLatency(999.4), "999 ms");
    assert.strictEqual(formatModelLatency(1_200), "1.2 s");
    assert.strictEqual(formatModelLatency(1_840), "1.8 s");
  });

  it("picks the fastest successful model speed", () => {
    assert.strictEqual(fastestSpeed(undefined), null);
    assert.strictEqual(fastestSpeed([]), null);
    assert.strictEqual(
      fastestSpeed([
        { model: "slow", latencyMs: 4_000, ok: false, checkedAt: CHECKED_AT },
        { model: "broken", latencyMs: 200, ok: false, checkedAt: CHECKED_AT },
      ]),
      null,
    );
    const fastest = fastestSpeed([
      { model: "qwen3-coder", latencyMs: 2_400, ok: true, checkedAt: CHECKED_AT },
      { model: "deepseek-v4", latencyMs: 840, ok: true, checkedAt: CHECKED_AT },
      { model: "gpt-5", latencyMs: 1_200, ok: true, checkedAt: CHECKED_AT },
    ]);
    assert.strictEqual(fastest?.model, "deepseek-v4");
  });

  it("summarizes a finished speed probe", () => {
    const measured = health({
      speedProbe: {
        status: "done",
        startedAt: CHECKED_AT,
        finishedAt: CHECKED_AT,
        checked: 3,
        total: 3,
      },
      entries: [
        healthEntry({
          providerInstanceId: "hermes",
          name: "Hermes",
          speeds: [
            { model: "deepseek-v4", latencyMs: 840, ok: true, checkedAt: CHECKED_AT },
            { model: "qwen3-coder", latencyMs: 2_400, ok: true, checkedAt: CHECKED_AT },
          ],
        }),
        healthEntry({
          providerInstanceId: "codex",
          name: "Codex",
          speeds: [{ model: "gpt-5", latencyMs: 1_200, ok: true, checkedAt: CHECKED_AT }],
        }),
      ],
    });
    assert.strictEqual(
      speedProbeSummary(measured),
      "Measured 3 models in 2 providers · fastest: CodeItLab Hermes · 840 ms",
    );

    const single = health({
      speedProbe: {
        status: "done",
        startedAt: CHECKED_AT,
        finishedAt: CHECKED_AT,
        checked: 1,
        total: 1,
      },
      entries: [
        healthEntry({
          providerInstanceId: "hermes",
          name: "Hermes",
          speeds: [{ model: "deepseek-v4", latencyMs: 1_840, ok: true, checkedAt: CHECKED_AT }],
        }),
      ],
    });
    assert.strictEqual(
      speedProbeSummary(single),
      "Measured 1 model in 1 provider · fastest: CodeItLab Hermes · 1.8 s",
    );

    const allFailed = health({
      speedProbe: {
        status: "partial",
        startedAt: CHECKED_AT,
        finishedAt: CHECKED_AT,
        checked: 2,
        total: 2,
      },
      entries: [
        healthEntry({
          providerInstanceId: "hermes",
          name: "Hermes",
          speeds: [
            {
              model: "deepseek-v4",
              latencyMs: 2_000,
              ok: false,
              checkedAt: CHECKED_AT,
              error: "timed out",
            },
          ],
        }),
      ],
    });
    assert.strictEqual(speedProbeSummary(allFailed), "Measured 1 model in 1 provider");
  });

  it("hides the summary while the probe runs or is off", () => {
    const entry = healthEntry({
      providerInstanceId: "hermes",
      name: "Hermes",
      speeds: [{ model: "deepseek-v4", latencyMs: 840, ok: true, checkedAt: CHECKED_AT }],
    });
    assert.strictEqual(
      speedProbeSummary(
        health({
          speedProbe: { status: "checking", startedAt: CHECKED_AT, checked: 0, total: 1 },
          entries: [entry],
        }),
      ),
      null,
    );
    assert.strictEqual(
      speedProbeSummary(
        health({
          speedProbe: { status: "off", startedAt: CHECKED_AT, checked: 0, total: 0 },
          entries: [entry],
        }),
      ),
      null,
    );
    assert.strictEqual(speedProbeSummary(health({ entries: [] })), null);
    // A snapshot without an aggregate still summarizes measured speeds.
    assert.strictEqual(
      speedProbeSummary(health({ entries: [entry] })),
      "Measured 1 model in 1 provider · fastest: CodeItLab Hermes · 840 ms",
    );
  });

  it("reports speed-probe progress while checking", () => {
    assert.strictEqual(speedProbeChecking(health({ entries: [] })), null);

    const aggregateOnly = health({
      speedProbe: { status: "checking", startedAt: CHECKED_AT, checked: 2, total: 6 },
      entries: [
        healthEntry({ providerInstanceId: "hermes", name: "Hermes" }),
        healthEntry({ providerInstanceId: "codex", name: "Codex" }),
        healthEntry({ providerInstanceId: "cursor", name: "Cursor", status: "error", ok: false }),
      ],
    });
    assert.deepEqual(speedProbeChecking(aggregateOnly), { checked: 2, total: 6, providers: 2 });

    const entryOnly = health({
      entries: [
        healthEntry({
          providerInstanceId: "hermes",
          name: "Hermes",
          speedProbe: { status: "checking", startedAt: CHECKED_AT, checked: 1, total: 3 },
        }),
        healthEntry({
          providerInstanceId: "codex",
          name: "Codex",
          speedProbe: { status: "done", startedAt: CHECKED_AT, checked: 2, total: 2 },
        }),
      ],
    });
    assert.deepEqual(speedProbeChecking(entryOnly), { checked: 3, total: 5, providers: 2 });
    assert.deepEqual([...SPEED_PROBE_MODEL_OPTIONS], [1, 2, 3, 5, 8, 10]);
  });
});

describe("deep model scan display", () => {
  const deepEntry = (input: {
    readonly status: "checking" | "done";
    readonly checked: number;
    readonly total: number;
    readonly okCount?: number;
    readonly failedCount?: number;
  }) =>
    healthEntry({
      providerInstanceId: "hermes",
      name: "Hermes",
      providerKind: "acpRegistry",
      models: input.total,
      speeds:
        input.status === "done"
          ? [
              { model: "deepseek-v4", latencyMs: 640, ok: true, checkedAt: CHECKED_AT },
              { model: "broken", latencyMs: 9_000, ok: false, checkedAt: CHECKED_AT },
            ]
          : [],
      speedProbe: {
        status: input.status,
        mode: "deep",
        startedAt: CHECKED_AT,
        ...(input.status === "done" ? { finishedAt: CHECKED_AT } : {}),
        checked: input.checked,
        total: input.total,
        modelCount: input.total,
        ...(input.okCount === undefined ? {} : { okCount: input.okCount }),
        ...(input.failedCount === undefined ? {} : { failedCount: input.failedCount }),
      },
    });

  it("reports progress from the aggregate deep-scan snapshot", () => {
    const snapshot = health({
      speedProbe: {
        status: "checking",
        mode: "deep",
        startedAt: CHECKED_AT,
        checked: 420,
        total: 2_210,
        okCount: 300,
        failedCount: 120,
      },
      entries: [deepEntry({ status: "checking", checked: 420, total: 2_210 })],
    });
    assert.deepEqual(deepScanProgress(snapshot), {
      checked: 420,
      total: 2_210,
      ok: 300,
      failed: 120,
      providers: 1,
      percent: 19,
    });
    assert.strictEqual(deepScanProgress(health({ entries: [] })), null);
  });

  it("summarises a finished deep scan with available/failed/fastest", () => {
    const snapshot = health({
      speedProbe: {
        status: "done",
        mode: "deep",
        startedAt: CHECKED_AT,
        finishedAt: CHECKED_AT,
        checked: 2_210,
        total: 2_210,
        okCount: 1_900,
        failedCount: 310,
      },
      entries: [deepEntry({ status: "done", checked: 2_210, total: 2_210, okCount: 1_900 })],
    });
    const summary = deepScanSummary(snapshot);
    assert.match(summary ?? "", /Scanned 2210 models in 1 provider/);
    assert.match(summary ?? "", /1900 available/);
    assert.match(summary ?? "", /310 failed/);
    assert.match(summary ?? "", /fastest: CodeItLab Hermes · 640 ms/);
    assert.strictEqual(deepScanSummary(health({ entries: [] })), null);
  });

  it("describes one provider's deep scan row", () => {
    assert.strictEqual(
      providerScanSummary(deepEntry({ status: "checking", checked: 420, total: 2_210 })),
      "deep scan 420/2210",
    );
    assert.strictEqual(
      providerScanSummary(
        deepEntry({ status: "done", checked: 2_210, total: 2_210, okCount: 1_900 }),
      ),
      "deep scan · 1900/2210 available",
    );
    assert.strictEqual(
      providerScanSummary(healthEntry({ providerInstanceId: "codex", name: "Codex" })),
      null,
    );
  });

  it("exposes the deep-scan tuning options", () => {
    assert.deepEqual([...DEEP_SCAN_CONCURRENCY_OPTIONS], [1, 2, 4, 8, 12, 16]);
    assert.deepEqual([...DEEP_SCAN_TIMEOUT_OPTIONS], [5, 8, 12, 20, 30, 60]);
  });
});
