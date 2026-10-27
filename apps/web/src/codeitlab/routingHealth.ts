import type { RoutingHealth, RoutingHealthEntry, RoutingHealthStatus } from "@codeitlab/contracts";
import { codeitlabProviderName } from "./providerLabels";

/**
 * Display logic for the quota-health panel. The server owns probing and
 * scheduling; this module only turns a `RoutingHealth` snapshot into labels,
 * tones and relative times so the page stays free of branching.
 */

export const HEALTH_INTERVAL_OPTIONS: ReadonlyArray<number> = [0, 5, 15, 30, 60];

/** Model-count choices for the "models per provider to probe" setting. */
export const SPEED_PROBE_MODEL_OPTIONS: ReadonlyArray<number> = [1, 2, 3, 5, 8, 10];

/** Parallel probes the deep model scan runs at once. */
export const DEEP_SCAN_CONCURRENCY_OPTIONS: ReadonlyArray<number> = [1, 2, 4, 8, 12, 16];

/** Per-model timeout for the deep model scan, in seconds. */
export const DEEP_SCAN_TIMEOUT_OPTIONS: ReadonlyArray<number> = [5, 8, 12, 20, 30, 60];

/** One measured model speed from the server's one-word `hi` probe. */
export type RoutingModelSpeed = NonNullable<RoutingHealthEntry["speeds"]>[number];

type HealthBadgeVariant = "success" | "warning" | "error" | "secondary";

const STATUS_LABELS: Readonly<Record<RoutingHealthStatus, string>> = {
  ok: "Healthy",
  degraded: "Low quota",
  "quota-exhausted": "Quota spent",
  unauthenticated: "Signed out",
  missing: "Not installed",
  error: "Failing",
  disabled: "Disabled",
};

const STATUS_TONES: Readonly<Record<RoutingHealthStatus, HealthBadgeVariant>> = {
  ok: "success",
  degraded: "warning",
  "quota-exhausted": "warning",
  unauthenticated: "error",
  missing: "error",
  error: "error",
  disabled: "secondary",
};

export function healthStatusLabel(status: RoutingHealthStatus): string {
  return STATUS_LABELS[status];
}

export function healthStatusVariant(status: RoutingHealthStatus): HealthBadgeVariant {
  return STATUS_TONES[status];
}

export function formatHealthInterval(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "Off";
  if (minutes === 60) return "Every hour";
  return `Every ${Math.round(minutes)} min`;
}

const parseTimestamp = (iso: string): number | null => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
};

const formatElapsed = (elapsedMs: number): string => {
  const seconds = Math.max(0, Math.round(elapsedMs / 1_000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h ago` : `${hours} h ${rest} min ago`;
};

/** How long ago the last probe finished; `never` for a missing/invalid timestamp. */
export function formatHealthAge(iso: string, nowMs: number): string {
  const value = parseTimestamp(iso);
  if (value === null) return "never";
  return formatElapsed(nowMs - value);
}

/** When the next scheduled probe is due; past or invalid timestamps read `due now`. */
export function formatNextCheck(iso: string, nowMs: number): string {
  const value = parseTimestamp(iso);
  if (value === null) return "due now";
  const remainingMs = value - nowMs;
  if (remainingMs <= 0) return "due now";
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours} h` : `in ${hours} h ${rest} min`;
}

/** Probe round-trip; `null` when the provider never answered. */
export function formatHealthLatency(latencyMs: number | undefined): string | null {
  if (latencyMs === undefined || !Number.isFinite(latencyMs) || latencyMs < 0) return null;
  if (latencyMs < 1_000) return `${Math.round(latencyMs)} ms`;
  return `${(latencyMs / 1_000).toFixed(1)} s`;
}

export function formatModelCount(count: number): string {
  return `${Math.max(0, Math.round(count)).toLocaleString("en-US")} models`;
}

/** Measured model latency: `840 ms` under a second, `1.2 s` above it. */
export function formatModelLatency(latencyMs: number): string {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return "—";
  if (latencyMs < 1_000) return `${Math.round(latencyMs)} ms`;
  return `${(latencyMs / 1_000).toFixed(1)} s`;
}

/**
 * The fastest successful measurement. Failed models keep their failure latency,
 * but they are not "fast" and never win the badge or the summary.
 */
export function fastestSpeed(
  speeds: ReadonlyArray<RoutingModelSpeed> | undefined,
): RoutingModelSpeed | null {
  if (speeds === undefined) return null;
  let fastest: RoutingModelSpeed | null = null;
  for (const speed of speeds) {
    if (!speed.ok || !Number.isFinite(speed.latencyMs) || speed.latencyMs < 0) continue;
    if (fastest === null || speed.latencyMs < fastest.latencyMs) fastest = speed;
  }
  return fastest;
}

export interface SpeedProbeChecking {
  readonly checked: number;
  readonly total: number;
  readonly providers: number;
}

/**
 * Progress for the "Checking all harness and models…" banner. The aggregate
 * field wins; when a snapshot only carries per-provider probes, their totals are
 * summed so an older health.json still shows movement.
 */
export function speedProbeChecking(health: RoutingHealth): SpeedProbeChecking | null {
  const entryProbes = health.entries.flatMap((entry) =>
    entry.speedProbe === undefined ? [] : [entry.speedProbe],
  );
  const aggregate = health.speedProbe;
  const isChecking =
    aggregate?.status === "checking" || entryProbes.some((probe) => probe.status === "checking");
  if (!isChecking) return null;
  const checked = aggregate?.checked ?? entryProbes.reduce((sum, probe) => sum + probe.checked, 0);
  const total = aggregate?.total ?? entryProbes.reduce((sum, probe) => sum + probe.total, 0);
  const providers =
    entryProbes.length > 0
      ? entryProbes.length
      : health.entries.filter((entry) => entry.status === "ok" || entry.status === "degraded")
          .length;
  return { checked, total, providers };
}

/**
 * One-line summary once the probe finishes. `null` while it is still running,
 * when it is off, or when the snapshot carries no measurements. `models` counts
 * every probed model (failed probes were measured too); only successful ones
 * can be the fastest.
 */
export function speedProbeSummary(health: RoutingHealth): string | null {
  const status = health.speedProbe?.status;
  if (status !== undefined && status !== "done" && status !== "partial") return null;
  const measured = health.entries.filter((entry) => (entry.speeds?.length ?? 0) > 0);
  const models = measured.reduce((sum, entry) => sum + (entry.speeds?.length ?? 0), 0);
  if (models === 0) return null;
  const providers = measured.length;
  const base = `Measured ${models} ${models === 1 ? "model" : "models"} in ${providers} ${
    providers === 1 ? "provider" : "providers"
  }`;
  let fastest: { readonly name: string; readonly speed: RoutingModelSpeed } | null = null;
  for (const entry of measured) {
    const speed = fastestSpeed(entry.speeds);
    if (speed === null) continue;
    if (fastest === null || speed.latencyMs < fastest.speed.latencyMs) {
      fastest = { name: codeitlabProviderName(entry.name), speed };
    }
  }
  if (fastest === null) return base;
  return `${base} · fastest: ${fastest.name} · ${formatModelLatency(fastest.speed.latencyMs)}`;
}

export interface DeepScanProgress {
  readonly checked: number;
  readonly total: number;
  readonly ok: number;
  readonly failed: number;
  readonly providers: number;
  readonly percent: number;
}

/**
 * Progress for the first-run "Scanning every model…" banner. The aggregate
 * field wins; when a snapshot only carries per-provider deep scans, their
 * totals are summed so an older health.json still shows movement.
 */
export function deepScanProgress(health: RoutingHealth): DeepScanProgress | null {
  const entryProbes = health.entries.flatMap((entry) =>
    entry.speedProbe?.mode === "deep" ? [entry.speedProbe] : [],
  );
  const aggregate = health.speedProbe?.mode === "deep" ? health.speedProbe : undefined;
  if (aggregate === undefined && entryProbes.length === 0) return null;
  const checking =
    aggregate?.status === "checking" || entryProbes.some((probe) => probe.status === "checking");
  if (!checking) return null;
  const checked = aggregate?.checked ?? entryProbes.reduce((sum, probe) => sum + probe.checked, 0);
  const total = aggregate?.total ?? entryProbes.reduce((sum, probe) => sum + probe.total, 0);
  const ok =
    aggregate?.okCount ?? entryProbes.reduce((sum, probe) => sum + (probe.okCount ?? 0), 0);
  const failed =
    aggregate?.failedCount ?? entryProbes.reduce((sum, probe) => sum + (probe.failedCount ?? 0), 0);
  const providers = entryProbes.length > 0 ? entryProbes.length : health.entries.length;
  return {
    checked,
    total,
    ok,
    failed,
    providers,
    percent: total === 0 ? 0 : Math.min(100, Math.round((checked / total) * 100)),
  };
}

/**
 * One-line summary after a deep scan finishes: how many advertised models
 * answered, how many failed, and the fastest one that answered.
 */
export function deepScanSummary(health: RoutingHealth): string | null {
  const aggregate = health.speedProbe;
  if (aggregate?.mode !== "deep") return null;
  if (aggregate.status !== "done" && aggregate.status !== "partial") return null;
  const total = aggregate.total;
  if (total === 0) return null;
  const ok = aggregate.okCount ?? 0;
  const failed = aggregate.failedCount ?? total - ok;
  const providers = health.entries.filter((entry) => entry.speedProbe?.mode === "deep").length;
  const base = `Scanned ${total} ${total === 1 ? "model" : "models"} in ${providers} ${
    providers === 1 ? "provider" : "providers"
  } · ${ok} available${failed === 0 ? "" : ` · ${failed} failed`}`;
  let fastest: { readonly name: string; readonly speed: RoutingModelSpeed } | null = null;
  for (const entry of health.entries) {
    const speed = fastestSpeed(entry.speeds);
    if (speed === null) continue;
    if (fastest === null || speed.latencyMs < fastest.speed.latencyMs) {
      fastest = { name: codeitlabProviderName(entry.name), speed };
    }
  }
  return fastest === null
    ? base
    : `${base} · fastest: ${fastest.name} · ${formatModelLatency(fastest.speed.latencyMs)}`;
}

/** Per-provider line for the health list: what the last deep scan found. */
export function providerScanSummary(entry: RoutingHealthEntry): string | null {
  const probe = entry.speedProbe;
  if (probe === undefined || probe.mode !== "deep") return null;
  const ok = probe.okCount ?? (entry.speeds ?? []).filter((speed) => speed.ok).length;
  if (probe.status === "checking") return `deep scan ${probe.checked}/${probe.total}`;
  return `deep scan · ${ok}/${probe.total} available`;
}
