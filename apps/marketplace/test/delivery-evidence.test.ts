import { describe, expect, it } from "vite-plus/test";

import type { Engagement, LedgerEntry } from "../src/shared/contracts.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

interface EngagementPayload {
  engagement: Engagement;
}

function newApp(): TestApp {
  return createTestApp({ autoApprove: true });
}

async function setupInProgress(app: TestApp, amountCents = 12_000) {
  const business: SignedIn = await app.signIn("owner@delivery.test", "business");
  const coder: SignedIn = await app.signIn("coder@delivery.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript, SQLite",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript, SQLite",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
  });
  await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this in two weeks." },
  });
  const created = await app.json<EngagementPayload>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents },
  });
  expect(created.response.status).toBe(201);
  const engagementId = created.body.engagement.id;

  for (const action of ["accept", "start"] as const) {
    const moved = await app.request(`/api/engagements/${engagementId}/${action}`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(moved.status).toBe(200);
  }
  return { business, coder, profile, job, engagementId };
}

async function getEngagement(app: TestApp, cookie: string, id: string): Promise<Engagement> {
  const response = await app.json<{ engagements: Engagement[] }>("/api/engagements", { cookie });
  expect(response.response.status).toBe(200);
  const engagement = response.body.engagements.find((candidate) => candidate.id === id);
  if (engagement === undefined) throw new Error(`engagement ${id} missing from the list`);
  return engagement;
}

describe("delivery evidence", () => {
  it("stores the note and links and shows them to the business before approval", async () => {
    const app = newApp();
    const { business, coder, engagementId } = await setupInProgress(app);

    const delivered = await app.request(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: {
        deliveryNote: "Booking flow is live on staging, PR has the migration and tests.",
        deliveryEvidence: "https://github.com/example/repo/pull/12\nhttps://staging.example.com",
      },
    });
    expect(delivered.status).toBe(303);

    const engagement = await getEngagement(app, business.cookie, engagementId);
    expect(engagement.status).toBe("delivered");
    expect(engagement.deliveryNote).toContain("Booking flow is live");
    expect(engagement.deliveryEvidence).toEqual([
      "https://github.com/example/repo/pull/12",
      "https://staging.example.com/",
    ]);

    const page = await app.request("/dashboard", { cookie: business.cookie });
    const html = await page.text();
    expect(html).toContain("Delivery evidence");
    expect(html).toContain("Booking flow is live");
    expect(html).toContain("https://github.com/example/repo/pull/12");
    expect(html).toContain("https://staging.example.com/");
    expect(html).toContain("approval releases the escrow");
    expect(html).toContain("Approve and pay out");
  });

  it("rejects invalid evidence and leaves the engagement in progress", async () => {
    const app = newApp();
    const { coder, engagementId } = await setupInProgress(app);

    const rejected = await app.json<{ error: string }>(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: { deliveryEvidence: "not-a-url" },
    });
    expect(rejected.response.status).toBe(400);
    expect(rejected.body.error).toBe("invalid_evidence");

    const engagement = await getEngagement(app, coder.cookie, engagementId);
    expect(engagement.status).toBe("in_progress");
    expect(engagement.deliveryEvidence).toEqual([]);
  });

  it("caps evidence at five links and notes at 2000 characters", async () => {
    const app = newApp();
    const { coder, engagementId } = await setupInProgress(app);

    const tooMany = await app.json<{ error: string }>(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: {
        deliveryEvidence: [1, 2, 3, 4, 5, 6]
          .map((index) => `https://example.com/proof-${index}`)
          .join("\n"),
      },
    });
    expect(tooMany.response.status).toBe(400);
    expect(tooMany.body.error).toBe("invalid_evidence");

    const tooLong = await app.json<{ error: string }>(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: { deliveryNote: "x".repeat(2_001) },
    });
    expect(tooLong.response.status).toBe(400);
    expect(tooLong.body.error).toBe("invalid_delivery_note");

    const engagement = await getEngagement(app, coder.cookie, engagementId);
    expect(engagement.status).toBe("in_progress");
  });

  it("keeps the evidence on the paid-out engagement and the ledger unchanged", async () => {
    const app = newApp();
    const { business, coder, engagementId } = await setupInProgress(app, 12_000);

    await app.request(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: {
        deliveryNote: "Done.",
        deliveryEvidence: "https://example.com/proof",
      },
    });
    const approved = await app.json<EngagementPayload>(`/api/engagements/${engagementId}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(approved.response.status).toBe(200);
    expect(approved.body.engagement.status).toBe("paid_out");
    expect(approved.body.engagement.deliveryEvidence).toEqual(["https://example.com/proof"]);

    const ledger = await app.json<{ entries: LedgerEntry[]; totals: { payoutCents: number } }>(
      "/api/admin/ledger",
      { headers: { authorization: "Bearer test-admin-token" } },
    );
    expect(ledger.body.totals.payoutCents).toBe(10_200);
    expect(
      ledger.body.entries
        .filter((entry) => entry.engagementId === engagementId)
        .map((entry) => entry.kind)
        .sort(),
    ).toEqual(["charge", "payout", "platform_fee"]);
  });
});
