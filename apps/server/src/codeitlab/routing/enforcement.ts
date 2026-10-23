import type { CodeitlabRoutingEnforcement } from "@codeitlab/core/settings";

/**
 * Pure enforcement decision for OmniRoute. Kept free of services and the
 * provider registry so every row of the semantics table is a unit test.
 *
 * The decision is only ever about *whether* the routed provider/model may
 * replace the selection a run would otherwise use. Guard rails live here, not
 * in the caller, so the orchestrator wiring stays a two-line assignment.
 */

export interface RouteEnforcementSelection {
  readonly instanceId: string;
  readonly model: string;
}

export interface RouteEnforcementProvider {
  readonly providerInstanceId: string;
  readonly available: boolean;
  readonly models: ReadonlyArray<string>;
  /** The instance's default model; undefined means "unknown". */
  readonly defaultModel?: string | undefined;
}

export type RouteSkipReason =
  | "off"
  | "compact"
  | "provider_unavailable"
  | "model_unavailable"
  | "pinned"
  | "unknown_default"
  | "already_selected";

export type RouteEnforcementDecision =
  | { readonly applied: false; readonly skipReason: RouteSkipReason }
  | { readonly applied: true; readonly selection: RouteEnforcementSelection };

export interface RouteEnforcementInput {
  readonly enforcement: CodeitlabRoutingEnforcement;
  readonly prompt: string;
  readonly current: RouteEnforcementSelection | undefined;
  readonly routed: RouteEnforcementSelection;
  readonly providers: ReadonlyArray<RouteEnforcementProvider>;
}

/** `/compact` turns must never change provider mid-compaction. */
export const isCompactTurn = (prompt: string): boolean =>
  prompt.trim().toLowerCase() === "/compact";

/**
 * A model is "pinned" when the thread's selection differs from the instance's
 * default model — i.e. the user picked it. Without default-model knowledge we
 * cannot tell, so `prefer` stays conservative and does not override.
 */
export const isPinnedSelection = (
  current: RouteEnforcementSelection,
  providers: ReadonlyArray<RouteEnforcementProvider>,
): boolean => {
  const provider = providers.find(
    (candidate) => candidate.providerInstanceId === current.instanceId,
  );
  if (provider === undefined || provider.defaultModel === undefined) return true;
  return provider.defaultModel !== current.model;
};

export const decideRouteEnforcement = (input: RouteEnforcementInput): RouteEnforcementDecision => {
  if (input.enforcement === "off") return { applied: false, skipReason: "off" };
  if (isCompactTurn(input.prompt)) return { applied: false, skipReason: "compact" };

  const routedProvider = input.providers.find(
    (provider) => provider.providerInstanceId === input.routed.instanceId,
  );
  if (routedProvider === undefined || !routedProvider.available) {
    return { applied: false, skipReason: "provider_unavailable" };
  }
  if (!routedProvider.models.includes(input.routed.model)) {
    return { applied: false, skipReason: "model_unavailable" };
  }

  if (
    input.current !== undefined &&
    input.current.instanceId === input.routed.instanceId &&
    input.current.model === input.routed.model
  ) {
    return { applied: false, skipReason: "already_selected" };
  }

  if (input.enforcement === "prefer" && input.current !== undefined) {
    const currentProvider = input.providers.find(
      (provider) => provider.providerInstanceId === input.current?.instanceId,
    );
    if (currentProvider !== undefined && currentProvider.defaultModel === undefined) {
      return { applied: false, skipReason: "unknown_default" };
    }
    if (isPinnedSelection(input.current, input.providers)) {
      return { applied: false, skipReason: "pinned" };
    }
  }

  return { applied: true, selection: input.routed };
};
