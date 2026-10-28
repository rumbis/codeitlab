import { afterEach, describe, expect, it } from "vite-plus/test";

import { createMockPaymentProvider } from "../src/server/payments.ts";
import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type TestApp,
} from "./helpers.ts";

interface EngagementPayload {
  engagement: {
    id: string;
    jobId: string;
    coderId: string;
    status: string;
    amountCents: number;
    feeCents: number;
    payoutCents: number;
    paymentRef: string;
  };
}

interface LedgerPayload {
  totals: {
    chargedCents: number;
    feeCents: number;
    payoutCents: number;
    refundedCents: number;
    heldCents: number;
    entryCount: number;
  };
  entries: Array<{ engagementId: string; kind: string; amountCents: number; note: string }>;
}

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp(overrides);
  apps.push(app);
  return app;
}

async function adminLedger(app: TestApp): Promise<LedgerPayload> {
  const { response, body } = await app.json<LedgerPayload>("/api/admin/ledger", {
    headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
  });
  expect(response.status).toBe(200);
  return body;
}

async function setupEscrow(app: TestApp, amountCents = 12_000) {
  const business = await app.signIn("owner@studio.test", "business");
  const coder = await app.signIn("coder@freelance.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "Node.js, SQLite",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "Node.js, SQLite",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
  });

  const interest = await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this in two weeks." },
  });
  expect(interest.status).toBe(201);

  const created = await app.json<EngagementPayload>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents },
  });
  expect(created.response.status).toBe(201);
  return {
    business,
    coder,
    profile,
    job,
    engagement: created.body.engagement,
  };
}

describe("interests", () => {
  it("lets a coder apply once per job and shows applications to the owner", async () => {
    const app = newApp({ autoApprove: true });
    const business = await app.signIn("owner@studio.test", "business");
    const coder = await app.signIn("coder@freelance.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "React",
    });
    const job = await createJob(app, business.cookie, { skills: "React" });

    const first = await app.request(`/api/jobs/${job.id}/interests`, {
      method: "POST",
      cookie: coder.cookie,
      body: { message: "I have shipped three React apps." },
    });
    expect(first.status).toBe(201);

    const duplicate = await app.request(`/api/jobs/${job.id}/interests`, {
      method: "POST",
      cookie: coder.cookie,
      body: { message: "Again?" },
    });
    expect(duplicate.status).toBe(409);

    const list = await app.json<{
      interests: Array<{ coderId: string; message: string; coder: { displayName: string } | null }>;
      count: number;
    }>(`/api/jobs/${job.id}/interests`, { cookie: business.cookie });
    expect(list.response.status).toBe(200);
    expect(list.body.count).toBe(1);
    expect(list.body.interests[0]?.coderId).toBe(profile.id);
    expect(list.body.interests[0]?.coder?.displayName).toBe("Ada");

    const stranger = await app.signIn("other@studio.test", "business");
    const forbidden = await app.request(`/api/jobs/${job.id}/interests`, {
      cookie: stranger.cookie,
    });
    expect(forbidden.status).toBe(403);

    const coderPostingJob = await app.request("/api/jobs", {
      method: "POST",
      cookie: coder.cookie,
      body: {
        title: "Nope",
        description: "This should not work because coders cannot post.",
        skills: "React",
        budgetMinCents: 1,
        budgetMaxCents: 2,
        timeline: "now",
      },
    });
    expect(coderPostingJob.status).toBe(403);
  });
});

describe("escrow happy path", () => {
  it("charges escrow, moves requested → accepted → in_progress → delivered → paid_out, and records the ledger once", async () => {
    const payments = createMockPaymentProvider();
    const app = newApp({ autoApprove: true, paymentProvider: payments });
    const { business, coder, job, engagement } = await setupEscrow(app, 12_000);

    expect(engagement.status).toBe("requested");
    expect(engagement.amountCents).toBe(12_000);
    expect(engagement.feeCents).toBe(1800);
    expect(engagement.payoutCents).toBe(10_200);
    expect(engagement.paymentRef).toMatch(/^mock_charge_/u);
    expect(payments.intents?.map((intent) => intent.kind)).toEqual(["charge"]);

    const afterCharge = await adminLedger(app);
    expect(afterCharge.totals.chargedCents).toBe(12_000);
    expect(afterCharge.totals.heldCents).toBe(12_000);
    expect(
      afterCharge.entries.filter((entry) => entry.engagementId === engagement.id),
    ).toHaveLength(1);

    const accept = await app.json<EngagementPayload>(`/api/engagements/${engagement.id}/accept`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(accept.response.status).toBe(200);
    expect(accept.body.engagement.status).toBe("accepted");

    const start = await app.json<EngagementPayload>(`/api/engagements/${engagement.id}/start`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(start.body.engagement.status).toBe("in_progress");

    const deliver = await app.json<EngagementPayload>(`/api/engagements/${engagement.id}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(deliver.body.engagement.status).toBe("delivered");

    const approve = await app.json<EngagementPayload>(`/api/engagements/${engagement.id}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(approve.response.status).toBe(200);
    expect(approve.body.engagement.status).toBe("paid_out");

    const ledger = await adminLedger(app);
    const mine = ledger.entries.filter((entry) => entry.engagementId === engagement.id);
    expect(mine.map((entry) => entry.kind).sort()).toEqual(["charge", "payout", "platform_fee"]);
    expect(mine.find((entry) => entry.kind === "charge")?.amountCents).toBe(12_000);
    expect(mine.find((entry) => entry.kind === "platform_fee")?.amountCents).toBe(1800);
    expect(mine.find((entry) => entry.kind === "payout")?.amountCents).toBe(10_200);
    expect(ledger.totals.chargedCents).toBe(12_000);
    expect(ledger.totals.feeCents).toBe(1800);
    expect(ledger.totals.payoutCents).toBe(10_200);
    expect(ledger.totals.refundedCents).toBe(0);
    expect(ledger.totals.heldCents).toBe(0);

    expect(payments.intents?.filter((intent) => intent.kind === "payout")).toHaveLength(1);
    expect(payments.intents?.find((intent) => intent.kind === "payout")?.amountCents).toBe(10_200);

    const jobAfter = await app.json<{ job: { status: string } }>(`/api/jobs/${job.id}`, {
      cookie: business.cookie,
    });
    expect(jobAfter.body.job.status).toBe("closed");
  });
});

describe("escrow state machine", () => {
  it("rejects wrong roles with 403 and bad transitions with 409", async () => {
    const payments = createMockPaymentProvider();
    const app = newApp({ autoApprove: true, paymentProvider: payments });
    const { business, coder, engagement } = await setupEscrow(app, 10_000);

    const businessAccept = await app.request(`/api/engagements/${engagement.id}/accept`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(businessAccept.status).toBe(403);
    expect(((await businessAccept.json()) as { error: string }).error).toBe("wrong_role");

    const coderApprove = await app.request(`/api/engagements/${engagement.id}/approve`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(coderApprove.status).toBe(403);
    expect(((await coderApprove.json()) as { error: string }).error).toBe("wrong_role");

    const outOfOrder = await app.request(`/api/engagements/${engagement.id}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(outOfOrder.status).toBe(409);
    expect(((await outOfOrder.json()) as { error: string }).error).toBe("illegal_transition");

    expect(
      (
        await app.request(`/api/engagements/${engagement.id}/accept`, {
          method: "POST",
          cookie: coder.cookie,
        })
      ).status,
    ).toBe(200);
    const doubleAccept = await app.request(`/api/engagements/${engagement.id}/accept`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(doubleAccept.status).toBe(409);

    await app.request(`/api/engagements/${engagement.id}/start`, {
      method: "POST",
      cookie: coder.cookie,
    });
    await app.request(`/api/engagements/${engagement.id}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
    });

    const cancelAfterDelivery = await app.request(`/api/engagements/${engagement.id}/cancel`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(cancelAfterDelivery.status).toBe(409);

    const approve = await app.request(`/api/engagements/${engagement.id}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(approve.status).toBe(200);

    const doubleApprove = await app.request(`/api/engagements/${engagement.id}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(doubleApprove.status).toBe(409);

    const cancelAfterPayout = await app.request(`/api/engagements/${engagement.id}/cancel`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(cancelAfterPayout.status).toBe(409);

    const ledger = await adminLedger(app);
    expect(ledger.entries.filter((entry) => entry.kind === "payout")).toHaveLength(1);
    expect(payments.intents?.filter((intent) => intent.kind === "payout")).toHaveLength(1);
  });

  it("refunds a cancelled engagement, reopens the job and allows a fresh engagement", async () => {
    const app = newApp({ autoApprove: true });
    const { business, coder, profile, job, engagement } = await setupEscrow(app, 5000);

    const cancel = await app.json<EngagementPayload>(`/api/engagements/${engagement.id}/cancel`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(cancel.response.status).toBe(200);
    expect(cancel.body.engagement.status).toBe("cancelled");

    const ledger = await adminLedger(app);
    const mine = ledger.entries.filter((entry) => entry.engagementId === engagement.id);
    expect(mine.find((entry) => entry.kind === "refund")?.amountCents).toBe(-5000);
    expect(ledger.totals.chargedCents).toBe(5000);
    expect(ledger.totals.refundedCents).toBe(5000);
    expect(ledger.totals.heldCents).toBe(0);

    const jobAfter = await app.json<{ job: { status: string } }>(`/api/jobs/${job.id}`, {
      cookie: business.cookie,
    });
    expect(jobAfter.body.job.status).toBe("open");

    const approveCancelled = await app.request(`/api/engagements/${engagement.id}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(approveCancelled.status).toBe(409);

    const replacement = await app.json<EngagementPayload>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 6000 },
    });
    expect(replacement.response.status).toBe(201);

    const acceptReplacement = await app.request(
      `/api/engagements/${replacement.body.engagement.id}/accept`,
      { method: "POST", cookie: coder.cookie },
    );
    expect(acceptReplacement.status).toBe(200);

    const dispute = await app.json<EngagementPayload>(
      `/api/engagements/${replacement.body.engagement.id}/dispute`,
      { method: "POST", cookie: business.cookie },
    );
    expect(dispute.response.status).toBe(200);
    expect(dispute.body.engagement.status).toBe("disputed");

    const approveDisputed = await app.request(
      `/api/engagements/${replacement.body.engagement.id}/approve`,
      { method: "POST", cookie: business.cookie },
    );
    expect(approveDisputed.status).toBe(409);
  });

  it("rejects engagement creation by the wrong role, the wrong owner or an amount above budget", async () => {
    const app = newApp({ autoApprove: true });
    const { business, coder, profile, job } = await setupEscrow(app, 5000);

    const coderCreating = await app.request("/api/engagements", {
      method: "POST",
      cookie: coder.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 5000 },
    });
    expect(coderCreating.status).toBe(403);

    const otherBusiness = await app.signIn("other@studio.test", "business");
    const wrongOwner = await app.request("/api/engagements", {
      method: "POST",
      cookie: otherBusiness.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 5000 },
    });
    expect(wrongOwner.status).toBe(403);

    const aboveBudget = await app.request("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 20_001 },
    });
    expect(aboveBudget.status).toBe(400);

    const alreadyEngaged = await app.request("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 6000 },
    });
    expect(alreadyEngaged.status).toBe(409);
    expect(((await alreadyEngaged.json()) as { error: string }).error).toBe("job_engaged");
  });
});
