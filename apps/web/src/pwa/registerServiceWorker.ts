import { isElectron } from "../env";

/**
 * Dev keeps a stale service worker out of the way unless it is explicitly
 * requested with `?sw=1`; Electron loads from a file-backed shell where a
 * service worker has nothing useful to cache.
 */
export interface ServiceWorkerRegistrationEnvironment {
  readonly isSecureContext: boolean;
  readonly isElectron: boolean;
  readonly isProduction: boolean;
  readonly forceServiceWorker: boolean;
}

export function shouldRegisterServiceWorker(
  environment: ServiceWorkerRegistrationEnvironment,
): boolean {
  if (!environment.isSecureContext || environment.isElectron) return false;
  return environment.isProduction || environment.forceServiceWorker;
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  const forceServiceWorker = new URLSearchParams(window.location.search).get("sw") === "1";
  if (
    !shouldRegisterServiceWorker({
      isSecureContext: window.isSecureContext,
      isElectron,
      isProduction: import.meta.env.PROD,
      forceServiceWorker,
    })
  ) {
    return;
  }

  void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
    console.warn("CodeItLab service worker registration failed", error);
  });
}
