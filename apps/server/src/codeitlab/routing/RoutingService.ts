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

  const historyDirectory = path.join(config.stateDir, "codeitlab", "routing");
  const historyPath = path.join(historyDirectory, "history.jsonl");
  const healthPath = path.join(historyDirectory, "health.json");

  const historyRef = yield* Ref.make<ReadonlyArray<RoutingDecision>>([]);
  const healthRef = yield* Ref.make<RoutingHealth | undefined>(undefined);
  const historyLock = yield* Semaphore.make(1);
  const healthLock = yield* Semaphore.make(1);
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
    return entries.slice(-MAX_HISTORY_ENTRIES);
  });
  yield* Ref.set(historyRef, yield* loadHistory);

  const appendHistory = (decision: RoutingDecision) =>
    historyLock.withPermits(1)(
      Effect.gen(function* () {
        const entries = [...(yield* Ref.get(historyRef)), decision].slice(-MAX_HISTORY_ENTRIES);
        yield* Ref.set(historyRef, entries);
        yield* writeFileStringAtomically({
          filePath: historyPath,
          contents: `${entries.map((entry) => encodeHistoryLine(entry)).join("\n")}\n`,
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

  const persistHistory = (entries: ReadonlyArray<RoutingDecision>) =>
    historyLock.withPermits(1)(
      Effect.gen(function* () {
        const bounded = entries.slice(-MAX_HISTORY_ENTRIES);
        yield* Ref.set(historyRef, bounded);
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
    readonly decisionId: string;
    readonly fromInstanceId: string;
    readonly toInstanceId: string;
    readonly toModel: string;
  }) {
    const entries = yield* Ref.get(historyRef);
    const index = entries.findIndex((entry) => entry.id === input.decisionId);
    if (index === -1) return;
    const note = ` Fell back to ${input.toInstanceId}/${input.toModel} because ${input.fromInstanceId} failed.`;
    const existing = entries[index];
    if (existing === undefined || existing.reason.includes(note.trim())) return;
    const updated = [...entries];
    updated[index] = { ...existing, reason: `${existing.reason}${note}` };
    yield* persistHistory(updated);
    yield* Effect.logInfo("CodeitLab routing decision annotated with the fallback.", {
      decisionId: input.decisionId,
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
    if (!input.routing.speedProbe) {
      const off: SpeedProbeState = {
        status: "off",
        startedAt,
        finishedAt: startedAt,
        checked: 0,
        total: 0,
      };
      const health: RoutingHealth = {
        ...input.base,
        entries: input.base.entries.map((entry) => ({
          ...entry,
          speeds: [],
          speedProbe: { status: "off", startedAt, finishedAt: startedAt, checked: 0, total: 0 },
        })),
        speedProbe: off,
      };
      yield* publishHealth(health);
      return health;
    }

    const planned = input.instances.map((instance, index) => {
      const entry = input.base.entries[index];
      if (entry === undefined || !entry.ok) return [];
      return selectProbeModels({
        models: instance.snapshot.models,
        providerKind: instance.driverKind,
        taskClass: SPEED_PROBE_TASK_CLASS,
        limit: input.routing.speedProbeModelsPerProvider,
      });
    });
    const total = planned.reduce((sum, models) => sum + models.length, 0);
    const checkingEntries = input.base.entries.map((entry, index) => {
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
      ...input.base,
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
    const health: RoutingHealth = {
      ...input.base,
      entries,
      speedProbe: {
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
        models: instance.snapshot.models
          .filter((model) => model.isLegacy !== true)
          .map((model) => model.slug)
          .slice(0, 50),
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
      const providerAvailable =
        providerIsAvailable(instance.enabled, instance.snapshot) &&
        (entry?.ok ?? true) &&
        quota > 0 &&
        !coolingDown;
      const slugs = options.routePerTask
        ? seedModelsForTask(instance.snapshot.models, instance.driverKind, taskClass)
        : (() => {
            const slug = defaultModel(instance.snapshot.models)?.slug;
            return slug === undefined ? [] : [slug];
          })();
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

  const decide = Effect.fn("codeitlab.routing.decide")(function* (input: RoutingDecideInput) {
    const current = yield* readSettings;
    const routing = current.codeitlab.routing;
    const instances = yield* readInstances;
    const classification = classifyTask({
      prompt: input.prompt,
      attachments: input.attachments,
      taskClass: input.taskClass,
    });
    const weights = routing.weights ?? DEFAULT_ROUTING_WEIGHTS;
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
        candidates: [...candidates, omniRouteCandidate],
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
      return enforcedDecision;
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
      candidates,
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
    return enforcedDecision;
  });

  const history = (limit = 50) =>
    Ref.get(historyRef).pipe(
      Effect.map((entries) => [...entries].reverse().slice(0, Math.max(0, limit))),
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
    }),
  ).pipe(Effect.forkScoped);

  const service = RoutingServiceTag.of({
    catalog,
    decide,
    history,
    health,
    checkHealth,
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
