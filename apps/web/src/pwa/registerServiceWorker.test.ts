import { describe, expect, it } from "vite-plus/test";

import { shouldRegisterServiceWorker } from "./registerServiceWorker";

const BASE = {
  isSecureContext: true,
  isElectron: false,
  isProduction: true,
  forceServiceWorker: false,
} as const;

describe("shouldRegisterServiceWorker", () => {
  it("registers in a secure production build outside Electron", () => {
    expect(shouldRegisterServiceWorker(BASE)).toBe(true);
  });

  it("keeps dev quiet unless the service worker is requested explicitly", () => {
    expect(shouldRegisterServiceWorker({ ...BASE, isProduction: false })).toBe(false);
    expect(
      shouldRegisterServiceWorker({
        ...BASE,
        isProduction: false,
        forceServiceWorker: true,
      }),
    ).toBe(true);
  });

  it("never registers in Electron", () => {
    expect(shouldRegisterServiceWorker({ ...BASE, isElectron: true })).toBe(false);
  });

  it("never registers in an insecure context", () => {
    expect(shouldRegisterServiceWorker({ ...BASE, isSecureContext: false })).toBe(false);
  });
});
