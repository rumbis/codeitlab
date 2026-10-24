import { afterEach, describe, expect, it } from "vite-plus/test";

import { createMockPaymentProvider, type PaymentProvider } from "../src/server/payments.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type TestApp,
} from "./helpers.ts";

interface EngagementBody {
  engagement: {
    id: string;
    status: string;
    amountCents: number;
    payoutCents: number;
  };
}

interface LedgerBody {
  totals: { chargedCents: number; feeCents: number; payoutCents: number; entryCount: number };
  entries: Array<{ kind: string; amountCents: number }>;
}

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

interface TrackingProvider extends PaymentProvider {
  readonly calls: { charge: number; payout: number };
}

/** Wraps the mock provider so a test can count what actually reached "money". */
function trackingProvider(options: { failCharge?: boolean } = {}): TrackingProvider {
  const base = createMockPaymentProvider();
  const calls = { charge: 0, payout: 0 };
  return {
    name: "mock",
    calls,
    async charge(input) {
      calls.charge += 1;
      if (options.failCharge === true) throw new Error("provider down");
      return base.charge(input);
    },
    async payout(input) {
      calls.payout += 1;
      return base.payout(input);
    },
  };
}

async function setupEngagement(app: TestApp, amountCents = 12_000) {
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
  return { business, coder, profile, job, amountCents };
}

async function createEngagement(
  app: TestApp,
  input: {
    businessCookie: string;
    jobId: string;
    coderId: string;
    amountCents: number;
  },
): Promise<Response> {
  return app.request("/api/engagements", {
    method: "POST",
    cookie: input.businessCookie,
    body: { jobId: input.jobId, coderId: input.coderId, amountCents: input.amountCents },
  });
}

async function moveToDelivered(
  app: TestApp,
  input: {
    businessCookie: string;
    coderCookie: string;
    jobId: string;
    coderId: string;
    amountCents: number;
  },
): Promise<string> {
  const created = await createEngagement(app, input);
  expect(created.status).toBe(201);
  const body = (await created.json()) as EngagementBody;
  const id = body.engagement.id;
  for (const [action, cookie] of [
    ["accept", input.coderCookie],
    ["start", input.coderCookie],
    ["deliver", input.coderCookie],
  ] as const) {
    const response = await app.request(`/api/engagements/${id}/${action}`, {
      method: "POST",
      cookie,
    });
    expect(response.status).toBe(200);
  }
  return id;
}

describe("escrow hardening", () => {
  it("pays out once when two approvals race", async () => {
    const provider = trackingProvider();
    const app = createTestApp({ paymentProvider: provider });
    apps.push(app);
    const { business, coder, profile, job, amountCents } = await setupEngagement(app);
    const id = await moveToDelivered(app, {
      businessCookie: business.cookie,
      coderCookie: coder.cookie,
      jobId: job.id,
      coderId: profile.id,
      amountCents,
    });

    const [first, second] = await Promise.all([
      app.request(`/api/engagements/${id}/approve`, { method: "POST", cookie: business.cookie }),
      app.request(`/api/engagements/${id}/approve`, { method: "POST", cookie: business.cookie }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(provider.calls.payout).toBe(1);

    const ledger = await app.json<LedgerBody>("/api/admin/ledger", {
      headers: { authorization: "Bearer test-admin-token" },
    });
    const fee = ledger.body.entries.filter((entry) => entry.kind === "platform_fee");
    const payout = ledger.body.entries.filter((entry) => entry.kind === "payout");
    expect(fee).toHaveLength(1);
    expect(payout).toHaveLength(1);
  });

  it("charges once when two creates race", async () => {
    const provider = trackingProvider();
    const app = createTestApp({ paymentProvider: provider });
    apps.push(app);
    const { business, profile, job, amountCents } = await setupEngagement(app);

    const [first, second] = await Promise.all([
      createEngagement(app, {
        businessCookie: business.cookie,
        jobId: job.id,
        coderId: profile.id,
        amountCents,
      }),
      createEngagement(app, {
        businessCookie: business.cookie,
        jobId: job.id,
        coderId: profile.id,
        amountCents,
      }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(provider.calls.charge).toBe(1);

    const list = await app.json<{ engagements: EngagementBody["engagement"][] }>(
      "/api/engagements",
      { cookie: business.cookie },
    );
    expect(list.body.engagements).toHaveLength(1);
  });

  it("leaves no reservation and no ledger entry when the charge fails", async () => {
    const provider = trackingProvider({ failCharge: true });
    const app = createTestApp({ paymentProvider: provider });
    apps.push(app);
    const { business, profile, job, amountCents } = await setupEngagement(app);

    const response = await createEngagement(app, {
      businessCookie: business.cookie,
      jobId: job.id,
      coderId: profile.id,
      amountCents,
    });
    expect(response.status).toBe(500);
    expect(provider.calls.charge).toBe(1);

    const list = await app.json<{ engagements: unknown[] }>("/api/engagements", {
      cookie: business.cookie,
    });
    expect(list.body.engagements).toHaveLength(0);

    const ledger = await app.json<LedgerBody>("/api/admin/ledger", {
      headers: { authorization: "Bearer test-admin-token" },
    });
    expect(ledger.body.totals.entryCount).toBe(0);

    const jobAfter = await app.json<{ job: { status: string } }>(`/api/jobs/${job.id}`);
    expect(jobAfter.body.job.status).toBe("open");
  });
});
