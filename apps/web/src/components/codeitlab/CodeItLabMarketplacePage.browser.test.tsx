import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { CodeItLabMarketplacePage } from "./CodeItLabMarketplacePage";

const openButton = (screen: { container: HTMLElement }) =>
  [...screen.container.querySelectorAll("button")].find(
    (button) => button.textContent === "Open marketplace",
  );

const applyButton = (screen: { container: HTMLElement }) =>
  [...screen.container.querySelectorAll("button")].find((button) => button.textContent === "Apply");

const mock = vi.hoisted(() => ({
  url: "",
  updates: [] as Array<{ marketplace: { url: string } }>,
}));

const apply = vi.hoisted(() => ({
  calls: [] as Array<{ jobId: string; message?: string }>,
  result: null as { applied: boolean; reason?: string } | null,
}));

vi.mock(import("../../codeitlab/effectsSettings"), async (original) => ({
  ...(await original()),
  useCodeItLabSettingsWriter: (() => ({
    codeitlab: { marketplace: { url: mock.url } },
    environmentId: null,
    update: (patch: { marketplace: { url: string } }) => {
      mock.updates.push(patch);
      mock.url = patch.marketplace.url;
      return { marketplace: mock.url };
    },
  })) as never,
}));

vi.mock(import("../../codeitlab/engagements"), async (original) => ({
  ...(await original()),
  // The command belongs to the server; the panel's job is to say what came back.
  useCodeItLabEngagementApplyToJob: (() => async (input: { jobId: string; message?: string }) => {
    apply.calls.push(input);
    return apply.result;
  }) as never,
}));

describe("marketplace page", () => {
  it("says the marketplace is not configured and keeps the button disabled", async () => {
    mock.url = "";
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    expect(screen.getByText(/Not configured/)).not.toBeNull();
    expect(openButton(screen)?.disabled).toBe(true);
  });

  it("leads from the empty state to the address field", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    expect(screen.getByText("Nothing to open yet")).not.toBeNull();
    expect(screen.getByText(/separate deployment/)).not.toBeNull();
    const jump = screen.getByRole("button", { name: "Paste the marketplace address" });
    jump.element().focus();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement?.id).toBe("marketplace-url");
  });

  it("ties the disabled open action to the reason it is disabled", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    const button = openButton(screen);
    expect(button?.getAttribute("aria-describedby")).toBe("marketplace-url-help");
    expect(button?.disabled).toBe(true);
  });

  it("drops the empty state once an address is saved", async () => {
    mock.url = "https://market.example.com";
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    expect(screen.container.textContent).not.toContain("Nothing to open yet");
  });

  it("rejects a non-http address instead of opening it", async () => {
    mock.url = "market.example.com";
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    expect(screen.getByText(/not an http\(s\) address/)).not.toBeNull();
    expect(openButton(screen)?.disabled).toBe(true);
  });

  it("enables opening once an https address is set", async () => {
    mock.url = "https://market.example.com";
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    expect(screen.getByText(/Configured\./)).not.toBeNull();
    expect(openButton(screen)?.disabled).toBe(false);
  });

  it("saves the address as it is typed", async () => {
    mock.url = "";
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    await userEvent.fill(screen.getByLabelText("Marketplace URL"), "https://m.example");
    await vi.waitFor(() => expect(mock.updates.length).toBeGreaterThan(0));
    expect(mock.updates.at(-1)?.marketplace.url).toBe("https://m.example");
  });

  it("is reachable by keyboard in one tab order", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
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
      await using screen = await renderUi(<CodeItLabMarketplacePage />);
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
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
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
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
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
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    expect(screen.getByText("If something goes wrong")).not.toBeNull();
    expect(screen.getByText(/written reason/)).not.toBeNull();
    expect(screen.getByText("refunded")).not.toBeNull();
    expect(screen.getByText("released")).not.toBeNull();
    expect(screen.getByText(/This app does not mediate/)).not.toBeNull();
  });

  it("says what a buyer agrees to before escrow", async () => {
    mock.url = "";
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    expect(screen.getByText("What you agree to before the money moves")).not.toBeNull();
    expect(screen.getByText(/budget range/)).not.toBeNull();
    expect(screen.getByText(/one active engagement/)).not.toBeNull();
    expect(screen.getByText(/cannot be charged at the self-serve tier/)).not.toBeNull();
  });

  it("ties the URL help text to the input and marks invalid values", async () => {
    mock.url = "ftp://market.example.com";
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    const input = screen.container.querySelector("#marketplace-url");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    const helpId = input?.getAttribute("aria-describedby");
    expect(helpId).toBe("marketplace-url-help");
    const help = screen.container.querySelector(`#${helpId}`);
    expect(help?.getAttribute("aria-live")).toBe("polite");
    expect(help?.textContent).toContain("http(s) address");
  });

  it("clears the invalid state for a real http(s) address", async () => {
    mock.url = "https://market.example.com";
    mock.updates.length = 0;
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    const input = screen.container.querySelector("#marketplace-url");
    expect(input?.getAttribute("aria-invalid")).toBe("false");
    expect(screen.getByText(/Configured\. Opening it leaves CodeItLab/)).not.toBeNull();
  });

  it("asks for a job id instead of posting an application without one", async () => {
    mock.url = "https://market.example.com";
    apply.calls.length = 0;
    apply.result = null;
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    await userEvent.click(applyButton(screen) as HTMLElement);
    await vi.waitFor(() =>
      expect(screen.getByText("Set the marketplace URL and a job ID first.")).not.toBeNull(),
    );
    expect(apply.calls).toEqual([]);
  });

  it("shows the marketplace's refusal instead of claiming the application landed", async () => {
    mock.url = "https://market.example.com";
    apply.calls.length = 0;
    apply.result = { applied: false, reason: "This job is no longer open." };
    await using screen = await renderUi(<CodeItLabMarketplacePage />);
    const jobId = screen.container.querySelector<HTMLInputElement>('input[placeholder="Job ID"]');
    await userEvent.type(jobId as HTMLInputElement, "job-42");
    await userEvent.click(applyButton(screen) as HTMLElement);
    await vi.waitFor(() => expect(screen.getByText("This job is no longer open.")).not.toBeNull());
    expect(screen.container.textContent).not.toContain("Applied to job.");
  });
});
