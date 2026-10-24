import type { AppHandler } from "./app.ts";

export const DEFAULT_MAINTENANCE_MINUTES = 15;

/** Minutes between maintenance sweeps; 0 keeps the sweeps manual (cron/button). */
export function maintenanceMinutesFromEnv(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.MARKETPLACE_MAINTENANCE_MINUTES ?? 0);
  return Number.isInteger(raw) && raw >= 0 && raw <= 24 * 60 ? raw : 0;
}

export interface MaintenanceHandle {
  stop(): void;
}

/**
 * Runs the three read-mostly sweeps in the server process itself, so a
 * single-binary deployment does not need an external cron: waiting-delivery
 * reminders, saved-search job alerts and stale-delivery auto-release. The loop
 * is a `setTimeout` chain, not `setInterval`, so a slow sweep can never stack
 * on top of the next one; a failing sweep is logged and the loop continues.
 */
export function startMaintenance(
  app: Pick<AppHandler, "sweep">,
  options: {
    readonly minutes?: number;
    readonly onError?: (error: unknown) => void;
  } = {},
): MaintenanceHandle {
  const minutes = options.minutes ?? maintenanceMinutesFromEnv();
  if (minutes <= 0) return { stop: () => undefined };
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    timer = setTimeout(() => {
      void app
        .sweep()
        .catch((error: unknown) => {
          options.onError?.(error);
        })
        .finally(() => {
          if (!stopped) schedule();
        });
    }, minutes * 60_000);
    timer.unref?.();
  };

  schedule();
  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
