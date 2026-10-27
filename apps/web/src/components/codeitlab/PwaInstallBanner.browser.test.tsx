import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, render as renderUi } from "../../../test/render";
import {
  createPwaInstallStore,
  PWA_INSTALL_DISMISSED_STORAGE_KEY,
  type PwaInstallStore,
} from "../../pwa/install";
import { PwaInstallBanner } from "./PwaInstallBanner";

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

function createStore(
  options: {
    readonly standalone?: boolean;
    readonly iosSafari?: boolean;
    readonly storage?: TestStorage;
  } = {},
): { readonly store: PwaInstallStore; readonly target: EventTarget } {
  const target = new EventTarget();
  const store = createPwaInstallStore({
    target,
    storage: options.storage ?? memoryStorage(),
    isStandalone: () => options.standalone ?? false,
    isIosSafari: () => options.iosSafari ?? false,
  });
  return { store, target };
}

describe("PwaInstallBanner", () => {
  it("offers the captured install prompt and installs on click", async () => {
    const { store, target } = createStore();
    await using screen = await renderUi(<PwaInstallBanner store={store} />);
    expect(screen.container.querySelector("[data-pwa-install-banner]")).toBeNull();

    const { event, prompt } = promptEvent("accepted");
    await act(async () => {
      target.dispatchEvent(event);
    });

    await expect.element(screen.getByRole("button", { name: "Install" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Install" }));

    expect(prompt).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole("button", { name: "Install" })).not.toBeInTheDocument();
    store.dispose();
  });

  it("dismisses the banner and remembers it for the next visit", async () => {
    const storage = memoryStorage();
    const first = createStore({ storage });
    await using screen = await renderUi(<PwaInstallBanner store={first.store} />);

    await act(async () => {
      first.target.dispatchEvent(promptEvent().event);
    });
    await expect.element(screen.getByRole("button", { name: "Install" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss install banner" }));

    expect(storage.getItem(PWA_INSTALL_DISMISSED_STORAGE_KEY)).toBe("1");
    expect(screen.container.querySelector("[data-pwa-install-banner]")).toBeNull();
    first.store.dispose();

    const second = createStore({ storage });
    await using nextScreen = await renderUi(<PwaInstallBanner store={second.store} />);
    expect(nextScreen.container.querySelector("[data-pwa-install-banner]")).toBeNull();
    second.store.dispose();
  });

  it("stays hidden when the app is already running standalone", async () => {
    const { store, target } = createStore({ standalone: true });
    await using screen = await renderUi(<PwaInstallBanner store={store} />);

    await act(async () => {
      target.dispatchEvent(promptEvent().event);
    });

    expect(screen.container.querySelector("[data-pwa-install-banner]")).toBeNull();
    store.dispose();
  });

  it("shows Add to Home Screen instructions on iOS Safari", async () => {
    const { store } = createStore({ iosSafari: true });
    await using screen = await renderUi(<PwaInstallBanner store={store} />);

    await expect.element(screen.getByText(/Add to Home Screen/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));

    expect(screen.container.querySelector("[data-pwa-install-banner]")).toBeNull();
    store.dispose();
  });

  it("hides after the browser reports the app was installed", async () => {
    const { store, target } = createStore();
    await using screen = await renderUi(<PwaInstallBanner store={store} />);

    await act(async () => {
      target.dispatchEvent(promptEvent().event);
    });
    await expect.element(screen.getByRole("button", { name: "Install" })).toBeVisible();

    await act(async () => {
      target.dispatchEvent(new Event("appinstalled"));
    });
    await expect.element(screen.getByRole("button", { name: "Install" })).not.toBeInTheDocument();
    store.dispose();
  });
});
