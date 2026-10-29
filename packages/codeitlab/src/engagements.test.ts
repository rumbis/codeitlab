import { describe, expect, it } from "vite-plus/test";
import {
  deliveryDraftNote,
  deliveryEvidenceProblem,
  deliveryHandoffNote,
  deliveryNoteProblem,
  ENGAGEMENT_MAX_MESSAGE_LENGTH,
  engagementAvailableActions,
  engagementIsActive,
  engagementMessageProblem,
  engagementNextStep,
  formatEngagementAmount,
  isHttpUrl,
  normalizeMarketplaceUrl,
} from "./engagements.ts";

describe("engagementAvailableActions", () => {
  it("offers the coder the moves that are theirs and no approve", () => {
    const statuses = ["requested", "accepted", "in_progress", "delivered"] as const;
    const offered = statuses.map((status) =>
      engagementAvailableActions("coder", status).map((entry) => entry.action),
    );
    expect(offered).toEqual([
      ["accept", "cancel"],
      ["start", "cancel", "dispute"],
      ["cancel", "dispute"],
      ["dispute"],
    ]);
  });

  it("lets only the business release a delivered engagement", () => {
    const actions = engagementAvailableActions("business", "delivered").map(
      (entry) => entry.action,
    );
    expect(actions).toContain("approve");
    expect(actions).not.toContain("start");
    expect(engagementAvailableActions("coder", "delivered").map((e) => e.action)).not.toContain(
      "approve",
    );
  });

  it("offers nothing once the engagement is over", () => {
    const finished = ["approved", "paid_out", "cancelled", "disputed"] as const;
    for (const role of ["coder", "business"] as const) {
      for (const status of finished) {
        expect(engagementAvailableActions(role, status)).toEqual([]);
      }
    }
  });
});

describe("normalizeMarketplaceUrl", () => {
  it("keeps a deployment mounted under a path and drops the trailing slash", () => {
    expect(normalizeMarketplaceUrl("https://acme.example/market/")).toBe(
      "https://acme.example/market",
    );
    expect(normalizeMarketplaceUrl("  http://localhost:4321  ")).toBe("http://localhost:4321");
  });

  it("refuses a scheme that is not http(s)", () => {
    expect(normalizeMarketplaceUrl("javascript:alert(1)")).toBe("");
    expect(normalizeMarketplaceUrl("file:///etc/passwd")).toBe("");
    expect(normalizeMarketplaceUrl("not a url")).toBe("");
    expect(normalizeMarketplaceUrl("")).toBe("");
  });
});

describe("formatEngagementAmount", () => {
  it("prints cents as a stable amount with the currency code", () => {
    expect(formatEngagementAmount(120_000, "usd")).toBe("1200.00 USD");
    expect(formatEngagementAmount(4_999, "EUR")).toBe("49.99 EUR");
    expect(formatEngagementAmount(0, "")).toBe("0.00 USD");
  });

  it("survives a nonsense amount instead of printing NaN", () => {
    expect(formatEngagementAmount(Number.NaN, "USD")).toBe("0.00 USD");
  });
});

describe("engagementNextStep", () => {
  it("tells the coder what to do next at every live state", () => {
    expect(engagementNextStep("coder", "requested")).toContain("Accept");
    expect(engagementNextStep("coder", "accepted")).toContain("Start");
    expect(engagementNextStep("coder", "in_progress")).toContain("Deliver");
    expect(engagementNextStep("coder", "delivered")).toContain("Wait for the business");
    expect(engagementNextStep("coder", "paid_out")).toContain("Paid out");
  });

  it("tells the business what to do next at every live state", () => {
    expect(engagementNextStep("business", "requested")).toContain("Waiting for the coder");
    expect(engagementNextStep("business", "delivered")).toContain("Review the delivery");
    expect(engagementNextStep("business", "paid_out")).toContain("Approved and paid out");
  });

  it("states the two terminal exceptions plainly", () => {
    expect(engagementNextStep("coder", "cancelled")).toContain("cancelled");
    expect(engagementNextStep("business", "disputed")).toContain("dispute");
  });
});

describe("engagementIsActive", () => {
  it("counts work in flight and not the settled states", () => {
    expect(engagementIsActive("requested")).toBe(true);
    expect(engagementIsActive("delivered")).toBe(true);
    expect(engagementIsActive("paid_out")).toBe(false);
    expect(engagementIsActive("cancelled")).toBe(false);
    expect(engagementIsActive("disputed")).toBe(false);
  });
});

describe("engagementMessageProblem", () => {
  it("rejects an empty or whitespace-only body", () => {
    expect(engagementMessageProblem("")).toBe("Write a message first.");
    expect(engagementMessageProblem("   \n  ")).toBe("Write a message first.");
  });

  it("caps the length instead of truncating silently", () => {
    expect(engagementMessageProblem("ok")).toBe("");
    expect(engagementMessageProblem("x".repeat(ENGAGEMENT_MAX_MESSAGE_LENGTH + 1))).toContain(
      String(ENGAGEMENT_MAX_MESSAGE_LENGTH),
    );
  });
});

describe("isHttpUrl", () => {
  it("accepts http(s) and rejects everything else", () => {
    expect(isHttpUrl("https://acme.example/report")).toBe(true);
    expect(isHttpUrl("http://localhost:3000/x")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
  });
});

describe("delivery note rules", () => {
  it("requires a note and enforces the marketplace's 2000-character cap", () => {
    expect(deliveryNoteProblem("   ")).toContain("Write a delivery note");
    expect(deliveryNoteProblem("x".repeat(2_001))).toContain("at most 2000");
    expect(deliveryNoteProblem("x".repeat(2_000))).toBe("");
  });

  it("accepts only full http(s) evidence links, deduped, at most five", () => {
    expect(deliveryEvidenceProblem(["javascript:alert(1)"])).toContain("http(s)");
    expect(
      deliveryEvidenceProblem([
        "https://a.example/1",
        "https://a.example/1",
        "https://a.example/2",
        "https://a.example/3",
        "https://a.example/4",
        "https://a.example/5",
      ]),
    ).toBe("");
    expect(
      deliveryEvidenceProblem([
        "https://a.example/1",
        "https://a.example/2",
        "https://a.example/3",
        "https://a.example/4",
        "https://a.example/5",
        "https://a.example/6",
      ]),
    ).toContain("at most 5");
  });

  it("composes a delivery note from the changed files and says evidence is missing", () => {
    const note = deliveryDraftNote({
      jobTitle: "Ship the checkout rewrite",
      threadTitle: "checkout",
      files: [
        { path: "src/checkout.ts", insertions: 40, deletions: 3 },
        { path: "src/checkout.test.ts", insertions: 90, deletions: 0 },
      ],
      fileCount: 2,
      insertions: 130,
      deletions: 3,
      branch: "feat/checkout",
    });
    expect(note).toContain("Delivered: Ship the checkout rewrite");
    expect(note).toContain("2 file(s) changed on feat/checkout, +130 −3");
    expect(note).toContain("- src/checkout.ts (+40 −3)");
    expect(note).toContain("the app does not record test results");
  });

  it("lists the first twenty files and counts the rest", () => {
    const files = Array.from({ length: 25 }, (_, index) => ({
      path: "src/file-" + String(index) + ".ts",
      insertions: 1,
      deletions: 0,
    }));
    const note = deliveryDraftNote({
      jobTitle: "",
      threadTitle: "a thread",
      files,
      fileCount: files.length,
      insertions: 25,
      deletions: 0,
      branch: null,
    });
    expect(note).toContain("- … and 5 more file(s)");
    expect(note).toContain("the working tree");
    expect(note.length).toBeLessThanOrEqual(2_000);
  });

  it("explains the delivery to the client in four honest sections", () => {
    const handoff = deliveryHandoffNote({
      jobTitle: "Ship the checkout rewrite",
      threadTitle: "checkout",
      files: [{ path: "src/checkout.ts", insertions: 40, deletions: 3 }],
      fileCount: 1,
      insertions: 40,
      deletions: 3,
      branch: "feat/checkout",
      amountLabel: "1200.00 USD",
    });
    expect(handoff).toContain("What was built");
    expect(handoff).toContain("How it runs");
    expect(handoff).toContain("What it cost");
    expect(handoff).toContain("1200.00 USD");
    expect(handoff).toContain("What was NOT done");
    expect(handoff).toContain("the app cannot know");
    expect(handoff.length).toBeLessThanOrEqual(2_000);
  });

  it("says plainly when the thread has no file changes", () => {
    const handoff = deliveryHandoffNote({
      jobTitle: "",
      threadTitle: "empty thread",
      files: [],
      fileCount: 0,
      insertions: 0,
      deletions: 0,
      branch: null,
    });
    expect(handoff).toContain("No file changes are recorded");
    // Falls back to the thread title when the engagement has no job title.
    expect(handoff).toContain("empty thread.");
  });
});
