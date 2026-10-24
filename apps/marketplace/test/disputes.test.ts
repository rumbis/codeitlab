import { describe, expect, it } from "vite-plus/test";

import type { Engagement, LedgerEntry } from "../src/shared/contracts.ts";
import {
  PaymentProviderError,
  createMockPaymentProvider,
  type PaymentProvider,
} from "../src/server/payments.ts";
import {
  TEST_ADMIN_TOKEN,
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

interface LedgerPayload {
  entries: LedgerEntry[];
  totals: { payoutCents: number; refundedCents: number; heldCents: number };
}

interface ReconcilePayload {
  ok: boolean;
  problems: { engagementId: string; detail: string }[];
}

function newApp(overrides: { paymentProvider?: PaymentProvider } = {}): TestApp {
  return createTestApp({ autoApprove: true, ...overrides });
}

const ADMIN_HEADERS = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

async function setupDisputed(app: TestApp, amountCents = 12_000) {
  const business: SignedIn = await app.signIn("owner@dispute.test", "business");
  const coder: SignedIn = await app.signIn("coder@dispute.test", "coder");
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
  const disputed = await app.request(`/api/engagements/${engagementId}/dispute`, {
    method: "POST",
    cookie: business.cookie,
  });
  expect(disputed.status).toBe(200);
  return { business, coder, job, engagementId };
}

async function getEngagement(app: TestApp, cookie: string, id: string): Promise<Engagement> {
  const response = await app.json<{ engagements: Engagement[] }>("/api/engagements", { cookie });
  expect(response.response.status).toBe(200);
  const engagement = response.body.engagements.find((candidate) => candidate.id === id);
  if (engagement === undefined) throw new Error(`engagement ${id} missing from the list`);
  return engagement;
}

async function resolve(
  app: TestApp,
  engagementId: string,
  outcome: string,
  note: string,
  token = TEST_ADMIN_TOKEN,
) {
  return app.json<{ engagement?: Engagement; error?: string }>(
    `/api/admin/disputes/${engagementId}/resolve`,
    { method: "POST", form: { outcome, note }, headers: { authorization: `Bearer ${token}` } },
  );
}

async function ledger(app: TestApp): Promise<LedgerPayload> {
  const response = await app.json<LedgerPayload>("/api/admin/ledger", {
    headers: ADMIN_HEADERS,
  });
  expect(response.response.status).toBe(200);
  return response.body;
}

async function reconcile(app: TestApp): Promise<ReconcilePayload> {
  const response = await app.json<ReconcilePayload>("/api/admin/reconcile", {
    headers: ADMIN_HEADERS,
  });
  expect(response.response.status).toBe(200);
  return response.body;
}

describe("dispute resolution", () => {
  it("refunds the business and records the decision", async () => {
    const app = newApp();
    const { business, coder, engagementId } = await setupDisputed(app);

    const resolved = await resolve(
      app,
      engagementId,
      "refunded",
      "The delivery does not match the job scope; refunding.",
    );
    expect(resolved.response.status).toBe(303);

    const engagement = await getEngagement(app, business.cookie, engagementId);
    expect(engagement.status).toBe("cancelled");
    expect(engagement.resolutionOutcome).toBe("refunded");
    expect(engagement.resolutionNote).toContain("does not match");

    const report = await ledger(app);
    expect(report.totals.refundedCents).toBe(12_000);
    expect(report.totals.heldCents).toBe(0);
    expect(
      report.entries
        .filter((entry) => entry.engagementId === engagementId)
        .map((entry) => entry.kind)
        .sort(),
    ).toEqual(["charge", "refund"]);
    expect((await reconcile(app)).ok).toBe(true);

    const coderView = await getEngagement(app, coder.cookie, engagementId);
    expect(coderView.resolutionNote).toContain("refunding");
  });

  it("releases the escrow to the coder with the same payout path as approve", async () => {
    const payments = createMockPaymentProvider();
    const app = newApp({ paymentProvider: payments });
    const { business, coder, engagementId } = await setupDisputed(app);

    const resolved = await resolve(
      app,
      engagementId,
      "released",
      "Evidence shows the work was delivered as scoped; releasing.",
    );
    expect(resolved.response.status).toBe(303);

    const engagement = await getEngagement(app, coder.cookie, engagementId);
    expect(engagement.status).toBe("paid_out");
    expect(engagement.resolutionOutcome).toBe("released");
    expect(engagement.resolutionNote).toContain("releasing");

    expect(payments.intents?.filter((intent) => intent.kind === "payout")).toHaveLength(1);
    expect(payments.intents?.find((intent) => intent.kind === "payout")?.amountCents).toBe(10_200);

    const report = await ledger(app);
    expect(report.totals.payoutCents).toBe(10_200);
    expect(
      report.entries
        .filter((entry) => entry.engagementId === engagementId)
        .map((entry) => entry.kind)
        .sort(),
    ).toEqual(["charge", "payout", "platform_fee"]);
    expect((await reconcile(app)).ok).toBe(true);
    void business;
  });

  it("refuses a second resolution and pays out once", async () => {
    const payments = createMockPaymentProvider();
    const app = newApp({ paymentProvider: payments });
    const { engagementId } = await setupDisputed(app);

    expect(
      (await resolve(app, engagementId, "released", "First decision, paying out.")).response.status,
    ).toBe(303);
    const second = await resolve(
      app,
      engagementId,
      "refunded",
      "Second decision, should be refused.",
    );
    expect(second.response.status).toBe(409);
    expect(second.body.error).toBe("illegal_transition");
    expect(payments.intents?.filter((intent) => intent.kind === "payout")).toHaveLength(1);
  });

  it("requires an admin token, a disputed engagement and a readable note", async () => {
    const app = newApp();
    const { business, engagementId } = await setupDisputed(app);

    const noToken = await resolve(app, engagementId, "refunded", "Refunding the business.", "");
    expect(noToken.response.status).toBe(401);

    const badOutcome = await resolve(app, engagementId, "keep", "Refunding the business.");
    expect(badOutcome.response.status).toBe(400);
    expect(badOutcome.body.error).toBe("invalid_outcome");

    const shortNote = await resolve(app, engagementId, "refunded", "nope");
    expect(shortNote.response.status).toBe(400);
    expect(shortNote.body.error).toBe("invalid_resolution_note");

    // A non-disputed engagement cannot be resolved even by the admin.
    const notDisputed = await app.json<{ engagement: Engagement }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: "missing", coderId: "missing", amountCents: 5_000 },
    });
    expect(notDisputed.response.status).toBe(404);

    // The disputed one is untouched by all the rejected attempts.
    expect((await getEngagement(app, business.cookie, engagementId)).status).toBe("disputed");
  });

  it("keeps the engagement disputed when the payout provider declines", async () => {
    const declining: PaymentProvider = {
      name: "declining",
      async charge() {
        return { paymentRef: "mock_charge_declining", settled: true };
      },
      async payout() {
        throw new PaymentProviderError(402, "card_declined", "The payout was declined.");
      },
    };
    const app = newApp({ paymentProvider: declining });
    const { business, engagementId } = await setupDisputed(app);

    const resolved = await resolve(
      app,
      engagementId,
      "released",
      "Evidence looks good; releasing.",
    );
    expect(resolved.response.status).toBe(402);

    const engagement = await getEngagement(app, business.cookie, engagementId);
    expect(engagement.status).toBe("disputed");
    expect(engagement.resolutionOutcome).toBe("");
    expect(
      (await ledger(app)).entries.filter((entry) => entry.engagementId === engagementId),
    ).toHaveLength(1);
    expect((await reconcile(app)).ok).toBe(true);
  });
});
