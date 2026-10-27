import * as Effect from "effect/Effect";

import * as Electron from "electron";

import * as DesktopWindow from "./DesktopWindow.ts";

export const DEFAULT_QUICK_OVERLAY_ACCELERATOR = "CommandOrControl+Shift+Space";
export const QUICK_OVERLAY_ACCELERATOR_ENV = "CODEITLAB_QUICK_OVERLAY_SHORTCUT";

export interface QuickOverlayShortcutRegistration {
  readonly registered: boolean;
  readonly message: string | null;
}

/**
 * The accelerator comes from the environment so a headless or packaged run can
 * move it without a settings round-trip; the default is the one the docs show.
 */
export function quickOverlayAccelerator(env: Readonly<Record<string, string | undefined>>): string {
  const configured = env[QUICK_OVERLAY_ACCELERATOR_ENV]?.trim();
  return configured === undefined || configured === ""
    ? DEFAULT_QUICK_OVERLAY_ACCELERATOR
    : configured;
}

/**
 * `globalShortcut.register` returns false when the OS or another app already
 * owns the chord. That is a normal condition, not an error: report it so the
 * renderer can say so instead of pretending the shortcut exists.
 */
export function registerQuickOverlayShortcut(
  globalShortcut: Pick<typeof Electron.globalShortcut, "register">,
  accelerator: string,
  onOpen: () => void,
): QuickOverlayShortcutRegistration {
  try {
    if (globalShortcut.register(accelerator, onOpen)) {
      return { registered: true, message: null };
    }
    return {
      registered: false,
      message: `The quick overlay shortcut ${accelerator} is already used by the system or another app. Set ${QUICK_OVERLAY_ACCELERATOR_ENV} to a different accelerator.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return {
      registered: false,
      message: `The quick overlay shortcut ${accelerator} could not be registered.${detail}`,
    };
  }
}

/**
 * Register once the app is ready and the window service exists. A failure is
 * surfaced in the renderer; it never blocks startup.
 */
export const install = Effect.gen(function* () {
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const registration = registerQuickOverlayShortcut(
    Electron.globalShortcut,
    quickOverlayAccelerator(process.env),
    () => {
      void Effect.runPromise(desktopWindow.dispatchQuickOverlayOpen.pipe(Effect.ignoreCause));
    },
  );
  if (!registration.registered) {
    yield* desktopWindow
      .dispatchQuickOverlayUnavailable(registration.message ?? "Quick overlay unavailable.")
      .pipe(Effect.ignoreCause);
  }
  return registration;
}).pipe(Effect.withSpan("desktop.quickOverlay.install"));
