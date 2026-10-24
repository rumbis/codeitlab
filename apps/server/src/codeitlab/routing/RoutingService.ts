import { CodeitlabServiceError } from "@codeitlab/core";
import type {
  RoutingCandidate,
  RoutingCatalog,
  RoutingDecideInput,
  RoutingDecision,
  RoutingHealth,
  RoutingHealthEntry,
  TaskClass,
} from "@codeitlab/core/routing";
import {
  RoutingDecision as RoutingDecisionSchema,
  RoutingHealth as RoutingHealthSchema,
} from "@codeitlab/core/routing";
import { RoutingService as RoutingServiceTag } from "@codeitlab/core/services";
import { codeitlabAgentLabel, isAutoRouteSelection, ProviderInstanceId } from "@t3tools/contracts";
import type { ServerProvider, ServerSettings as ServerSettingsType } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { HttpClient } from "effect/http";

import * as ServerConfig from "../../config.ts";
import * as ProviderInstanceRegistry from "../../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../../serverSettings.ts";
import { classifyTask } from "./classify.ts";
import {
  clampHealthIntervalMinutes,
  DEFAULT_HEALTH_CHECK_MINUTES,
  healthVerdict,
  nextCheckAtMs,
  seedModelsForTask,
} from "./health.ts";
import { registerActiveRoutingService } from "./activeRoutingService.ts";
import { decideRouteEnforcement } from "./enforcement.ts";
import {
  probeInstanceModelSpeed,
  selectProbeModels,
  speedScoreFromLatency,
  type SpeedProbeResult,
} from "./speedProbe.ts";
import { isProviderCoolingDown } from "./providerFailures.ts";
import {
  clampDeepScanConcurrency,
  clampDeepScanTimeoutSeconds,
  DEEP_SCAN_REFRESH_MS,
  deepScanFingerprint,
  deepScanModelSlugs,
  rankTestedModels,
  rankTestedModelsByDefault,
} from "./deepScan.ts";
import {
  discoverOmniRouteModels,
  OMNIROUTE_VIRTUAL_MODEL_BY_TASK,
  omniRouteVirtualModels,
  type OmniRouteDiscovery,
} from "./OmniRoute.ts";
import {
  bestProviderTier,
  chooseCandidate,
  DEFAULT_ROUTING_WEIGHTS,
  defaultModel,
  modelTier,
  remainingQuota,
  scoreCandidates,
  taskClassTier,
  weightsForTask,
  type CandidateSeed,
} from "./scoring.ts";

/**
 * OmniRoute-style auto-routing. The service collects candidates from the live
 * provider registry (availability, usage-limit headroom, model list), optionally
 * adds the OmniRoute gateway's virtual models, scores them with the user's
 * quota/smartness/speed weights, records the decision, and explains it.
 */

const MAX_HISTORY_ENTRIES = 200;
const OMNIROUTE_DISCOVERY_TTL_MS = 5 * 60_000;

const decodeHistoryLine = Schema.decodeUnknownOption(Schema.fromJsonString(RoutingDecisionSchema));
const encodeHistoryLine = Schema.encodeSync(Schema.fromJsonString(RoutingDecisionSchema));
const decodeHealthFile = Schema.decodeUnknownOption(Schema.fromJsonString(RoutingHealthSchema));
const encodeHealthFile = Schema.encodeSync(Schema.fromJsonString(RoutingHealthSchema));

const describeProbeFailure = (cause: unknown): string => {
  if (cause instanceof Error && cause.message.trim().length > 0) return cause.message.trim();
  return "Provider probe failed.";
};

type RoutingSettings = ServerSettingsType["codeitlab"]["routing"];

type SpeedProbeState = NonNullable<RoutingHealth["speedProbe"]>;
type ProviderSpeedProbeState = NonNullable<RoutingHealthEntry["speedProbe"]>;
type SpeedMeasurement = NonNullable<RoutingHealthEntry["speeds"]>[number];

/** The health check has no prompt, so speed probes use the coding seed set. */
const SPEED_PROBE_TASK_CLASS: TaskClass = "coding";
/** The whole speed probe is abandoned after this long; provider verdicts stay. */
const SPEED_PROBE_TIMEOUT = "90 seconds";
/** Providers probed in parallel; models inside a provider run sequentially. */
const SPEED_PROBE_PROVIDER_CONCURRENCY = 2;

const formatIsoAt = (atMs: number): string => DateTime.formatIso(DateTime.makeUnsafe(atMs));

const speedProbeStatus = (input: {
  readonly checked: number;
  readonly failed: number;
  readonly total: number;
  readonly timedOut: boolean;
}): SpeedProbeState["status"] => {
  if (input.timedOut) return input.checked > 0 ? "partial" : "error";
  if (input.total === 0 || input.failed === 0) return "done";
  return input.failed < input.checked ? "partial" : "error";
};

const speedMeasurements = (
  entries: ReadonlyArray<RoutingHealthEntry>,
): ReadonlyArray<SpeedMeasurement> => entries.flatMap((entry) => entry.speeds ?? []);

const fastestMeasurement = (
  entries: ReadonlyArray<RoutingHealthEntry>,
): { providerInstanceId: string; model: string; latencyMs: number } | undefined => {
  let fastest: { providerInstanceId: string; model: string; latencyMs: number } | undefined;
  for (const entry of entries) {
    for (const speed of entry.speeds ?? []) {
      if (!speed.ok) continue;
      if (fastest === undefined || speed.latencyMs < fastest.latencyMs) {
        fastest = {
          providerInstanceId: entry.providerInstanceId,
          model: speed.model,
          latencyMs: speed.latencyMs,
        };
      }
    }
  }
  return fastest;
};

const providerIsAvailable = (instanceEnabled: boolean, snapshot: ServerProvider): boolean =>
  instanceEnabled &&
  snapshot.enabled &&
  snapshot.installed &&
  snapshot.status !== "error" &&
  snapshot.status !== "disabled" &&
  snapshot.availability !== "unavailable" &&
  snapshot.auth.status !== "unauthenticated";

interface InstanceSnapshot {
  readonly instanceId: string;
  readonly driverKind: string;
  readonly displayName: string;
  readonly enabled: boolean;
  /** Cached snapshot; the probe below refreshes it. */
  readonly snapshot: ServerProvider;
  readonly refresh: Effect.Effect<ServerProvider>;
}

const omniRouteTier = (model: string): { smartness: number; speed: number } => {
  if (model.includes("best-fast")) return { smartness: 0.6, speed: 0.95 };
  if (model.includes("best-coding")) return { smartness: 0.9, speed: 0.6 };
  if (model.includes("best-reasoning")) return { smartness: 0.95, speed: 0.45 };
  if (model.includes("best-vision")) return { smartness: 0.85, speed: 0.6 };
  if (model.includes("best-chat")) return { smartness: 0.8, speed: 0.7 };
  if (model.includes("cheap")) return { smartness: 0.5, speed: 0.8 };
  return modelTier(model, "omniroute");
};

export const make = Effect.fn("codeitlab.routing.service.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const settings = yield* ServerSettings.ServerSettingsService;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const crypto = yield* Crypto.Crypto;
  const environment = yield* HostProcess.Environment;
  // The deep scan outlives a single RPC. Forking it into the service's own
  // scope ties it to the layer lifetime, so the fiber is interrupted before the
  // layer's dependencies (state directory, providers) are torn down.
  const serviceScope = yield* Effect.scope;
  const deepScanFiber = yield* Ref.make<Fiber.Fiber<unknown> | undefined>(undefined);
  // Await the scan fiber before the layer (and its state directory) goes away;
  // an interrupted fiber can otherwise finish one last health.json write while
  // the directory is already being removed.
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      const fiber = yield* Ref.get(deepScanFiber);
      if (fiber !== undefined) yield* Fiber.interrupt(fiber);
    }),
  );

  const historyDirectory = path.join(config.stateDir, "codeitlab", "routing");
  const historyPath = path.join(historyDirectory, "history.jsonl");
  const healthPath = path.join(historyDirectory, "health.json");

  const historyRef = yield* Ref.make<ReadonlyArray<RoutingDecision>>([]);
  const historyFileLines = yield* Ref.make(0);
  const healthRef = yield* Ref.make<RoutingHealth | undefined>(undefined);
  const historyLock = yield* Semaphore.make(1);
  const healthLock = yield* Semaphore.make(1);
  const deepScanRunning = yield* Ref.make(false);
  const omniRouteCache = yield* Ref.make<
    { readonly discovery: OmniRouteDiscovery; readonly atMs: number } | undefined
  >(undefined);

  const loadHistory = Effect.gen(function* () {
    const text = yield* fs.readFileString(historyPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
      Effect.orElseSucceed(() => ""),
    );
    const entries: RoutingDecision[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const decoded = decodeHistoryLine(trimmed);
      if (Option.isSome(decoded)) entries.push(decoded.value);
    }
    return { entries: entries.slice(-MAX_HISTORY_ENTRIES), lineCount: entries.length };
  });
  const loadedHistory = yield* loadHistory;
  yield* Ref.set(historyRef, loadedHistory.entries);
  yield* Ref.set(historyFileLines, loadedHistory.lineCount);
  yield* fs
    .makeDirectory(historyDirectory, { recursive: true })
    .pipe(Effect.orElseSucceed(() => undefined));

  // Appending one line is O(1); rewriting the whole history on every turn is
  // not (a deep-scanned catalog makes each decision entry large). The file is
  // compacted back to the bound once it has grown past it, so the amortised
  // cost stays low and startup never parses more than the bound.
  const appendHistory = (decision: RoutingDecision) =>
    historyLock.withPermits(1)(
      Effect.gen(function* () {
        const entries = [...(yield* Ref.get(historyRef)), decision].slice(-MAX_HISTORY_ENTRIES);
        yield* Ref.set(historyRef, entries);
        const lineCount = yield* Ref.get(historyFileLines);
        const write = (contents: string, flag?: "a") =>
          (flag === "a"
            ? fs.writeFileString(historyPath, contents, { flag })
            : writeFileStringAtomically({ filePath: historyPath, contents })
          ).pipe(
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(Path.Path, path),
            Effect.mapError(
              (cause) =>
                new CodeitlabServiceError({
                  operation: "routing.history",
                  message: "Failed to persist the routing decision history.",
                  cause,
                }),
            ),
          );
        if (lineCount >= MAX_HISTORY_ENTRIES) {
          yield* write(`${entries.map((entry) => encodeHistoryLine(entry)).join("\n")}\n`);
          yield* Ref.set(historyFileLines, entries.length);
        } else {
          yield* write(`${encodeHistoryLine(decision)}\n`, "a");
          yield* Ref.set(historyFileLines, lineCount + 1);
        }
      }),
    );

  const persistHistory = (entries: ReadonlyArray<RoutingDecision>) =>
    historyLock.withPermits(1)(
      Effect.gen(function* () {
        const bounded = entries.slice(-MAX_HISTORY_ENTRIES);
        yield* Ref.set(historyRef, bounded);
        yield* Ref.set(historyFileLines, bounded.length);
        yield* writeFileStringAtomically({
          filePath: historyPath,
          contents: `${bounded.map((entry) => encodeHistoryLine(entry)).join("\n")}\n`,
        }).pipe(
          Effect.provideService(FileSystem.FileSystem, fs),
          Effect.provideService(Path.Path, path),
          Effect.mapError(
            (cause) =>
              new CodeitlabServiceError({
                operation: "routing.history",
                message: "Failed to persist the routing decision history.",
                cause,
              }),
          ),
        );
      }),
    );

  const recordFallback = Effect.fn("codeitlab.routing.recordFallback")(function* (input: {
    readonly decisionId?: string;
    readonly fromInstanceId: string;
    readonly toInstanceId: string;
    readonly toModel: string;
  }) {
    const entries = yield* Ref.get(historyRef);
    const note = ` Fell back to ${input.toInstanceId}/${input.toModel} because ${input.fromInstanceId} failed.`;
    if (input.decisionId === undefined) {
      // No decision was recorded for this turn (the router could not pick any
      // provider), so keep an explicit fallback decision in the history — the
      // UI badge and the audit trail need a reason to show.
      const synthetic: RoutingDecision = {
        id: `route_fallback_${yield* crypto
          .randomUUIDv7()
          .pipe(
            Effect.catchCause(() =>
              Clock.currentTimeMillis.pipe(Effect.map((nowMs) => `${nowMs}`)),
            ),
          )}`,
        decidedAt: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
        taskClass: "coding",
        providerInstanceId: input.toInstanceId,
        providerKind: "",
        model: input.toModel,
        reason: note.trim(),
        candidates: [],
        enforced: true,
      };
      yield* persistHistory([...entries, synthetic]);
      yield* Effect.logInfo("CodeitLab recorded a fallback decision.", {
        decisionId: synthetic.id,
        fromInstanceId: input.fromInstanceId,
        toInstanceId: input.toInstanceId,
        toModel: input.toModel,
      });
      return;
    }
    const index = entries.findIndex((entry) => entry.id === input.decisionId);
    if (index < 0) return;
    const existing = entries[index];
    if (existing === undefined || existing.reason.includes(note.trim())) return;
    const updated = [...entries];
    updated[index] = { ...existing, reason: `${existing.reason}${note}` };
    yield* persistHistory(updated);
    yield* Effect.logInfo("CodeitLab routing decision annotated with the fallback.", {
      decisionId: updated[index]?.id,
      fromInstanceId: input.fromInstanceId,
      toInstanceId: input.toInstanceId,
      toModel: input.toModel,
    });
  });

  const persistHealth = (health: RoutingHealth) =>
    writeFileStringAtomically({
      filePath: healthPath,
      contents: `${encodeHealthFile(health)}\n`,
    }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.catch((cause) =>
        Effect.logWarning("Failed to persist the routing health snapshot.", { cause }),
      ),
    );

  /**
   * Publish a health snapshot to the in-memory ref and `health.json`. The lock
   * keeps the concurrent speed-probe writers from persisting an older snapshot
   * over a newer one.
   */
  const publishHealth = (health: RoutingHealth) =>
    healthLock.withPermits(1)(
      Effect.gen(function* () {
        yield* Ref.set(healthRef, health);
        yield* persistHealth(health);
      }),
    );

  /** Persist whatever is in the ref now; callers update the ref first. */
  const persistCurrentHealth = healthLock.withPermits(1)(
    Effect.gen(function* () {
      const current = yield* Ref.get(healthRef);
      if (current !== undefined) yield* persistHealth(current);
    }),
  );

  const loadHealth = Effect.gen(function* () {
    const text = yield* fs.readFileString(healthPath).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
      Effect.orElseSucceed(() => ""),
    );
    const trimmed = text.trim();
    if (trimmed.length === 0) return undefined;
    const decoded = decodeHealthFile(trimmed);
    return Option.isSome(decoded) ? decoded.value : undefined;
  });
  yield* Ref.set(healthRef, yield* loadHealth);

  /**
   * Probe one instance and turn the result into a routable health row. The
   * refresh is time-boxed: a provider that hangs is reported as failing instead
   * of blocking the check for the others.
   */
  const probeHealth = Effect.fn("codeitlab.routing.probeHealth")(function* (
    instance: InstanceSnapshot,
  ) {
    const startedAtMs = yield* Clock.currentTimeMillis;
    const probe = yield* instance.refresh.pipe(
      Effect.timeout("20 seconds"),
      Effect.map((snapshot): { readonly ok: true; readonly snapshot: ServerProvider } => ({
        ok: true,
        snapshot,
      })),
      Effect.catch((cause) =>
        Effect.succeed({ ok: false as const, message: describeProbeFailure(cause) }),
      ),
    );
    const latencyMs = (yield* Clock.currentTimeMillis) - startedAtMs;
    const snapshot: ServerProvider | undefined = probe.ok ? probe.snapshot : instance.snapshot;
    if (snapshot === undefined) {
      return {
        providerInstanceId: instance.instanceId,
        providerKind: instance.driverKind,
        name: instance.displayName,
        ok: false,
        status: "error",
        quota: 0,
        latencyMs,
        models: 0,
        detail: probe.ok ? "Provider returned no snapshot." : probe.message,
      } satisfies RoutingHealthEntry;
    }
    const verdict = healthVerdict({
      enabled: instance.enabled,
      snapshot,
      ...(probe.ok ? {} : { failure: probe.message }),
    });
    return {
      providerInstanceId: instance.instanceId,
      providerKind: instance.driverKind,
      name: instance.displayName,
      ok: verdict.ok,
      status: verdict.status,
      quota: remainingQuota(snapshot.usageLimits),
      latencyMs,
      models: snapshot.models.filter((model) => model.isLegacy !== true).length,
      ...(verdict.detail === undefined ? {} : { detail: verdict.detail }),
    } satisfies RoutingHealthEntry;
  });

  /**
   * Measure one provider's candidate models with a one-word "hi" turn. Models
   * run sequentially: a provider that serializes turns is not helped by
   * parallel calls, and one slow model must not hide the next one's latency.
   * Every finished model is committed immediately so a whole-probe timeout
   * keeps the measurements that did complete.
   */
  const probeProviderSpeeds = Effect.fn("codeitlab.routing.probeProviderSpeeds")(function* (input: {
    readonly index: number;
    readonly instance: InstanceSnapshot;
    readonly models: ReadonlyArray<string>;
    readonly startedAt: string;
  }) {
    const providerInstanceId = ProviderInstanceId.make(input.instance.instanceId);
    const liveInstance = yield* registry.getInstance(providerInstanceId);
    const textGeneration = liveInstance?.textGeneration;
    const speeds: Array<SpeedMeasurement> = [];
    const failedModels: Array<string> = [];
    const total = input.models.length;
    const publishProvider = (status: ProviderSpeedProbeState["status"], finishedAt?: string) =>
      Ref.update(healthRef, (current) => {
        if (current === undefined) return current;
        const ordered = [...speeds].sort((left, right) =>
          left.ok === right.ok
            ? left.ok
              ? left.latencyMs - right.latencyMs
              : left.model.localeCompare(right.model)
            : left.ok
              ? -1
              : 1,
        );
        const entries = current.entries.map((entry, index) =>
          index === input.index
            ? {
                ...entry,
                speeds: ordered,
                speedProbe: {
                  status,
                  startedAt: input.startedAt,
                  checked: ordered.length,
                  total,
                  ...(finishedAt === undefined ? {} : { finishedAt }),
                  ...(failedModels.length === 0 ? {} : { retrying: [...failedModels] }),
                } satisfies ProviderSpeedProbeState,
              }
            : entry,
        );
        const checked = entries.reduce((sum, entry) => sum + (entry.speedProbe?.checked ?? 0), 0);
        const plannedTotal = entries.reduce(
          (sum, entry) => sum + (entry.speedProbe?.total ?? 0),
          0,
        );
        return {
          ...current,
          entries,
          speedProbe: {
            status: "checking" as const,
            startedAt: input.startedAt,
            checked,
            total: plannedTotal,
          },
        };
      });
    for (const model of input.models) {
      const measured =
        textGeneration === undefined
          ? ({
              model,
              latencyMs: 0,
              ok: false,
              error: "Provider instance is not available.",
            } satisfies SpeedProbeResult)
          : yield* probeInstanceModelSpeed({
              textGeneration,
              cwd: config.cwd,
              instanceId: providerInstanceId,
              model,
            });
      speeds.push({
        ...measured,
        checkedAt: formatIsoAt(yield* Clock.currentTimeMillis),
      });
      if (!measured.ok) failedModels.push(model);
      yield* publishProvider("checking");
      yield* persistCurrentHealth;
    }
    const status: ProviderSpeedProbeState["status"] =
      total === 0
        ? "off"
        : failedModels.length === 0
          ? "done"
          : failedModels.length < total
            ? "partial"
            : "error";
    const finishedAt = formatIsoAt(yield* Clock.currentTimeMillis);
    yield* publishProvider(status, finishedAt);
    yield* persistCurrentHealth;
  });

  /**
   * Speed-probe phase of the health check. Publishes a `checking` snapshot
   * first (the routing page's "checking all harness and models" state), then
   * fills in measured speeds and the final aggregate status. A failing model is
   * a row in `health.json`, never a failed health check.
   */
  const runSpeedProbe = Effect.fn("codeitlab.routing.runSpeedProbe")(function* (input: {
    readonly routing: RoutingSettings;
    readonly instances: ReadonlyArray<InstanceSnapshot>;
    readonly base: RoutingHealth;
  }) {
    const startedAt = input.base.checkedAt;
    // Fresh provider verdicts replace the previous entries, so carry the deep
    // scan measurements over explicitly: they are the router's evidence of
    // which models actually answer, and must survive every later health check.
    const previousEntries = (yield* Ref.get(healthRef))?.entries ?? [];
    const base: RoutingHealth = {
      ...input.base,
      entries: input.base.entries.map((entry) => {
        const previous = previousEntries.find(
          (candidate) => candidate.providerInstanceId === entry.providerInstanceId,
        );
        return previous?.speedProbe?.mode === "deep" && (previous.speeds?.length ?? 0) > 0
          ? { ...entry, speeds: previous.speeds, speedProbe: previous.speedProbe }
          : entry;
      }),
    };
    if (!input.routing.speedProbe) {
      const off: SpeedProbeState = {
        status: "off",
        startedAt,
        finishedAt: startedAt,
        checked: 0,
        total: 0,
      };
      const health: RoutingHealth = {
        ...base,
        entries: base.entries.map((entry) =>
          // A deep scan is an explicit, separate measurement: turning the light
          // probe off must not throw away what the deep scan already learned.
          entry.speedProbe?.mode === "deep" && (entry.speeds?.length ?? 0) > 0
            ? entry
            : {
                ...entry,
                speeds: [],
                speedProbe: {
                  status: "off",
                  startedAt,
                  finishedAt: startedAt,
                  checked: 0,
                  total: 0,
                },
              },
        ),
        speedProbe: off,
      };
      yield* publishHealth(health);
      return health;
    }

    const hasDeepData = (entry: RoutingHealthEntry | undefined): boolean =>
      entry?.speedProbe?.mode === "deep" && (entry.speeds?.length ?? 0) > 0;
    const planned = input.instances.map((instance, index) => {
      const entry = base.entries[index];
      // A deep scan already measured every advertised model for this provider;
      // a light three-model probe on top would overwrite that evidence.
      if (entry === undefined || !entry.ok || hasDeepData(entry)) return [];
      return selectProbeModels({
        models: instance.snapshot.models,
        providerKind: instance.driverKind,
        taskClass: SPEED_PROBE_TASK_CLASS,
        limit: input.routing.speedProbeModelsPerProvider,
      });
    });
    const total = planned.reduce((sum, models) => sum + models.length, 0);
    const checkingEntries = base.entries.map((entry, index) => {
      if (hasDeepData(entry)) return entry;
      const totalForProvider = planned[index]?.length ?? 0;
      return {
        ...entry,
        speeds: [],
        speedProbe: {
          status: totalForProvider > 0 ? ("checking" as const) : ("off" as const),
          startedAt,
          checked: 0,
          total: totalForProvider,
        },
      } satisfies RoutingHealthEntry;
    });
    yield* publishHealth({
      ...base,
      entries: checkingEntries,
      speedProbe: { status: "checking", startedAt, checked: 0, total },
    });

    const work = planned.flatMap((models, index) => {
      const instance = input.instances[index];
      return instance === undefined || models.length === 0 ? [] : [{ index, instance, models }];
    });
    const timedOut = yield* Effect.forEach(
      work,
      (item) =>
        probeProviderSpeeds({
          index: item.index,
          instance: item.instance,
          models: item.models,
          startedAt,
        }),
      { concurrency: SPEED_PROBE_PROVIDER_CONCURRENCY, discard: true },
    ).pipe(
      Effect.timeout(SPEED_PROBE_TIMEOUT),
      Effect.as(false),
      Effect.catchCause(() => Effect.succeed(true)),
    );

    const current = yield* Ref.get(healthRef);
    const finishedAt = formatIsoAt(yield* Clock.currentTimeMillis);
    // A timed-out probe interrupts the in-flight provider mid-model; those rows
    // are finalized here so `health.json` never keeps a spinner forever.
    const entries = (current?.entries ?? checkingEntries).map((entry) => {
      const speedProbe = entry.speedProbe;
      if (speedProbe === undefined || speedProbe.status !== "checking") return entry;
      return {
        ...entry,
        speedProbe: {
          ...speedProbe,
          status: speedProbe.checked > 0 ? ("partial" as const) : ("error" as const),
          finishedAt,
        },
      } satisfies RoutingHealthEntry;
    });
    const checked = entries.reduce((sum, entry) => sum + (entry.speedProbe?.checked ?? 0), 0);
    const failed = speedMeasurements(entries).filter((speed) => !speed.ok).length;
    // The deep scan is the authoritative measurement when it exists: keep its
    // aggregate (mode, ok/failed counts, totals) instead of reporting the
    // three-model light probe as if it covered the whole catalog.
    const deepEntries = entries.filter((entry) => entry.speedProbe?.mode === "deep");
    const deep = deepEntries.length > 0;
    const deepChecked = deepEntries.reduce(
      (sum, entry) => sum + (entry.speedProbe?.checked ?? 0),
      0,
    );
    const deepTotal = deepEntries.reduce((sum, entry) => sum + (entry.speedProbe?.total ?? 0), 0);
    const deepOk = deepEntries.reduce(
      (sum, entry) => sum + (entry.speeds ?? []).filter((speed) => speed.ok).length,
      0,
    );
    const deepFailed = deepEntries.reduce(
      (sum, entry) => sum + (entry.speeds ?? []).filter((speed) => !speed.ok).length,
      0,
    );
    const health: RoutingHealth = {
      ...base,
      entries,
      speedProbe: deep
        ? {
            status: deepFailed === 0 ? "done" : deepOk > 0 ? "partial" : "error",
            mode: "deep",
            startedAt,
            finishedAt,
            checked: deepChecked,
            total: deepTotal,
            okCount: deepOk,
            failedCount: deepFailed,
          }
        : {
            status: speedProbeStatus({ checked, failed, total, timedOut }),
            startedAt,
            finishedAt,
            checked,
            total,
          },
    };
    yield* publishHealth(health);
    yield* Effect.logInfo("CodeitLab speed probe", {
      checked,
      total,
      failed,
      fastest: fastestMeasurement(entries) ?? null,
    });
    return health;
  });

  /**
   * Deep model scan. The light probe measures a shortlist per provider on the
   * schedule; a gateway like Hermes advertises thousands of custom models, and
   * the router must know which of them answer and how fast before it can rank
   * them per task. The scan measures every advertised model once, persists
   * progress while it runs (so the Routing page can show `checked / total`),
   * and only models that answered become routing candidates.
   */
  const runDeepScan = Effect.fn("codeitlab.routing.deepScan")(function* (input: {
    readonly routing: RoutingSettings;
    readonly instances: ReadonlyArray<InstanceSnapshot>;
  }) {
    const startedAt = formatIsoAt(yield* Clock.currentTimeMillis);
    const concurrency = clampDeepScanConcurrency(input.routing.deepScanConcurrency);
    const timeoutSeconds = clampDeepScanTimeoutSeconds(input.routing.deepScanTimeoutSeconds);
    const timeout = Duration.seconds(timeoutSeconds);
    const base = yield* Ref.get(healthRef);
    if (base === undefined) return undefined;

    const targets = input.instances.flatMap((instance) => {
      const slugs = deepScanModelSlugs(instance.snapshot.models);
      return slugs.length === 0
        ? []
        : [
            {
              instance,
              slugs,
              fingerprint: deepScanFingerprint(instance.snapshot.models),
            },
          ];
    });
    const total = targets.reduce((sum, target) => sum + target.slugs.length, 0);
    if (total === 0) {
      const health: RoutingHealth = {
        ...base,
        speedProbe: {
          status: "off",
          mode: "deep",
          startedAt,
          finishedAt: startedAt,
          checked: 0,
          total: 0,
          okCount: 0,
          failedCount: 0,
        },
      };
      yield* publishHealth(health);
      return health;
    }

    const entriesRef = yield* Ref.make<ReadonlyArray<RoutingHealthEntry>>(
      base.entries.map((entry) => {
        const target = targets.find(
          (candidate) => candidate.instance.instanceId === entry.providerInstanceId,
        );
        if (target === undefined) return entry;
        return {
          ...entry,
          speedProbe: {
            status: "checking",
            mode: "deep",
            startedAt,
            checked: 0,
            total: target.slugs.length,
            modelCount: target.slugs.length,
            okCount: 0,
            failedCount: 0,
            fingerprint: target.fingerprint,
          },
        } satisfies RoutingHealthEntry;
      }),
    );
    const aggregate = Effect.fn("codeitlab.routing.deepScan.aggregate")(function* (
      status: SpeedProbeState["status"],
      finishedAt?: string,
    ) {
      const entries = yield* Ref.get(entriesRef);
      const deepEntries = entries.filter((entry) => entry.speedProbe?.mode === "deep");
      const checked = deepEntries.reduce((sum, entry) => sum + (entry.speedProbe?.checked ?? 0), 0);
      const okCount = deepEntries.reduce(
        (sum, entry) => sum + (entry.speeds ?? []).filter((speed) => speed.ok).length,
        0,
      );
      const failedCount = deepEntries.reduce(
        (sum, entry) => sum + (entry.speeds ?? []).filter((speed) => !speed.ok).length,
        0,
      );
      const health: RoutingHealth = {
        ...base,
        entries,
        speedProbe: {
          status,
          mode: "deep",
          startedAt,
          ...(finishedAt === undefined ? {} : { finishedAt }),
          checked,
          total,
          okCount,
          failedCount,
        },
      };
      yield* Ref.set(healthRef, health);
      return health;
    });
    const publish = Effect.fn("codeitlab.routing.deepScan.publish")(function* (
      status: SpeedProbeState["status"],
      options?: { readonly persist?: boolean; readonly finishedAt?: string },
    ) {
      const health = yield* aggregate(status, options?.finishedAt);
      if (options?.persist !== false) yield* persistCurrentHealth;
      return health;
    });

    yield* publish("checking", { persist: true });
    yield* Effect.logInfo("CodeitLab deep scan started", {
      total,
      providers: targets.length,
      concurrency,
      timeoutSeconds,
    });

    for (const target of targets) {
      const providerInstanceId = ProviderInstanceId.make(target.instance.instanceId);
      const liveInstance = yield* registry.getInstance(providerInstanceId);
      const textGeneration = liveInstance?.textGeneration;
      const speedsRef = yield* Ref.make<ReadonlyArray<SpeedMeasurement>>(
        (
          base.entries.find((entry) => entry.providerInstanceId === target.instance.instanceId)
            ?.speeds ?? []
        ).filter((speed) => target.slugs.includes(speed.model)),
      );
      const completed = yield* Ref.make(0);
      yield* Effect.forEach(
        target.slugs,
        (model) =>
          Effect.gen(function* () {
            const measured =
              textGeneration === undefined
                ? ({
                    model,
                    latencyMs: 0,
                    ok: false,
                    error: "Provider instance is not available.",
                  } satisfies SpeedProbeResult)
                : yield* probeInstanceModelSpeed({
                    textGeneration,
                    cwd: config.cwd,
                    instanceId: providerInstanceId,
                    model,
                    retry: false,
                    timeout,
                  });
            const measurement: SpeedMeasurement = {
              ...measured,
              checkedAt: formatIsoAt(yield* Clock.currentTimeMillis),
            };
            const done = yield* Ref.updateAndGet(completed, (value) => value + 1);
            yield* Ref.update(speedsRef, (current) => [
              ...current.filter((speed) => speed.model !== model),
              measurement,
            ]);
            const ordered = (yield* Ref.get(speedsRef))
              .slice()
              .sort((left, right) =>
                left.ok === right.ok
                  ? left.ok
                    ? left.latencyMs - right.latencyMs
                    : left.model.localeCompare(right.model)
                  : left.ok
                    ? -1
                    : 1,
              );
            const okCount = ordered.filter((speed) => speed.ok).length;
            yield* Ref.update(entriesRef, (entries) =>
              entries.map((entry) =>
                entry.providerInstanceId === target.instance.instanceId
                  ? {
                      ...entry,
                      speeds: ordered,
                      speedProbe: {
                        status: "checking",
                        mode: "deep",
                        startedAt,
                        checked: ordered.length,
                        total: target.slugs.length,
                        modelCount: target.slugs.length,
                        okCount,
                        failedCount: ordered.length - okCount,
                        fingerprint: target.fingerprint,
                      },
                    }
                  : entry,
              ),
            );
            // Progress is cheap to publish in memory; the file write is
            // throttled so a 2 000-model scan does not rewrite health.json
            // 2 000 times.
            const shouldPersist = done % 25 === 0 || done === target.slugs.length;
            yield* publish("checking", { persist: shouldPersist });
          }),
        { concurrency, discard: true },
      );

      const finalSpeeds = (yield* Ref.get(speedsRef))
        .slice()
        .sort((left, right) =>
          left.ok === right.ok
            ? left.ok
              ? left.latencyMs - right.latencyMs
              : left.model.localeCompare(right.model)
            : left.ok
              ? -1
              : 1,
        );
      const okCount = finalSpeeds.filter((speed) => speed.ok).length;
      const failedCount = finalSpeeds.length - okCount;
      const status: ProviderSpeedProbeState["status"] =
        failedCount === 0 ? "done" : okCount > 0 ? "partial" : "error";
      const finishedAt = formatIsoAt(yield* Clock.currentTimeMillis);
      yield* Ref.update(entriesRef, (entries) =>
        entries.map((entry) =>
          entry.providerInstanceId === target.instance.instanceId
            ? {
                ...entry,
                // A provider whose every advertised model failed the scan cannot
                // serve a turn, even when its binary/login/quota checks passed.
                ...(okCount === 0
                  ? {
                      ok: false,
                      status: "error" as const,
                      detail: entry.detail ?? "No advertised model answered the deep scan.",
                    }
                  : {}),
                speeds: finalSpeeds,
                speedProbe: {
                  status,
                  mode: "deep",
                  startedAt,
                  finishedAt,
                  checked: finalSpeeds.length,
                  total: target.slugs.length,
                  modelCount: target.slugs.length,
                  okCount,
                  failedCount,
                  fingerprint: target.fingerprint,
                },
              }
            : entry,
        ),
      );
      yield* publish("checking", { persist: true });
      yield* Effect.logInfo("CodeitLab deep scan provider", {
        providerInstanceId: target.instance.instanceId,
        checked: finalSpeeds.length,
        total: target.slugs.length,
        ok: okCount,
        failed: failedCount,
      });
    }

    const entries = yield* Ref.get(entriesRef);
    const deepEntries = entries.filter((entry) => entry.speedProbe?.mode === "deep");
    const checked = deepEntries.reduce((sum, entry) => sum + (entry.speedProbe?.checked ?? 0), 0);
    const okCount = deepEntries.reduce(
      (sum, entry) => sum + (entry.speeds ?? []).filter((speed) => speed.ok).length,
      0,
    );
    const failedCount = deepEntries.reduce(
      (sum, entry) => sum + (entry.speeds ?? []).filter((speed) => !speed.ok).length,
      0,
    );
    const finishedAt = formatIsoAt(yield* Clock.currentTimeMillis);
    const status: SpeedProbeState["status"] =
      failedCount === 0 ? "done" : okCount > 0 ? "partial" : "error";
    const health: RoutingHealth = {
      ...base,
      entries,
      speedProbe: {
        status,
        mode: "deep",
        startedAt,
        finishedAt,
        checked,
        total,
        okCount,
        failedCount,
      },
    };
    yield* publishHealth(health);
    yield* Effect.logInfo("CodeitLab deep scan complete", {
      checked,
      total,
      ok: okCount,
      failed: failedCount,
      providers: targets.length,
    });
    return health;
  });

  /**
   * Decide whether a deep scan is due and start it in the background. Manual
   * checks force a scan; startup/scheduled checks only refresh when a provider's
   * model list changed or the last scan is older than the refresh window.
   */
  const startDeepScan = Effect.fn("codeitlab.routing.startDeepScan")(function* (input: {
    readonly routing: RoutingSettings;
    readonly instances: ReadonlyArray<InstanceSnapshot>;
    readonly force: boolean;
  }) {
    const current = yield* Ref.get(healthRef);
    const nowMs = yield* Clock.currentTimeMillis;
    if (!input.routing.deepScan) {
      if (current === undefined) return undefined;
      const startedAt = formatIsoAt(nowMs);
      const entries = current.entries.map((entry) => ({
        ...entry,
        speedProbe: {
          status: "off" as const,
          mode: "deep" as const,
          startedAt,
          finishedAt: startedAt,
          checked: 0,
          total: 0,
          okCount: 0,
          failedCount: 0,
          modelCount: entry.speedProbe?.modelCount ?? entry.models,
        },
      }));
      const health: RoutingHealth = {
        ...current,
        entries,
        speedProbe: {
          status: "off",
          mode: "deep",
          startedAt,
          finishedAt: startedAt,
          checked: 0,
          total: 0,
          okCount: 0,
          failedCount: 0,
        },
      };
      yield* publishHealth(health);
      return health;
    }
    if (yield* Ref.get(deepScanRunning)) return current;
    const byInstance = healthByInstance(current?.entries);
    const due = input.instances.some((instance) => {
      const slugs = deepScanModelSlugs(instance.snapshot.models);
      if (slugs.length === 0) return false;
      const scan = byInstance.get(instance.instanceId)?.speedProbe;
      if (scan?.mode !== "deep") return true;
      if (scan.fingerprint !== deepScanFingerprint(instance.snapshot.models)) return true;
      if (scan.status === "checking") return false;
      const finishedAtMs = scan.finishedAt === undefined ? 0 : Date.parse(scan.finishedAt);
      return !Number.isFinite(finishedAtMs) || nowMs - finishedAtMs > DEEP_SCAN_REFRESH_MS;
    });
    if (!input.force && !due) return current;
    yield* Ref.set(deepScanRunning, true);
    const fiber = yield* runDeepScan({
      routing: input.routing,
      instances: input.instances,
    }).pipe(
      Effect.ensuring(Ref.set(deepScanRunning, false)),
      Effect.catchCause((cause) => Effect.logWarning("CodeitLab deep scan failed.", { cause })),
      Effect.forkIn(serviceScope),
    );
    yield* Ref.set(deepScanFiber, fiber);
    return yield* Ref.get(healthRef);
  });

  const runHealthCheck = Effect.fn("codeitlab.routing.healthCheck")(function* (
    source: RoutingHealth["source"],
  ) {
    const current = yield* readSettings;
    const routing = current.codeitlab.routing;
    const intervalMinutes = clampHealthIntervalMinutes(routing.healthCheckMinutes);
    const instances = yield* readInstances;
    const entries = yield* Effect.forEach(instances, probeHealth, { concurrency: 3 });
    const checkedAtMs = yield* Clock.currentTimeMillis;
    return yield* runSpeedProbe({
      routing,
      instances,
      base: {
        checkedAt: formatIsoAt(checkedAtMs),
        intervalMinutes,
        nextCheckAt: formatIsoAt(nextCheckAtMs(checkedAtMs, intervalMinutes)),
        source,
        entries,
      },
    });
  });

  const health = Effect.gen(function* () {
    const cached = yield* Ref.get(healthRef);
    return cached ?? (yield* runHealthCheck("startup"));
  });

  const checkHealth = runHealthCheck("manual");

  const scanModels = Effect.gen(function* () {
    const current = yield* readSettings;
    const instances = yield* readInstances;
    // The scan updates an existing health snapshot (it needs the provider
    // entries to fill in), so make sure one exists before forking the scan.
    const base = yield* health;
    const started = yield* startDeepScan({
      routing: current.codeitlab.routing,
      instances,
      force: true,
    });
    return started ?? base;
  });

  const readSettings = settings.getSettings.pipe(
    Effect.mapError(
      (cause) =>
        new CodeitlabServiceError({
          operation: "routing.catalog",
          message: "Could not read settings for routing.",
          cause,
        }),
    ),
  );

  const readInstances: Effect.Effect<
    ReadonlyArray<InstanceSnapshot>,
    CodeitlabServiceError
  > = registry.listInstances.pipe(
    Effect.mapError(
      (cause) =>
        new CodeitlabServiceError({
          operation: "routing.catalog",
          message: "Could not read the provider instance registry.",
          cause,
        }),
    ),
    Effect.flatMap((instances) =>
      Effect.forEach(
        instances,
        (instance) =>
          instance.snapshot.getSnapshot.pipe(
            Effect.option,
            Effect.map((snapshot) =>
              Option.isNone(snapshot)
                ? undefined
                : {
                    instanceId: instance.instanceId,
                    driverKind: instance.driverKind,
                    displayName: codeitlabAgentLabel(
                      instance.displayName ?? String(instance.driverKind),
                    ),
                    enabled: instance.enabled,
                    snapshot: snapshot.value,
                    refresh: instance.snapshot.refresh,
                  },
            ),
          ),
        { concurrency: 4 },
      ),
    ),
    Effect.map((instances) => instances.flatMap((entry) => (entry === undefined ? [] : [entry]))),
  );

  const httpClient = yield* HttpClient.HttpClient;

  const discoverOmniRoute = Effect.gen(function* () {
    const current = yield* readSettings;
    const omniRoute = current.codeitlab.routing.omniRoute;
    if (!omniRoute.enabled) return { models: [], error: null } satisfies OmniRouteDiscovery;
    const cached = yield* Ref.get(omniRouteCache);
    const nowMs = yield* Clock.currentTimeMillis;
    if (cached !== undefined && nowMs - cached.atMs < OMNIROUTE_DISCOVERY_TTL_MS) {
      return cached.discovery;
    }
    const discovery = yield* discoverOmniRouteModels(omniRoute, environment).pipe(
      Effect.provideService(HttpClient.HttpClient, httpClient),
    );
    yield* Ref.set(omniRouteCache, { discovery, atMs: nowMs });
    return discovery;
  });

  const healthByInstance = (entries: ReadonlyArray<RoutingHealthEntry> | undefined) =>
    new Map((entries ?? []).map((entry) => [entry.providerInstanceId, entry] as const));

  const catalog = Effect.gen(function* () {
    const current = yield* readSettings;
    const instances = yield* readInstances;
    const omniRoute = current.codeitlab.routing.omniRoute;
    const discovery = yield* discoverOmniRoute;
    const healthEntries = yield* Ref.get(healthRef);
    const byInstance = healthByInstance(healthEntries?.entries);
    const providers = instances.map((instance) => {
      const tier = bestProviderTier(instance.snapshot.models, instance.driverKind, "coding");
      const entry = byInstance.get(instance.instanceId);
      return {
        providerInstanceId: instance.instanceId,
        providerKind: instance.driverKind,
        name: instance.displayName,
        // The fallback pickers need the real list: a gateway can advertise
        // thousands of models and truncating it here would hide the backup
        // models the user is trying to choose.
        models: instance.snapshot.models
          .filter((model) => model.isLegacy !== true)
          .map((model) => model.slug),
        modelCount: instance.snapshot.models.filter((model) => model.isLegacy !== true).length,
        defaultModel: defaultModel(instance.snapshot.models)?.slug,
        available: providerIsAvailable(instance.enabled, instance.snapshot) && (entry?.ok ?? true),
        quota: entry?.quota ?? remainingQuota(instance.snapshot.usageLimits),
        speed: tier.speed,
        smartness: tier.smartness,
      };
    });
    return {
      mode: current.codeitlab.routing.mode,
      providers,
      omniRouteModels: omniRoute.enabled
        ? omniRouteVirtualModels(omniRoute, discovery.models)
        : [...omniRoute.virtualModels],
    } satisfies RoutingCatalog;
  });

  /**
   * One seed per (provider, model) pair. With `routePerTask` the task class
   * decides which models inside a provider compete — the fastest model for
   * `fast`/`cheap`, the smartest for `coding`/`reasoning` — so a gateway with
   * thousands of models cannot drown the provider's genuinely good pick.
   * Health rows demote providers that failed the last probe or ran out of quota.
   */
  const buildSeeds = (
    instances: ReadonlyArray<InstanceSnapshot>,
    taskClass: TaskClass,
    options: {
      readonly routePerTask: boolean;
      readonly health: RoutingHealth | undefined;
      readonly fallbackEnabled?: boolean;
    },
  ): ReadonlyArray<CandidateSeed> => {
    const byInstance = healthByInstance(options.health?.entries);
    return instances.flatMap((instance) => {
      const entry = byInstance.get(instance.instanceId);
      const quota = entry?.quota ?? remainingQuota(instance.snapshot.usageLimits);
      const coolingDown =
        options.fallbackEnabled !== false && isProviderCoolingDown(instance.instanceId);
      const scan = entry?.speedProbe;
      const measuredOk = (entry?.speeds ?? []).filter((speed) => speed.ok);
      const deepDone = scan?.mode === "deep" && scan.status !== "checking";
      const providerAvailable =
        providerIsAvailable(instance.enabled, instance.snapshot) &&
        (entry?.ok ?? true) &&
        quota > 0 &&
        !coolingDown &&
        // A finished deep scan with no answering model means the provider
        // cannot serve a turn, even though its quota/login look fine.
        (measuredOk.length > 0 || !deepDone);
      // After a deep scan, only models that answered the "hi" probe compete.
      // Before any measurement (or while the scan is still warming up), fall
      // back to the heuristic shortlist so the first turn stays routable.
      const testedSlugs =
        measuredOk.length > 0
          ? options.routePerTask
            ? rankTestedModels({
                speeds: measuredOk,
                providerKind: instance.driverKind,
                taskClass,
              })
            : rankTestedModelsByDefault({
                speeds: measuredOk,
                providerKind: instance.driverKind,
              })
          : undefined;
      const slugs =
        testedSlugs ??
        (deepDone
          ? []
          : options.routePerTask
            ? seedModelsForTask(instance.snapshot.models, instance.driverKind, taskClass)
            : (() => {
                const slug = defaultModel(instance.snapshot.models)?.slug;
                return slug === undefined ? [] : [slug];
              })());
      if (slugs.length === 0) {
        return [
          {
            providerInstanceId: instance.instanceId,
            providerKind: instance.driverKind,
            model: "",
            quota,
            smartness: 0,
            speed: 0,
            available: false,
          } satisfies CandidateSeed,
        ];
      }
      // Measured "hi" latency wins over the name-based heuristic; models the
      // last probe did not cover (or failed) keep the heuristic.
      const measuredLatencyByModel = new Map(
        (entry?.speeds ?? [])
          .filter((speed) => speed.ok)
          .map((speed) => [speed.model, speed.latencyMs] as const),
      );
      return slugs.map((slug) => {
        const tier = taskClassTier(slug, instance.driverKind, taskClass);
        const measuredLatencyMs = measuredLatencyByModel.get(slug);
        return {
          providerInstanceId: instance.instanceId,
          providerKind: instance.driverKind,
          model: slug,
          quota,
          smartness: tier.smartness,
          speed:
            measuredLatencyMs === undefined ? tier.speed : speedScoreFromLatency(measuredLatencyMs),
          available: providerAvailable,
        } satisfies CandidateSeed;
      });
    });
  };

  const describeDecision = (input: {
    readonly decision: RoutingDecision;
    readonly classification: ReturnType<typeof classifyTask>;
    readonly candidates: ReadonlyArray<RoutingCandidate>;
    readonly weights: {
      readonly quota: number;
      readonly smartness: number;
      readonly speed: number;
    };
  }): string => {
    const { decision, classification, candidates, weights } = input;
    const winner = candidates.find(
      (candidate) =>
        candidate.providerInstanceId === decision.providerInstanceId &&
        candidate.model === decision.model,
    );
    const runnerUp = candidates.find(
      (candidate) =>
        candidate.available &&
        !(
          candidate.providerInstanceId === decision.providerInstanceId &&
          candidate.model === decision.model
        ),
    );
    const parts = [
      `Task classified as ${classification.taskClass} (${Math.round(classification.confidence * 100)}% confidence; signals: ${classification.signals.join(", ") || "none"}).`,
      winner === undefined
        ? `Selected ${decision.providerInstanceId}/${decision.model}.`
        : `Selected ${decision.providerInstanceId}/${decision.model}: score ${winner.score.toFixed(3)} (quota ${winner.quota.toFixed(2)}, smartness ${winner.smartness.toFixed(2)}, speed ${winner.speed.toFixed(2)}; weights ${weights.quota}/${weights.smartness}/${weights.speed}).`,
      runnerUp === undefined
        ? "No other candidate was available."
        : `Runner-up ${runnerUp.providerInstanceId}/${runnerUp.model} at ${runnerUp.score.toFixed(3)}.`,
    ];
    return parts.join(" ");
  };

  /**
   * Annotate a decision with whether the orchestrator may apply it to the run's
   * selection. `currentModelSelection` is only passed by the enforcement path;
   * advisory callers (context injection) leave it undefined and get no verdict.
   */
  const withEnforcement = (input: {
    readonly decision: RoutingDecision;
    readonly routing: RoutingSettings;
    readonly currentModelSelection: RoutingDecideInput["currentModelSelection"];
    readonly instances: ReadonlyArray<InstanceSnapshot>;
    readonly prompt: string;
  }): RoutingDecision => {
    const autoRoute = isAutoRouteSelection(input.currentModelSelection);
    if (input.currentModelSelection === undefined) return input.decision;
    if (!autoRoute && (input.routing.mode === "manual" || input.routing.enforcement === "off")) {
      return { ...input.decision, enforced: false, skipReason: "off" };
    }
    const verdict = decideRouteEnforcement({
      // The Auto router sentinel is not a user-pinned selection: the user opted
      // into routing, so it behaves like `force` whatever the mode says.
      enforcement: autoRoute ? "force" : input.routing.enforcement,
      prompt: input.prompt,
      current: input.currentModelSelection,
      routed: {
        instanceId: input.decision.providerInstanceId,
        model: input.decision.model,
      },
      providers: input.instances.map((instance) => ({
        providerInstanceId: instance.instanceId,
        available: providerIsAvailable(true, instance.snapshot),
        models: instance.snapshot.models
          .filter((model) => model.isLegacy !== true)
          .map((model) => model.slug),
        defaultModel: defaultModel(instance.snapshot.models)?.slug,
      })),
    });
    return verdict.applied
      ? { ...input.decision, enforced: true }
      : { ...input.decision, enforced: false, skipReason: verdict.skipReason };
  };

  /**
   * History keeps a bounded candidate list: a deep-scanned gateway can produce
   * thousands of scored seeds, and a decision is not worth a megabyte of JSON.
   * The winner is always included.
   */
  const MAX_DECISION_CANDIDATES = 25;
  const boundedCandidates = (
    all: ReadonlyArray<RoutingCandidate>,
    chosen: RoutingCandidate,
  ): ReadonlyArray<RoutingCandidate> => {
    const top = all.slice(0, MAX_DECISION_CANDIDATES);
    return top.some(
      (candidate) =>
        candidate.providerInstanceId === chosen.providerInstanceId &&
        candidate.model === chosen.model,
    )
      ? top
      : [chosen, ...top];
  };

  const decide = Effect.fn("codeitlab.routing.decide")(function* (input: RoutingDecideInput) {
    const startedAtMs = yield* Clock.currentTimeMillis;
    // The panel shows a decision's latency next to its reason, and the log is
    // the evidence for the "router must be fast" requirement.
    const finish = Effect.fn("codeitlab.routing.decide.finish")(function* (
      decision: RoutingDecision,
    ) {
      yield* Effect.logInfo("CodeitLab routing decision", {
        durationMs: (yield* Clock.currentTimeMillis) - startedAtMs,
        taskClass: decision.taskClass,
        providerInstanceId: decision.providerInstanceId,
        model: decision.model,
        candidates: decision.candidates.length,
        enforced: decision.enforced === true,
      });
      return decision;
    });
    const current = yield* readSettings;
    const routing = current.codeitlab.routing;
    const instances = yield* readInstances;
    const classification = classifyTask({
      prompt: input.prompt,
      attachments: input.attachments,
      taskClass: input.taskClass,
    });
    const weights = weightsForTask(
      classification.taskClass,
      routing.weights ?? DEFAULT_ROUTING_WEIGHTS,
    );
    const healthSnapshot = yield* Ref.get(healthRef);
    const seeds = buildSeeds(instances, classification.taskClass, {
      routePerTask: routing.routePerTask,
      health: healthSnapshot,
      fallbackEnabled: routing.fallbackOnProviderFailure,
    });
    const candidates = scoreCandidates(seeds, weights, routing.providerOrder);
    const nowIso = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));

    const omniRoute = routing.omniRoute;
    const discovery = yield* discoverOmniRoute;
    const virtualModels = omniRoute.enabled
      ? omniRouteVirtualModels(omniRoute, discovery.models)
      : [];
    const virtualModel = OMNIROUTE_VIRTUAL_MODEL_BY_TASK[classification.taskClass];
    const omniRouteCandidate: RoutingCandidate | undefined =
      omniRoute.enabled && virtualModels.includes(virtualModel)
        ? {
            providerInstanceId: "omniroute",
            providerKind: "omniroute",
            model: virtualModel,
            quota: 1,
            ...omniRouteTier(virtualModel),
            score: 0,
            available: true,
          }
        : undefined;

    const decisionId = yield* crypto.randomUUIDv7().pipe(
      Effect.mapError(
        (cause) =>
          new CodeitlabServiceError({
            operation: "routing.decide",
            message: "Failed to generate a routing decision id.",
            cause,
          }),
      ),
    );
    const decisionBase = {
      id: `route_${decisionId}`,
      decidedAt: nowIso,
      taskClass: classification.taskClass,
    } satisfies Pick<RoutingDecision, "id" | "decidedAt" | "taskClass">;

    if (routing.mode === "omniroute" && omniRouteCandidate !== undefined) {
      const decision: RoutingDecision = {
        ...decisionBase,
        providerInstanceId: omniRouteCandidate.providerInstanceId,
        providerKind: omniRouteCandidate.providerKind,
        model: omniRouteCandidate.model,
        reason:
          `Task classified as ${classification.taskClass}; OmniRoute mode selected the gateway virtual model ${omniRouteCandidate.model}. ${discovery.error ?? ""}`.trim(),
        candidates: boundedCandidates([...candidates, omniRouteCandidate], omniRouteCandidate),
        omniRouteModel: omniRouteCandidate.model,
      };
      const enforcedDecision = withEnforcement({
        decision,
        routing,
        currentModelSelection: input.currentModelSelection,
        instances,
        prompt: input.prompt,
      });
      if (routing.recordHistory && input.recordHistory !== false) {
        yield* appendHistory(enforcedDecision).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Failed to record the routing decision.", { cause }),
          ),
        );
      }
      return yield* finish(enforcedDecision);
    }

    const chosen =
      routing.mode === "manual"
        ? ((routing.providerOrder.length > 0
            ? candidates.find(
                (candidate) =>
                  candidate.available && candidate.providerInstanceId === routing.providerOrder[0],
              )
            : undefined) ?? chooseCandidate(candidates))
        : chooseCandidate(candidates);

    if (chosen === undefined) {
      return yield* Effect.fail(
        new CodeitlabServiceError({
          operation: "routing.decide",
          message:
            "No provider instance is available to route this turn. Sign in to a provider or pick one manually.",
        }),
      );
    }

    const decision: RoutingDecision = {
      ...decisionBase,
      providerInstanceId: chosen.providerInstanceId,
      providerKind: chosen.providerKind,
      model: chosen.model,
      reason:
        routing.mode === "manual"
          ? `Manual routing: ${chosen.providerInstanceId}/${chosen.model} follows your provider order.`
          : describeDecision({
              decision: {
                ...decisionBase,
                providerInstanceId: chosen.providerInstanceId,
                providerKind: chosen.providerKind,
                model: chosen.model,
                reason: "",
                candidates,
              },
              classification,
              candidates,
              weights,
            }),
      candidates: boundedCandidates(candidates, chosen),
      ...(omniRouteCandidate === undefined ? {} : { omniRouteModel: omniRouteCandidate.model }),
    };
    const enforcedDecision = withEnforcement({
      decision,
      routing,
      currentModelSelection: input.currentModelSelection,
      instances,
      prompt: input.prompt,
    });
    if (routing.recordHistory && input.recordHistory !== false) {
      yield* appendHistory(enforcedDecision).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Failed to record the routing decision.", { cause }),
        ),
      );
    }
    return yield* finish(enforcedDecision);
  });

  const history = (limit = 50) =>
    Ref.get(historyRef).pipe(
      Effect.map((entries) => entries.toReversed().slice(0, Math.max(0, limit))),
    );

  // Boot and scheduled checks also refresh the deep scan when the model list
  // changed or the last scan is older than DEEP_SCAN_REFRESH_MS. The manual
  // "Check now" path forces it through scanModels instead.
  const scanIfDue = Effect.gen(function* () {
    const current = yield* readSettings;
    const instances = yield* readInstances;
    yield* startDeepScan({
      routing: current.codeitlab.routing,
      instances,
      force: false,
    });
  }).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("The routing deep model scan failed.", { cause }),
    ),
  );

  // Probe once shortly after start so the panel has data without delaying boot,
  // then re-probe on the configured cadence (30 minutes by default).
  yield* Effect.gen(function* () {
    yield* Effect.sleep("10 seconds");
    yield* runHealthCheck("startup").pipe(
      Effect.catch((cause) =>
        Effect.logWarning("The startup routing health check failed.", { cause }),
      ),
    );
    yield* scanIfDue;
  }).pipe(Effect.forkScoped);
  yield* Effect.forever(
    Effect.gen(function* () {
      const current = yield* readSettings.pipe(Effect.option);
      const minutes = Option.match(current, {
        onNone: () => DEFAULT_HEALTH_CHECK_MINUTES,
        onSome: (value) => clampHealthIntervalMinutes(value.codeitlab.routing.healthCheckMinutes),
      });
      if (minutes === 0) {
        yield* Effect.sleep("60 seconds");
        return;
      }
      yield* Effect.sleep(Duration.minutes(minutes));
      yield* runHealthCheck("scheduled").pipe(
        Effect.catch((cause) =>
          Effect.logWarning("The scheduled routing health check failed.", { cause }),
        ),
      );
      yield* scanIfDue;
    }),
  ).pipe(Effect.forkScoped);

  const service = RoutingServiceTag.of({
    catalog,
    decide,
    history,
    health,
    checkHealth,
    scanModels,
    recordFallback,
  });
  // The orchestrator dispatch path is built before the CodeitLab layer, so it
  // reads the built service through this registration (see activeRoutingService).
  registerActiveRoutingService(service);
  return service;
});

export const layer = Layer.effect(RoutingServiceTag, make());

export { classifyTask } from "./classify.ts";
export {
  chooseCandidate,
  DEFAULT_ROUTING_WEIGHTS,
  modelTier,
  remainingQuota,
  scoreCandidate,
  scoreCandidates,
} from "./scoring.ts";
export {
  discoverOmniRouteModels,
  OMNIROUTE_VIRTUAL_MODEL_BY_TASK,
  omniRouteVirtualModels,
  parseOmniRouteModelList,
} from "./OmniRoute.ts";
