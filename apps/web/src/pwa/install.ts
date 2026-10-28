import { isIosSafari, isStandaloneMode } from "./platform";

export { isIosSafari, isStandaloneMode, type PwaInstallPlatform } from "./platform";

/**
 * The browser's install prompt is a one-shot event that fires at most once per
 * page load, so it has to be captured before React mounts the banner. This
 * module owns that capture plus the dismiss memory; the banner only renders the
 * resulting snapshot.
 */
export const PWA_INSTALL_DISMISSED_STORAGE_KEY = "codeitlab:pwa-install-dismissed:v1";

export interface PwaInstallSnapshot {
  /** Already running standalone, or the app told us the install completed. */
  readonly installed: boolean;
  readonly dismissed: boolean;
  /** A `beforeinstallprompt` event is waiting for a user gesture. */
  readonly canPrompt: boolean;
  /** iOS Safari has no install prompt; the user needs the Share menu instead. */
  readonly iosSafari: boolean;
}

export type PwaInstallBannerMode = "hidden" | "prompt" | "ios-instructions";

export type PwaInstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface PwaInstallEnvironment {
  readonly target: EventTarget | null;
  readonly storage: Pick<Storage, "getItem" | "setItem"> | null;
  readonly isStandalone: () => boolean;
  readonly isIosSafari: () => boolean;
}

export interface PwaInstallStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PwaInstallSnapshot;
  install(): Promise<PwaInstallOutcome>;
  dismiss(): void;
  dispose(): void;
}

interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{
    readonly outcome: "accepted" | "dismissed";
    readonly platform: string;
  }>;
  prompt(): Promise<void>;
}

export function resolvePwaInstallBanner(snapshot: PwaInstallSnapshot): PwaInstallBannerMode {
  if (snapshot.installed || snapshot.dismissed) return "hidden";
  if (snapshot.canPrompt) return "prompt";
  if (snapshot.iosSafari) return "ios-instructions";
  return "hidden";
}

export function readPwaInstallDismissed(storage: Pick<Storage, "getItem"> | null): boolean {
  if (storage === null) return false;
  try {
    return storage.getItem(PWA_INSTALL_DISMISSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writePwaInstallDismissed(storage: Pick<Storage, "setItem"> | null): void {
  if (storage === null) return;
  try {
    storage.setItem(PWA_INSTALL_DISMISSED_STORAGE_KEY, "1");
  } catch {
    // Storage can be unavailable (private mode, quota); dismissing still works
    // for this page load, it just is not remembered.
  }
}

export function createPwaInstallStore(
  overrides: Partial<PwaInstallEnvironment> = {},
): PwaInstallStore {
  const environment: PwaInstallEnvironment = {
    ...defaultPwaInstallEnvironment(),
    ...overrides,
  };

  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let appInstalled = false;
  let dismissed = readPwaInstallDismissed(environment.storage);
  const listeners = new Set<() => void>();

  function buildSnapshot(): PwaInstallSnapshot {
    const standalone = environment.isStandalone();
    return {
      installed: appInstalled || standalone,
      dismissed,
      canPrompt: deferredPrompt !== null && !appInstalled && !standalone,
      iosSafari: environment.isIosSafari(),
    };
  }

  let snapshot = buildSnapshot();

  function emit(): void {
    snapshot = buildSnapshot();
    for (const listener of listeners) listener();
  }

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  };

  const onAppInstalled = () => {
    appInstalled = true;
    deferredPrompt = null;
    emit();
  };

  environment.target?.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  environment.target?.addEventListener("appinstalled", onAppInstalled);

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    async install() {
      const event = deferredPrompt;
      if (event === null) return "unavailable";
      deferredPrompt = null;
      emit();
      try {
        await event.prompt();
        const choice = await event.userChoice;
        if (choice.outcome === "accepted") {
          appInstalled = true;
          emit();
        }
        return choice.outcome;
      } catch {
        return "unavailable";
      }
    },
    dismiss() {
      if (dismissed) return;
      dismissed = true;
      writePwaInstallDismissed(environment.storage);
      emit();
    },
    dispose() {
      environment.target?.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      environment.target?.removeEventListener("appinstalled", onAppInstalled);
      listeners.clear();
    },
  };
}

let sharedStore: PwaInstallStore | null = null;

export function getPwaInstallStore(): PwaInstallStore {
  sharedStore ??= createPwaInstallStore();
  return sharedStore;
}

function defaultPwaInstallEnvironment(): PwaInstallEnvironment {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return {
      target: null,
      storage: null,
      isStandalone: () => false,
      isIosSafari: () => false,
    };
  }

  return {
    target: window,
    storage: readLocalStorage(),
    isStandalone: () =>
      isStandaloneMode({
        displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
        navigatorStandalone: navigatorStandalone(),
      }),
    isIosSafari: () => isIosSafari(navigator.userAgent, navigator.maxTouchPoints),
  };
}

function readLocalStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function navigatorStandalone(): boolean {
  return (navigator as Navigator & { readonly standalone?: boolean }).standalone === true;
}
