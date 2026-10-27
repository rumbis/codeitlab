import type {
  CodeItLabEngagement,
  CodeItLabEngagementBridge,
  CodeItLabEngagementMessage,
  CodeItLabEngagementMessageResult,
} from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, fakeTimers, render as renderUi, type Screen } from "../../../test/render";
import { CodeItLabEngagementsPage } from "./CodeItLabEngagementsPage";

const mock = vi.hoisted(() => ({
  bridge: null as unknown,
  engagements: [] as unknown[],
  fetchedAt: null as string | null,
  isPending: false,
  error: null as string | null,
  threadBridge: null as unknown,
  messages: [] as unknown[],
  threadPending: false,
  threadError: null as string | null,
  posted: null as unknown,
  postedInputs: [] as Array<{ engagementId: string; body: string }>,
  configured: [] as unknown[],
  configureResult: null as unknown,
  refreshBridge: vi.fn(),
  refreshList: vi.fn(),
  refreshThread: vi.fn(),
}));

vi.mock(import("../../codeitlab/engagements"), async (original) => ({
  ...(await original()),
  useCodeItLabEngagements: (() => ({
    bridge: mock.bridge,
    engagements: mock.engagements,
    fetchedAt: mock.fetchedAt,
    isPending: mock.isPending,
    error: mock.error,
    refreshBridge: mock.refreshBridge,
    refreshList: mock.refreshList,
    thread: {
      bridge: mock.threadBridge,
      messages: mock.messages,
      fetchedAt: null,
      isPending: mock.threadPending,
      error: mock.threadError,
      refresh: mock.refreshThread,
    },
    postMessage: async (engagementId: string, body: string) => {
      mock.postedInputs.push({ engagementId, body });
      return mock.posted as CodeItLabEngagementMessageResult | null;
    },
    configure: async (input: unknown) => {
      mock.configured.push(input);
      return mock.configureResult as CodeItLabEngagementBridge | null;
    },
  })) as never,
}));

const ACTIVE: CodeItLabEngagement = {
  id: "eng-1",
  jobTitle: "Redesign the pricing page",
  role: "coder",
  counterpartName: "Acme Studio",
  status: "in_progress",
  amountCents: 250_000,
  currency: "USD",
  nextStep: "Deliver the work with a note and evidence.",
  updatedAt: "2026-10-24T09:30:00.000Z",
};

const SETTLED: CodeItLabEngagement = {
  id: "eng-2",
  jobTitle: "Fix the onboarding email",
  role: "business",
  counterpartName: "Mira",
  status: "paid_out",
  amountCents: 40_000,
  currency: "EUR",
  nextStep: "Approved and paid out; leave a rating if you want.",
  updatedAt: "2026-10-20T08:00:00.000Z",
};

const READ_ONLY: CodeItLabEngagementBridge = {
  url: "",
  configured: false,
  tokenPresent: false,
  enabled: false,
  readOnly: true,
  reason:
    "No marketplace URL is configured yet. Add the URL of your own deployment in Settings → CodeItLab → Engagements.",
};

const USABLE: CodeItLabEngagementBridge = {
  url: "https://acme.example/market",
  configured: true,
  tokenPresent: true,
  enabled: true,
  readOnly: false,
  reason: "",
};

function message(patch: Partial<CodeItLabEngagementMessage>): CodeItLabEngagementMessage {
  return {
    id: "msg-1",
    engagementId: "eng-1",
    authorRole: "coder",
    authorName: "You",
    body: "Delivered the new pricing table.",
    evidence: [],
    createdAt: "2026-10-24T10:00:00.000Z",
    ...patch,
  };
}

function setup() {
  mock.bridge = null;
  mock.engagements = [];
  mock.fetchedAt = "2026-10-25T03:00:00.000Z";
  mock.isPending = false;
  mock.error = null;
  mock.threadBridge = null;
  mock.messages = [];
  mock.threadPending = false;
  mock.threadError = null;
  mock.posted = null;
  mock.postedInputs = [];
  mock.configured = [];
  mock.configureResult = null;
  mock.refreshBridge.mockReset();
  mock.refreshList.mockReset();
  mock.refreshThread.mockReset();
}

const openThread = (screen: Screen) =>
  userEvent.click(
    screen.getByRole("button", { name: /open the thread for redesign the pricing page/i }),
  );

describe("CodeItLabEngagementsPage", () => {
  it("says why the bridge is read-only and cannot send", async () => {
    setup();
    mock.bridge = READ_ONLY;
    mock.engagements = [ACTIVE];
    mock.threadBridge = READ_ONLY;
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    expect(screen.container.querySelector("[data-engagement-bridge-reason]")?.textContent).toBe(
      READ_ONLY.reason,
    );

    await openThread(screen);
    expect(screen.container.querySelector("[data-engagement-readonly]")?.textContent).toBe(
      READ_ONLY.reason,
    );
    await expect.element(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
    await expect.element(screen.getByRole("button", { name: /^send$/i })).toBeDisabled();
    expect(mock.postedInputs).toEqual([]);
  });

  it("saves the deployment URL, token and opt-in through configure", async () => {
    setup();
    mock.bridge = READ_ONLY;
    mock.configureResult = USABLE;
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Marketplace deployment URL" }),
      "https://acme.example/market",
    );
    await userEvent.type(screen.getByLabelText("Marketplace API token"), "tok_123");
    await userEvent.click(screen.getByRole("switch", { name: "Opt in to reading and posting" }));
    await userEvent.click(screen.getByRole("button", { name: /save bridge/i }));

    await vi.waitFor(() =>
      expect(mock.configured).toEqual([
        { url: "https://acme.example/market", token: "tok_123", enabled: true },
      ]),
    );
    await vi.waitFor(() => expect(screen.getByText("Saved the marketplace bridge.")).toBeDefined());
  });

  it("refuses a URL that is not http(s) before calling configure", async () => {
    setup();
    mock.bridge = READ_ONLY;
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Marketplace deployment URL" }),
      "javascript:alert(1)",
    );
    await userEvent.click(screen.getByRole("button", { name: /save bridge/i }));
    expect(
      screen.getByText("The marketplace URL must start with http:// or https://."),
    ).toBeDefined();
    expect(mock.configured).toEqual([]);
  });

  it("turns the bridge off without dropping the URL", async () => {
    setup();
    mock.bridge = USABLE;
    mock.configureResult = {
      ...USABLE,
      enabled: false,
      readOnly: true,
      reason:
        "The marketplace bridge is turned off. Turn it on to read engagements and send messages.",
    };
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    await userEvent.click(screen.getByRole("switch", { name: "Read and post to the marketplace" }));
    await vi.waitFor(() =>
      expect(mock.configured).toEqual([{ url: "https://acme.example/market", enabled: false }]),
    );
  });

  it("lists active engagements first with amount, status and next step", async () => {
    setup();
    mock.bridge = USABLE;
    mock.engagements = [SETTLED, ACTIVE];
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    const ids = Array.from(screen.container.querySelectorAll("[data-engagement-id]")).map((row) =>
      row.getAttribute("data-engagement-id"),
    );
    expect(ids).toEqual(["eng-1", "eng-2"]);
    expect(screen.getByText("Redesign the pricing page")).toBeDefined();
    expect(screen.getByText("2500.00 USD")).toBeDefined();
    expect(screen.getByText("In progress")).toBeDefined();
    expect(screen.getByText("working for Acme Studio")).toBeDefined();
    expect(screen.getByText("Next: Deliver the work with a note and evidence.")).toBeDefined();
    expect(screen.getByText("400.00 EUR")).toBeDefined();
    expect(screen.getByText("Paid out")).toBeDefined();
    expect(screen.getByText("hired Mira")).toBeDefined();
  });

  it("opens a thread with both sides and evidence links", async () => {
    setup();
    mock.bridge = USABLE;
    mock.engagements = [ACTIVE];
    mock.threadBridge = USABLE;
    mock.messages = [
      message({
        evidence: ["https://acme.example/market/deliveries/42"],
      }),
      message({
        id: "msg-2",
        authorRole: "business",
        authorName: "Acme Studio",
        body: "Looks good; approving today.",
        createdAt: "2026-10-24T11:00:00.000Z",
      }),
    ];
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    await openThread(screen);
    expect(screen.getByText("Delivered the new pricing table.")).toBeDefined();
    expect(screen.getByText("Looks good; approving today.")).toBeDefined();
    expect(screen.getByText("You")).toBeDefined();
    expect(screen.getByText("Acme Studio", { exact: true })).toBeDefined();
    const link = screen.getByRole("link", { name: /deliveries\/42/i }).element();
    expect(link.getAttribute("href")).toBe("https://acme.example/market/deliveries/42");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("cannot send an empty message", async () => {
    setup();
    mock.bridge = USABLE;
    mock.engagements = [ACTIVE];
    mock.threadBridge = USABLE;
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    await openThread(screen);
    const send = screen.getByRole("button", { name: /^send$/i });
    await expect.element(send).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "   ");
    await expect.element(send).toBeDisabled();
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Here is the note.");
    await expect.element(send).toBeEnabled();
  });

  it("sends the trimmed body and clears the composer", async () => {
    setup();
    mock.bridge = USABLE;
    mock.engagements = [ACTIVE];
    mock.threadBridge = USABLE;
    mock.posted = {
      posted: true,
      message: message({}),
      bridge: USABLE,
      reason: "",
    };
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    await openThread(screen);
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "  Here is the delivery note.  ");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await vi.waitFor(() =>
      expect(mock.postedInputs).toEqual([
        { engagementId: "eng-1", body: "Here is the delivery note." },
      ]),
    );
    await vi.waitFor(() => expect((box.element() as HTMLTextAreaElement).value).toBe(""));
    expect(screen.getByText("Sent to the marketplace thread.")).toBeDefined();
  });

  it("shows the marketplace refusal instead of pretending it sent", async () => {
    setup();
    mock.bridge = USABLE;
    mock.engagements = [ACTIVE];
    mock.threadBridge = USABLE;
    mock.posted = {
      posted: false,
      message: null,
      bridge: USABLE,
      reason: "The marketplace refused the message (403).",
    };
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    await openThread(screen);
    const box = screen.getByRole("textbox", { name: "Message" });
    await userEvent.type(box, "Please approve.");
    await userEvent.click(screen.getByRole("button", { name: /^send$/i }));
    await vi.waitFor(() =>
      expect(screen.getByText("The marketplace refused the message (403).")).toBeDefined(),
    );
    expect((box.element() as HTMLTextAreaElement).value).toBe("Please approve.");
  });

  it("says there is nothing hired yet and links the configured marketplace", async () => {
    setup();
    mock.bridge = USABLE;
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    expect(screen.getByText("Nothing hired yet")).toBeDefined();
    const link = screen.getByRole("link", { name: /open the marketplace/i }).element();
    expect(link.getAttribute("href")).toBe("https://acme.example/market");
  });

  it("shows no marketplace link when the bridge has no URL", async () => {
    setup();
    mock.bridge = READ_ONLY;
    await using screen = await renderUi(<CodeItLabEngagementsPage />);
    const links = Array.from(screen.container.querySelectorAll("a")).map(
      (anchor) => anchor.textContent,
    );
    expect(links).toEqual([]);
  });

  it("polls the list and the thread every 15 seconds when the bridge is enabled", async () => {
    setup();
    mock.bridge = USABLE;
    mock.engagements = [ACTIVE];
    mock.threadBridge = USABLE;
    using _timers = fakeTimers();
    await using _screen = await renderUi(<CodeItLabEngagementsPage />);
    expect(mock.refreshList).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(mock.refreshList).toHaveBeenCalledTimes(1);
    expect(mock.refreshThread).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(mock.refreshList).toHaveBeenCalledTimes(3);
  });

  it("does not poll a read-only bridge", async () => {
    setup();
    mock.bridge = READ_ONLY;
    mock.engagements = [ACTIVE];
    using _timers = fakeTimers();
    await using _screen = await renderUi(<CodeItLabEngagementsPage />);
    await act(() => vi.advanceTimersByTimeAsync(45_000));
    expect(mock.refreshList).not.toHaveBeenCalled();
    expect(mock.refreshThread).not.toHaveBeenCalled();
  });

  it("pauses polling while the document is hidden", async () => {
    setup();
    mock.bridge = USABLE;
    mock.engagements = [ACTIVE];
    using _timers = fakeTimers();
    let hidden = true;
    using _hidden = vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    await using _screen = await renderUi(<CodeItLabEngagementsPage />);
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(mock.refreshList).not.toHaveBeenCalled();
    hidden = false;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(mock.refreshList).toHaveBeenCalledTimes(1);
  });
});
