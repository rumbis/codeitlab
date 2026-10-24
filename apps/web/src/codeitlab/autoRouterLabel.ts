import { isAutoRouteSelection } from "@t3tools/contracts";

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
