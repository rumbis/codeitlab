import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeitlabMarketplacePage } from "./CodeitlabMarketplacePage";

const openButton = (screen: { container: HTMLElement }) =>
  [...screen.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open marketplace",
  );

const mock = vi.hoisted(() => ({
  url: "",
  updates: [] as Array<{ marketplace: { url: string } }>,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeitlabSettingsWriter: (() => ({
    codeitlab: { marketplace: { url: mock.url } },
    environmentId: null,
    update: (patch: { marketplace: { url: string } }) => {
      mock.updates.push(patch);
      mock.url = patch.marketplace.url;
      return { marketplace: mock.url };
    },
  })) as never,
}));

describe("marketplace page", () => {
  it("says the marketplace is not configured and keeps the button disabled", async () => {
    mock.url = "";
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    expect(screen.getByText(/Not configured/)).not.toBeNull();
    expect(openButton(screen)?.disabled).toBe(true);
  });

  it("rejects a non-http address instead of opening it", async () => {
    mock.url = "market.example.com";
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    expect(screen.getByText(/not an http\(s\) address/)).not.toBeNull();
    expect(openButton(screen)?.disabled).toBe(true);
  });

  it("enables opening once an https address is set", async () => {
    mock.url = "https://market.example.com";
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    expect(screen.getByText(/Configured\./)).not.toBeNull();
    expect(openButton(screen)?.disabled).toBe(false);
  });

  it("saves the address as it is typed", async () => {
    mock.url = "";
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    await userEvent.fill(screen.getByLabelText("Marketplace URL"), "https://m.example");
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.marketplace.url).toBe("https://m.example");
  });

  it("is reachable by keyboard in one tab order", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    const input = screen.container.querySelector<HTMLInputElement>("#marketplace-url");
    input?.focus();
    expect(document.activeElement).toBe(input);
    expect(input?.tabIndex).toBe(0);
    const button = openButton(screen);
    button?.focus();
    // A disabled action is not focusable, so it cannot look like an offer that
    // is ready to use.
    expect(button?.disabled).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("opens the address in the browser without calling the marketplace itself", async () => {
    mock.url = "https://market.example.com";
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const fetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    try {
      await using screen = await renderUi(<CodeitlabMarketplacePage />);
      const button = openButton(screen);
      await userEvent.click(button as HTMLElement);
      expect(open).toHaveBeenCalledWith(
        "https://market.example.com",
        "_blank",
        "noopener,noreferrer",
      );
      // The panel stores an address and hands it to the browser; it never
      // fetches the marketplace, so nothing is proxied through the app.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      open.mockRestore();
    }
  });

  it("states the fee and escrow model without leaving the app", async () => {
    mock.url = "https://market.example.com";
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    expect(screen.getByText("What the marketplace charges, in plain numbers")).not.toBeNull();
    expect(screen.getByText(/15%/)).not.toBeNull();
    expect(screen.getByText(/20%/)).not.toBeNull();
    expect(screen.getByText(/Payment sits in escrow/)).not.toBeNull();
    expect(screen.getByText(/integer cents/)).not.toBeNull();
    expect(
      screen.getByText(/Payments are handled by that deployment, not by this app/),
    ).not.toBeNull();
  });

  it("explains every escrow state in plain words", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    expect(screen.getByText("What each escrow state means")).not.toBeNull();
    for (const status of [
      "requested",
      "accepted",
      "in_progress",
      "delivered",
      "approved",
      "paid_out",
      "cancelled",
      "disputed",
    ]) {
      expect(screen.getByText(status)).not.toBeNull();
    }
    expect(screen.getByText(/the charge was refunded in full/)).not.toBeNull();
    expect(screen.getByText(/the money stays in escrow until it is resolved/)).not.toBeNull();
  });

  it("explains who resolves a dispute and what the outcomes are", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    expect(screen.getByText("If something goes wrong")).not.toBeNull();
    expect(screen.getByText(/written reason/)).not.toBeNull();
    expect(screen.getByText("refunded")).not.toBeNull();
    expect(screen.getByText("released")).not.toBeNull();
    expect(screen.getByText(/This app does not mediate/)).not.toBeNull();
  });

  it("says what a buyer agrees to before escrow", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeitlabMarketplacePage />);
    expect(screen.getByText("What you agree to before the money moves")).not.toBeNull();
    expect(screen.getByText(/budget range/)).not.toBeNull();
    expect(screen.getByText(/one active engagement/)).not.toBeNull();
    expect(screen.getByText(/cannot be charged at the self-serve tier/)).not.toBeNull();
  });
});
