import { describe, expect, it, vi } from "vite-plus/test";

import {
  createPwaInstallStore,
  PWA_INSTALL_DISMISSED_STORAGE_KEY,
  readPwaInstallDismissed,
  resolvePwaInstallBanner,
  writePwaInstallDismissed,
  type PwaInstallSnapshot,
} from "./install";

type TestStorage = Pick<Storage, "getItem" | "setItem">;

function memoryStorage(initial: Record<string, string> = {}): TestStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function promptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt"), {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  return { event, prompt };
}

function storeFor(
  options: {
    readonly standalone?: boolean;
    readonly iosSafari?: boolean;
    readonly storage?: TestStorage;
  } = {},
) {
  const target = new EventTarget();
  const storage = options.storage ?? memoryStorage();
  const store = createPwaInstallStore({
    target,
    storage,
    isStandalone: () => options.standalone ?? false,
    isIosSafari: () => options.iosSafari ?? false,
  });
  return { store, target, storage };
}

const HIDDEN: PwaInstallSnapshot = {
  installed: false,
  dismissed: false,
  canPrompt: false,
  iosSafari: false,
};

describe("resolvePwaInstallBanner", () => {
  it("stays hidden when installed or dismissed", () => {
    expect(resolvePwaInstallBanner({ ...HIDDEN, installed: true })).toBe("hidden");
    expect(resolvePwaInstallBanner({ ...HIDDEN, dismissed: true })).toBe("hidden");
  });

  it("prefers the native prompt over iOS instructions", () => {
    expect(resolvePwaInstallBanner({ ...HIDDEN, canPrompt: true, iosSafari: true })).toBe("prompt");
  });

  it("falls back to iOS instructions when Safari has no prompt", () => {
    expect(resolvePwaInstallBanner({ ...HIDDEN, iosSafari: true })).toBe("ios-instructions");
  });

  it("stays hidden when the browser offers no install path", () => {
    expect(resolvePwaInstallBanner(HIDDEN)).toBe("hidden");
  });
});

describe("install dismissal storage", () => {
  it("round-trips the dismissal flag", () => {
    const storage = memoryStorage();
    expect(readPwaInstallDismissed(storage)).toBe(false);
    writePwaInstallDismissed(storage);
    expect(storage.getItem(PWA_INSTALL_DISMISSED_STORAGE_KEY)).toBe("1");
    expect(readPwaInstallDismissed(storage)).toBe(true);
  });

  it("treats unavailable storage as not dismissed", () => {
    expect(readPwaInstallDismissed(null)).toBe(false);
    expect(
      readPwaInstallDismissed({
        getItem: () => {
          throw new Error("storage disabled");
        },
      }),
    ).toBe(false);
    expect(() =>
      writePwaInstallDismissed({
        setItem: () => {
          throw new Error("storage disabled");
        },
      }),
    ).not.toThrow();
  });
});

describe("createPwaInstallStore", () => {
  it("captures the browser prompt and installs on request", async () => {
    const { store, target } = storeFor();
    expect(store.getSnapshot().canPrompt).toBe(false);

    const { event, prompt } = promptEvent("accepted");
    target.dispatchEvent(event);
    expect(store.getSnapshot().canPrompt).toBe(true);

    await expect(store.install()).resolves.toBe("accepted");
    expect(prompt).toHaveBeenCalledOnce();
    expect(store.getSnapshot().installed).toBe(true);
    expect(store.getSnapshot().canPrompt).toBe(false);
    store.dispose();
  });

  it("reports a dismissed native prompt and drops the captured event", async () => {
    const { store, target } = storeFor();
    target.dispatchEvent(promptEvent("dismissed").event);

    await expect(store.install()).resolves.toBe("dismissed");
    expect(store.getSnapshot().canPrompt).toBe(false);
    await expect(store.install()).resolves.toBe("unavailable");
    store.dispose();
  });

  it("remembers a dismissal for the next visit", () => {
    const storage = memoryStorage();
    const first = storeFor({ storage });
    first.store.dismiss();
    expect(storage.getItem(PWA_INSTALL_DISMISSED_STORAGE_KEY)).toBe("1");

    const second = storeFor({ storage });
    expect(second.store.getSnapshot().dismissed).toBe(true);
    expect(resolvePwaInstallBanner(second.store.getSnapshot())).toBe("hidden");
    first.store.dispose();
    second.store.dispose();
  });

  it("ignores install prompts when already running standalone", () => {
    const { store, target } = storeFor({ standalone: true });
    target.dispatchEvent(promptEvent().event);

    expect(store.getSnapshot().installed).toBe(true);
    expect(store.getSnapshot().canPrompt).toBe(false);
    store.dispose();
  });

  it("hides after the app reports it was installed", () => {
    const { store, target } = storeFor();
    target.dispatchEvent(promptEvent().event);
    expect(store.getSnapshot().canPrompt).toBe(true);

    target.dispatchEvent(new Event("appinstalled"));
    expect(store.getSnapshot().installed).toBe(true);
    expect(resolvePwaInstallBanner(store.getSnapshot())).toBe("hidden");
    store.dispose();
  });

  it("notifies subscribers until disposed", () => {
    const { store, target } = storeFor();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    target.dispatchEvent(promptEvent().event);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.dismiss();
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
  });
});
