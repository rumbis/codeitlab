import { isAutoRouteSelection } from "@codeitlab/contracts";

/**
 * Display copy for the opt-in routing sentinel (`codeitlab_auto` / `auto`).
 *
 * The sentinel is a real persisted selection, so every surface that renders a
 * model selection must translate it. Never leak the raw ids.
 */
export const AUTO_ROUTER_LABEL = "Auto router";
export const AUTO_ROUTER_SUBLABEL = "Best model per task · all enabled apps";

type SelectionLike = { readonly instanceId: unknown; readonly model: unknown } | null | undefined;

/** `"Auto router"` for the sentinel; `null` so callers keep their own label otherwise. */
export function autoRouterLabel(selection: SelectionLike): string | null {
  return isAutoRouteSelection(selection) ? AUTO_ROUTER_LABEL : null;
}

/**
 * A draft selection wins over the thread's, and an absent draft selection means
 * the composer is still following the thread. Mirrors how the composer resolves
 * every other model field.
 */
export function isAutoRouteActiveSelection(input: {
  readonly draftSelection: SelectionLike;
  readonly threadSelection: SelectionLike;
}): boolean {
  if (isAutoRouteSelection(input.draftSelection)) return true;
  return input.draftSelection == null && isAutoRouteSelection(input.threadSelection);
}

/**
 * Whether the composer should present the thread as "Auto router" even though
 * its stored selection is a concrete model: routing is on, the user has not
 * picked a model for this draft, and the selection is just the provider's
 * default. Without this the picker names the default model while the router
 * runs a different one, which looks like the router ignored the picker.
 */
export function routingDecidesComposerSelection(input: {
  readonly routing: { readonly mode: string; readonly enforcement: string } | undefined;
  readonly explicitModelPick: boolean;
  readonly modelIsInstanceDefault: boolean;
  /**
   * A thread that already ran keeps the selection it ended up with: after a run
   * the stored default model may be the model the user explicitly picked, and
   * re-routing it would contradict the picker. Only a fresh thread is routed
   * implicitly; an existing thread opts in by selecting Auto router.
   */
  readonly threadHasStartedRun: boolean;
}): boolean {
  return (
    input.routing !== undefined &&
    input.routing.mode === "auto" &&
    input.routing.enforcement !== "off" &&
    !input.explicitModelPick &&
    !input.threadHasStartedRun &&
    input.modelIsInstanceDefault
  );
}
