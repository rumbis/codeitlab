import type { RoutingCatalog } from "@codeitlab/core/routing";
import type { ModelSelection, ServerSettings } from "@t3tools/contracts";
import { isAutoRouteSelection, ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { getActiveRoutingService } from "./activeRoutingService.ts";
import { isProviderCoolingDown } from "./providerFailures.ts";

/** Verdict reasons that mean the routed provider/model cannot serve a turn. */
const UNAVAILABLE_SKIP_REASONS: ReadonlySet<string> = new Set([
  "provider_unavailable",
  "model_unavailable",
]);

const toSelection = (input: {
  readonly instanceId: string;
  readonly model: string;
}): ModelSelection | undefined =>
  input.instanceId.length === 0 || input.model.length === 0 || isAutoRouteSelection(input)
    ? undefined
    : { instanceId: ProviderInstanceId.make(input.instanceId), model: input.model };

/**
 * Last line of defence for the Auto router sentinel: the first catalog provider
 * that can serve a turn, using its default model. The sentinel is never a
 * provider instance, so it can never be returned.
 */
const fallbackSelection = (catalog: RoutingCatalog): ModelSelection | undefined => {
  const provider = catalog.providers.find(
    (candidate) => candidate.available && candidate.models.length > 0,
  );
  if (provider === undefined) return undefined;
  return toSelection({
    instanceId: provider.providerInstanceId,
    model: provider.defaultModel ?? provider.models[0] ?? "",
  });
};

/**
 * Backup selection for a primary provider that just failed: prefer the
 * configured backup instance (when it is usable), otherwise the first usable
 * provider in the catalog that is not cooling down. Never returns the failed
 * provider itself.
 */
const backupSelection = (input: {
  readonly catalog: RoutingCatalog;
  readonly settings: ServerSettings;
  readonly failedInstanceId: string;
  readonly nowMs?: number;
  /** Last resort: allow a cooling-down provider when nothing else is usable. */
  readonly allowCooling?: boolean;
}): ModelSelection | undefined => {
  const routing = input.settings.codeitlab.routing;
  const configuredInstanceId = routing.fallbackInstanceId ?? "";
  const configuredModel = routing.fallbackModel ?? "";
  const usable = (provider: RoutingCatalog["providers"][number]) =>
    provider.available &&
    provider.models.length > 0 &&
    provider.providerInstanceId !== input.failedInstanceId &&
    (input.allowCooling === true ||
      !isProviderCoolingDown(provider.providerInstanceId, input.nowMs));

  const configured =
    configuredInstanceId.length === 0
      ? undefined
      : input.catalog.providers.find(
          (provider) => provider.providerInstanceId === configuredInstanceId && usable(provider),
        );
  const provider = configured ?? input.catalog.providers.find(usable);
  if (provider === undefined) return undefined;
  const preferred = configuredModel.length > 0 ? configuredModel : undefined;
  const model =
    preferred !== undefined && provider.models.includes(preferred)
      ? preferred
      : (provider.defaultModel ?? provider.models[0] ?? "");
  return toSelection({ instanceId: provider.providerInstanceId, model });
};

/**
 * Resolve the selection a run should actually use when OmniRoute enforcement is
 * on. Returns `undefined` when the caller must keep the selection it already
 * has — the default for manual routing, `enforcement: "off"`, an unavailable
 * provider/model, a pinned choice, `/compact`, or any routing failure.
 *
 * The Auto router sentinel (`isAutoRouteSelection`) is the exception: it is not
 * a provider/model a session can open with, so it always routes — regardless of
 * mode, enforcement, or missing settings — and always resolves to a concrete
 * selection. If the routed decision is usable it wins even when enforcement
 * skipped it (e.g. `/compact`); otherwise the catalog default is the fallback.
 *
 * Called from `Orchestrator.dispatchMessage` when a new run is created (never for
 * a steer/restart) *before* the provider switch is planned, so a cross-provider
 * route restarts/resumes exactly like a user model switch and the emitted run
 * events carry the effective provider/model.
 */
export const resolveEnforcedModelSelection = Effect.fn("codeitlab.routing.enforcedSelection")(
  function* (input: {
    readonly prompt: string;
    readonly projectId: string | null;
    readonly attachments: ReadonlyArray<string>;
    readonly currentModelSelection: ModelSelection;
    /** Caller's already-captured settings service; keeps this effect env-free. */
    readonly readSettings: Effect.Effect<ServerSettings | undefined>;
  }) {
    const autoRoute = isAutoRouteSelection(input.currentModelSelection);
    const settings = yield* input.readSettings;
    const routing = settings?.codeitlab.routing;
    // Stock behaviour: manual mode (the default) and "off" never call routing.
    // The sentinel is the user's opt-in to routing, so it always runs.
    if (
      !autoRoute &&
      (routing === undefined || routing.mode === "manual" || routing.enforcement === "off")
    ) {
      return undefined;
    }
    // A concrete model is a user decision. `prefer` (the default) never replaces
    // it — a session must run the model its picker shows. Only `force` routes
    // across a pinned selection; the sentinel always routes. Without this, the
    // router silently swapped a default-model thread for a different model and
    // the composer label disagreed with the model that actually ran.
    if (!autoRoute && routing?.enforcement !== "force") {
      return undefined;
    }

    const active = getActiveRoutingService();
    if (Option.isNone(active)) {
      if (!autoRoute) return undefined;
      yield* Effect.logError(
        "CodeitLab auto router cannot resolve a selection because no routing service is registered.",
      );
      return undefined;
    }

    const decision = yield* active.value
      .decide({
        prompt: input.prompt,
        projectId: input.projectId,
        attachments: [...input.attachments],
        currentModelSelection: {
          instanceId: input.currentModelSelection.instanceId,
          model: input.currentModelSelection.model,
        },
        recordHistory: true,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("CodeitLab route resolution failed; keeping the user's selection.", {
            cause,
          }).pipe(Effect.as(undefined)),
        ),
      );

    // Automatic fallback: a provider that just failed a turn (or whose last
    // probe says it cannot serve one) is not returned; new auto-routed turns go
    // to the backup provider instead. `fallbackOnProviderFailure: false` keeps
    // the old behaviour exactly.
    const fallbackEnabled = routing?.fallbackOnProviderFailure ?? true;
    const health = fallbackEnabled
      ? yield* active.value.health.pipe(Effect.catchCause(() => Effect.succeed(undefined)))
      : undefined;
    const providerUnusable = (providerInstanceId: string): boolean => {
      if (isProviderCoolingDown(providerInstanceId)) return true;
      const entry = health?.entries.find(
        (candidate) => candidate.providerInstanceId === providerInstanceId,
      );
      return entry !== undefined && entry.ok !== true && entry.status !== "degraded";
    };
    const resolveBackup = Effect.fn("codeitlab.routing.resolveBackup")(function* (
      failedInstanceId: string,
      allowCooling = false,
    ) {
      const catalog = yield* active.value.catalog.pipe(
        Effect.catchCause(() => Effect.succeed(undefined)),
      );
      if (catalog === undefined || settings === undefined) return undefined;
      return backupSelection({
        catalog,
        settings,
        failedInstanceId,
        allowCooling,
      });
    });
    const applyFallback = Effect.fn("codeitlab.routing.applyFallback")(function* (
      primary: ModelSelection,
      decisionId?: string,
    ) {
      if (!fallbackEnabled || !providerUnusable(primary.instanceId)) return primary;
      const strict = yield* resolveBackup(primary.instanceId);
      // Every usable provider is cooling down: honour the configured backup
      // (or the first provider) as a last resort instead of giving up.
      const backup = strict ?? (yield* resolveBackup(primary.instanceId, true));
      if (backup === undefined) return primary;
      // A cooling-down last resort may be the same provider the catalog already
      // picked; still log and annotate it so the switch is explainable.
      if (backup.instanceId === primary.instanceId && strict !== undefined) return primary;
      yield* active.value
        .recordFallback({
          ...(decisionId === undefined ? {} : { decisionId }),
          fromInstanceId: primary.instanceId,
          toInstanceId: backup.instanceId,
          toModel: backup.model,
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("CodeitLab could not annotate the fallback decision.", {
              cause,
            }),
          ),
        );
      yield* Effect.logWarning(
        strict === undefined
          ? `CodeitLab fallback route resolved: no usable provider, using ${backup.instanceId}/${backup.model}.`
          : `CodeitLab fallback route resolved: ${primary.instanceId} failed, using ${backup.instanceId}/${backup.model}.`,
        {
          fromInstanceId: primary.instanceId,
          fromModel: primary.model,
          toInstanceId: backup.instanceId,
          toModel: backup.model,
          reason: strict === undefined ? "all_providers_cooling" : "provider_failure",
        },
      );
      return backup;
    });

    if (!autoRoute) {
      if (decision === undefined || decision.enforced !== true) return undefined;
      yield* Effect.logInfo("CodeitLab route enforced", {
        decisionId: decision.id,
        taskClass: decision.taskClass,
        enforcement: routing?.enforcement,
        fromInstanceId: input.currentModelSelection.instanceId,
        fromModel: input.currentModelSelection.model,
        toInstanceId: decision.providerInstanceId,
        toModel: decision.model,
      });
      const enforced = toSelection({
        instanceId: decision.providerInstanceId,
        model: decision.model,
      });
      return enforced === undefined ? undefined : yield* applyFallback(enforced, decision.id);
    }

    // Auto router: the routed provider/model is concrete even when enforcement
    // declined to apply it (e.g. `/compact`), and the sentinel cannot be handed
    // back to the run, so a usable decision wins over "keep the user's choice".
    if (decision !== undefined) {
      const routed = toSelection({
        instanceId: decision.providerInstanceId,
        model: decision.model,
      });
      if (routed !== undefined && !UNAVAILABLE_SKIP_REASONS.has(decision.skipReason ?? "")) {
        yield* Effect.logInfo("CodeitLab auto route resolved", {
          decisionId: decision.id,
          taskClass: decision.taskClass,
          enforced: decision.enforced === true,
          skipReason: decision.skipReason,
          fromInstanceId: input.currentModelSelection.instanceId,
          fromModel: input.currentModelSelection.model,
          toInstanceId: decision.providerInstanceId,
          toModel: decision.model,
        });
        return yield* applyFallback(routed, decision.id);
      }
    }

    const catalog = yield* active.value.catalog.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("CodeitLab auto router could not read the provider catalog.", {
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );
    const fallback = catalog === undefined ? undefined : fallbackSelection(catalog);
    const reason =
      decision === undefined ? "no_decision" : (decision.skipReason ?? "unusable_decision");
    if (fallback === undefined) {
      yield* Effect.logError("CodeitLab auto router could not resolve a concrete provider/model.", {
        reason,
      });
      return undefined;
    }
    yield* Effect.logWarning(
      `CodeitLab auto router fell back to ${fallback.instanceId}/${fallback.model}.`,
      { reason },
    );
    return yield* applyFallback(fallback);
  },
);
