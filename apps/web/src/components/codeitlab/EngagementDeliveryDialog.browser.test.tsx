import type {
  CodeItLabDeliveryDraft,
  CodeItLabDeliveryHandoff,
  CodeItLabDeliveryResult,
  CodeItLabEngagement,
  CodeItLabEngagementBridge,
} from "@codeitlab/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { render as renderUi } from "../../../test/render";
import { EngagementDeliveryDialog } from "./EngagementDeliveryDialog";

const mock = vi.hoisted(() => ({
  bridge: null as unknown,
  engagements: [] as unknown[],
  isPending: false,
  error: null as string | null,
  draftResult: null as unknown,
  handoffResult: null as unknown,
  deliverResult: null as unknown,
  threadIds: [] as string[],
  loadDraftInputs: [] as Array<{ engagementId: string; jobTitle: string; amountLabel: string }>,
  loadHandoffInputs: [] as Array<{ engagementId: string; jobTitle: string; amountLabel: string }>,
  deliverInputs: [] as Array<{
    engagementId: string;
    note: string;
    evidence: ReadonlyArray<string>;
  }>,
}));

vi.mock(import("../../codeitlab/engagements"), async (original) => {
  const { useState } = await import("react");
  return {
    ...(await original()),
    useEngagementDelivery: ((threadId: string) => {
      mock.threadIds.push(threadId);
      const [draft, setDraft] = useState<CodeItLabDeliveryDraft | null>(null);
      const [handoff, setHandoff] = useState<CodeItLabDeliveryHandoff | null>(null);
      const [lastResult, setLastResult] = useState<CodeItLabDeliveryResult | null>(null);
      return {
        bridge: mock.bridge,
        engagements: mock.engagements,
        isPending: mock.isPending,
        error: mock.error,
        draft,
        draftPending: false,
        handoff,
        handoffPending: false,
        deliverPending: false,
        lastResult,
        loadDraft: async (engagementId: string, jobTitle: string, amountLabel: string) => {
          mock.loadDraftInputs.push({ engagementId, jobTitle, amountLabel });
          const next = mock.draftResult as CodeItLabDeliveryDraft | null;
          setDraft(next);
          return next;
        },
        loadHandoff: async (engagementId: string, jobTitle: string, amountLabel: string) => {
          mock.loadHandoffInputs.push({ engagementId, jobTitle, amountLabel });
          const next = mock.handoffResult as CodeItLabDeliveryHandoff | null;
          setHandoff(next);
          return next;
        },
        deliver: async (engagementId: string, note: string, evidence: ReadonlyArray<string>) => {
          mock.deliverInputs.push({ engagementId, note, evidence });
          const result = mock.deliverResult as CodeItLabDeliveryResult | null;
          setLastResult(result);
          return result;
        },
        refresh: () => {},
      };
    }) as never,
  };
});

const USABLE: CodeItLabEngagementBridge = {
  url: "https://acme.example/market",
  configured: true,
  tokenPresent: true,
  enabled: true,
  readOnly: false,
  reason: "",
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

const CODER_WAITING: CodeItLabEngagement = {
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

const BUSINESS_WAITING: CodeItLabEngagement = {
  id: "eng-2",
  jobTitle: "Fix the onboarding email",
  role: "business",
  counterpartName: "Mira",
  status: "in_progress",
  amountCents: 40_000,
  currency: "EUR",
  nextStep: "Review the delivery when it arrives.",
  updatedAt: "2026-10-23T08:00:00.000Z",
};

const CODER_DELIVERED: CodeItLabEngagement = {
  ...CODER_WAITING,
  id: "eng-3",
  jobTitle: "Ship the search filters",
  status: "delivered",
};

const DRAFT: CodeItLabDeliveryDraft = {
  engagementId: "eng-1",
  threadId: "thread-1",
  threadTitle: "Pricing page work",
  note: "Delivered: Redesign the pricing page\n\nChanged 2 file(s) changed on main, +120 −8.",
  handoff:
    "What was built\nThe pricing page now has a comparison table.\n\nWhat it cost\n2500.00 USD.",
  files: [
    { path: "src/pricing.tsx", insertions: 100, deletions: 6 },
    { path: "src/pricing.css", insertions: 20, deletions: 2 },
  ],
  fileCount: 2,
  insertions: 120,
  deletions: 8,
  branch: "main",
  reason: "",
};

const CLEAN_TREE_DRAFT: CodeItLabDeliveryDraft = {
  ...DRAFT,
  note: "Delivered: Redesign the pricing page\n\nChanged 0 file(s) changed on main, +0 −0.",
  files: [],
  fileCount: 0,
  insertions: 0,
  deletions: 0,
  reason: "No changed files in that thread's working tree yet.",
};

const DELIVERED: CodeItLabDeliveryResult = {
  delivered: true,
  engagement: { ...CODER_WAITING, status: "delivered" },
  bridge: USABLE,
  reason: "",
};

const REFUSED: CodeItLabDeliveryResult = {
  delivered: false,
  engagement: null,
  bridge: USABLE,
  reason: "Cannot deliver an engagement that is delivered.",
};

const HANDOFF: CodeItLabDeliveryHandoff = {
  engagementId: "eng-1",
  threadId: "thread-1",
  summary: "The pricing page now has a comparison table.",
  body: "What was built\nThe pricing page now has a comparison table.\n\nHow it runs\nOpen /pricing to see it.",
  generated: true,
  model: "anthropic/claude-sonnet-4",
  reason: "",
  draft: DRAFT,
};

const DETERMINISTIC: CodeItLabDeliveryHandoff = {
  ...HANDOFF,
  body: "What was built\nThe pricing page now has a comparison table.",
  generated: false,
  model: null,
  reason: "No model is configured for this thread, so the deterministic handoff is used.",
};

function setup() {
  mock.bridge = USABLE;
  mock.engagements = [CODER_WAITING];
  mock.isPending = false;
  mock.error = null;
  mock.draftResult = DRAFT;
  mock.handoffResult = HANDOFF;
  mock.deliverResult = DELIVERED;
  mock.threadIds = [];
  mock.loadDraftInputs = [];
  mock.loadHandoffInputs = [];
  mock.deliverInputs = [];
}

const openDialog = (threadId = "thread-1") =>
  renderUi(<EngagementDeliveryDialog onOpenChange={() => {}} open={true} threadId={threadId} />);

const pickEngagement = async () => {
  const radio = page.getByRole("radio", { name: /Redesign the pricing page/ });
  await userEvent.click(radio);
  // Attach reads the selected engagement, so the click has to have landed first.
  await expect.element(radio).toBeChecked();
};

/**
 * The draft resolves asynchronously; when the whole codeitlab directory runs in
 * parallel the default one-second poll window is too tight, so give the review
 * step a real budget instead of relying on machine speed.
 */
const DRAFT_WAIT = { timeout: 5_000 } as const;

const attach = async () => {
  await pickEngagement();
  await userEvent.click(page.getByRole("button", { name: "Attach work from this thread" }));
  await expect
    .element(page.getByRole("textbox", { name: "Delivery note" }), DRAFT_WAIT)
    .toBeVisible();
};

describe("EngagementDeliveryDialog", () => {
  it("shows the read-only reason and a settings link instead of the form", async () => {
    setup();
    mock.bridge = READ_ONLY;
    await using _screen = await openDialog();
    await expect.element(page.getByRole("dialog")).toBeVisible();
    expect(page.getByText(READ_ONLY.reason, { exact: true }).element()).toBeDefined();
    const link = page.getByRole("link", { name: "Open the engagements settings" });
    await expect.element(link).toHaveAttribute("href", "/settings/codeitlab/engagements");
    expect(page.getByRole("radio").elements()).toHaveLength(0);
    expect(page.getByRole("textbox", { name: "Delivery note" }).elements()).toHaveLength(0);
    expect(page.getByRole("button", { name: /^Deliver$/ }).elements()).toHaveLength(0);
    expect(document.querySelector("[data-delivery-readonly-reason]")?.textContent).toBe(
      READ_ONLY.reason,
    );
  });

  it("lists only in-progress engagements where this account is the coder", async () => {
    setup();
    mock.engagements = [CODER_WAITING, BUSINESS_WAITING, CODER_DELIVERED];
    await using _screen = await openDialog();
    const radios = page.getByRole("radio").elements();
    expect(radios).toHaveLength(1);
    await expect
      .element(page.getByRole("radio", { name: /Redesign the pricing page — Acme Studio/ }))
      .toBeVisible();
    expect(page.getByText("Fix the onboarding email", { exact: true }).elements()).toHaveLength(0);
  });

  it("says honestly when nothing is waiting for a delivery", async () => {
    setup();
    mock.engagements = [BUSINESS_WAITING, CODER_DELIVERED];
    await using _screen = await openDialog();
    await expect
      .element(page.getByText("No engagement is waiting for a delivery right now."))
      .toBeVisible();
  });

  it("drafts from the selected engagement's thread", async () => {
    setup();
    await using _screen = await openDialog("thread-42");
    await attach();
    expect(mock.threadIds.length).toBeGreaterThan(0);
    expect(mock.threadIds.every((id) => id === "thread-42")).toBe(true);
    expect(mock.loadDraftInputs).toEqual([
      { engagementId: "eng-1", jobTitle: "Redesign the pricing page", amountLabel: "2500.00 USD" },
    ]);
    await expect
      .element(page.getByRole("textbox", { name: "Delivery note" }))
      .toHaveValue(DRAFT.note);
  });

  it("shows the draft reason when the thread has nothing to attach", async () => {
    setup();
    mock.draftResult = CLEAN_TREE_DRAFT;
    await using _screen = await openDialog();
    await attach();
    expect(page.getByText(CLEAN_TREE_DRAFT.reason, { exact: true }).element()).toBeDefined();
    expect(document.body.textContent).toContain("0 file(s) changed");
  });

  it("asks the model for a client explanation and shows the generated body", async () => {
    setup();
    await using _screen = await openDialog();
    await attach();

    await userEvent.click(
      page.getByRole("button", { name: "Explain this delivery to the client" }),
    );
    await expect
      .element(page.getByRole("textbox", { name: "Client explanation" }))
      .toHaveValue(HANDOFF.body);
    expect(mock.loadHandoffInputs).toEqual([
      { engagementId: "eng-1", jobTitle: "Redesign the pricing page", amountLabel: "2500.00 USD" },
    ]);
    await expect
      .element(page.getByText("Written by " + HANDOFF.model!, { exact: true }))
      .toBeVisible();
    expect(page.getByText(HANDOFF.summary, { exact: true }).element()).toBeDefined();
    // Explaining never edits the note or sends anything.
    await expect
      .element(page.getByRole("textbox", { name: "Delivery note" }))
      .toHaveValue(DRAFT.note);
    expect(mock.deliverInputs).toEqual([]);
  });

  it("shows the server reason and the deterministic body when no model answered", async () => {
    setup();
    mock.handoffResult = DETERMINISTIC;
    await using _screen = await openDialog();
    await attach();

    await userEvent.click(
      page.getByRole("button", { name: "Explain this delivery to the client" }),
    );
    await expect.element(page.getByText(DETERMINISTIC.reason, { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Client explanation" }))
      .toHaveValue(DETERMINISTIC.body);
    expect(document.querySelector("[data-delivery-handoff-model]")).toBeNull();
  });

  it("copies the edited explanation into the note without sending", async () => {
    setup();
    await using _screen = await openDialog();
    await attach();

    await userEvent.click(
      page.getByRole("button", { name: "Explain this delivery to the client" }),
    );
    const explanation = page.getByRole("textbox", { name: "Client explanation" });
    await expect.element(explanation).toHaveValue(HANDOFF.body);
    await userEvent.fill(
      explanation as unknown as HTMLTextAreaElement,
      "Here is the edited explanation.",
    );

    await userEvent.click(page.getByRole("button", { name: "Use this text" }));
    await expect
      .element(page.getByRole("textbox", { name: "Delivery note" }))
      .toHaveValue("Here is the edited explanation.");
    expect(mock.deliverInputs).toEqual([]);
  });

  it("keeps Deliver disabled until the note and evidence are sendable", async () => {
    setup();
    await using _screen = await openDialog();
    const deliver = page.getByRole("button", { name: /^Deliver$/ });
    await expect.element(deliver).toBeDisabled();

    await attach();
    await userEvent.fill(
      page.getByRole("textbox", { name: "Delivery note" }) as unknown as HTMLTextAreaElement,
      "",
    );
    await expect.element(deliver).toBeDisabled();
    await expect
      .element(
        page.getByText("Write a delivery note first; the business reads this before approving."),
      )
      .toBeVisible();
    const describedBy = deliver.element().getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toContain(
      "Write a delivery note first",
    );

    await userEvent.fill(
      page.getByRole("textbox", { name: "Delivery note" }) as unknown as HTMLTextAreaElement,
      "Delivered the pricing table.",
    );
    await userEvent.fill(
      page.getByRole("textbox", { name: "Evidence links" }) as unknown as HTMLTextAreaElement,
      "not-a-url",
    );
    await expect.element(deliver).toBeDisabled();
    await expect.element(page.getByText("Evidence must be full http(s) URLs.")).toBeVisible();
    expect(mock.deliverInputs).toEqual([]);
  });

  it("delivers the trimmed note and one evidence link per line", async () => {
    setup();
    await using _screen = await openDialog();
    await attach();
    await userEvent.fill(
      page.getByRole("textbox", { name: "Delivery note" }) as unknown as HTMLTextAreaElement,
      "  Delivered the pricing table.  ",
    );
    await userEvent.fill(
      page.getByRole("textbox", { name: "Evidence links" }) as unknown as HTMLTextAreaElement,
      "https://acme.example/pr/1\n\nhttps://acme.example/deploy/2",
    );
    await userEvent.click(page.getByRole("button", { name: /^Deliver$/ }));
    await vi.waitFor(() =>
      expect(mock.deliverInputs).toEqual([
        {
          engagementId: "eng-1",
          note: "Delivered the pricing table.",
          evidence: ["https://acme.example/pr/1", "https://acme.example/deploy/2"],
        },
      ]),
    );
  });

  it("reports a delivery with the marketplace status", async () => {
    setup();
    await using _screen = await openDialog();
    await attach();
    await userEvent.click(page.getByRole("button", { name: /^Deliver$/ }));
    await expect
      .element(page.getByText("Delivered. Waiting for the business to approve."))
      .toBeVisible();
    await expect.element(page.getByText("Marketplace status: Delivered.")).toBeVisible();
  });

  it("shows a refusal verbatim and keeps the reviewed note", async () => {
    setup();
    mock.deliverResult = REFUSED;
    await using _screen = await openDialog();
    await attach();
    await userEvent.click(page.getByRole("button", { name: /^Deliver$/ }));
    await expect.element(page.getByText(REFUSED.reason, { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("textbox", { name: "Delivery note" }))
      .toHaveValue(DRAFT.note);
    expect(
      page.getByText("Delivered. Waiting for the business to approve.").elements(),
    ).toHaveLength(0);
  });
});
