import { afterEach, describe, expect, it } from "vite-plus/test";

import type { AppContext } from "../src/server/context.ts";
import { impactNumbers } from "../src/server/impact.ts";
import type { Engagement } from "../src/shared/contracts.ts";
import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp({ autoApprove: true, ...overrides });
  apps.push(app);
  return app;
}

async function setup(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@impact.test", "business");
  const coder: SignedIn = await app.signIn("coder@impact.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
  const created = await app.json<{ engagement: Engagement }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
  });
  expect(created.response.status).toBe(201);
  const engagement = created.body.engagement;
  for (const action of ["accept", "start"] as const) {
    await app.request(`/api/engagements/${engagement.id}/${action}`, {
      method: "POST",
      cookie: coder.cookie,
    });
  }
  return { business, coder, profile, job, engagement };
}

function ctxOf(app: TestApp): AppContext {
  return { db: app.app.db } as unknown as AppContext;
}

async function approve(
  app: TestApp,
  businessCookie: string,
  coderCookie: string,
  engagementId: string,
) {
  await app.request(`/api/engagements/${engagementId}/deliver`, {
    method: "POST",
    cookie: coderCookie,
    form: { deliveryNote: "Done." },
  });
  const approved = await app.request(`/api/engagements/${engagementId}/approve`, {
    method: "POST",
    cookie: businessCookie,
  });
  expect(approved.status).toBe(200);
}

describe("public numbers", () => {
  it("shows zeroes honestly before any money moves", async () => {
    const app = newApp();
    const page = await (await app.request("/numbers")).text();
    expect(page).toContain("The numbers, straight from the ledger");
    expect(page).toContain("Paid to coders");
    expect(page).toContain("€0.00");
    expect(page).toContain("No tracking, no estimates, no rounding up.");
    expect(page).toContain("What we charge, and what we do not");
    expect(page).toContain("15% standard fee");
    expect(page).toContain("20% assisted fee");
    expect(page).toContain("/how-it-works#fees");

    const numbers = impactNumbers(ctxOf(app));
    expect(numbers.completedEngagements).toBe(0);
    expect(numbers.codersPaid).toBe(0);
    expect(numbers.averagePayoutHours).toBeNull();
  });

  it("reports payouts and fees from the ledger after a delivery is approved", async () => {
    const app = newApp();
    const { business, coder, engagement } = await setup(app);
    await approve(app, business.cookie, coder.cookie, engagement.id);
    const numbers = impactNumbers(ctxOf(app));
    expect(numbers.paidToCodersCents).toBe(8_500);
    expect(numbers.platformFeesCents).toBe(1_500);
    expect(numbers.heldCents).toBe(0);
    expect(numbers.completedEngagements).toBe(1);
    expect(numbers.codersPaid).toBe(1);
    expect(numbers.businessesServed).toBe(1);
    expect(numbers.activeEngagements).toBe(0);

    const page = await (await app.request("/numbers")).text();
    expect(page).toContain("€85.00");
    expect(page).toContain("€15.00");
    expect(page).toContain("Coders paid");
    expect(page).toContain("Businesses served");
    void business;
  });

  it("counts a refund as refunded, not as paid, and returns the fee", async () => {
    const app = newApp();
    const { business, coder, engagement } = await setup(app);
    await app.request(`/api/engagements/${engagement.id}/dispute`, {
      method: "POST",
      cookie: business.cookie,
    });
    const resolved = await app.request(`/api/admin/disputes/${engagement.id}/resolve`, {
      method: "POST",
      headers: ADMIN,
      body: { outcome: "refunded", note: "Not what was agreed." },
    });
    expect(resolved.status).toBe(200);

    const numbers = impactNumbers(ctxOf(app));
    expect(numbers.refundedCents).toBe(10_000);
    expect(numbers.paidToCodersCents).toBe(0);
    expect(numbers.platformFeesCents).toBe(0);
    expect(numbers.completedEngagements).toBe(0);
    expect(numbers.refundedEngagements).toBe(1);
    expect(numbers.disputesResolved).toBe(1);
    expect(numbers.heldCents).toBe(0);

    const page = await (await app.request("/numbers")).text();
    expect(page).toContain("Refunds issued");
    expect(page).toContain("€100.00");
    void coder;
  });

  it("measures the average time from engagement start to payout", async () => {
    const app = newApp();
    const { business, coder, engagement } = await setup(app);
    app.advance(48 * 60 * 60 * 1_000);
    await approve(app, business.cookie, coder.cookie, engagement.id);
    const numbers = impactNumbers(ctxOf(app));
    expect(numbers.averagePayoutHours).not.toBeNull();
    expect(numbers.averagePayoutHours ?? 0).toBeGreaterThanOrEqual(47.9);
    expect(numbers.averagePayoutHours ?? 0).toBeLessThanOrEqual(48.1);
  });

  it("is linked from the footer and readable without logging in", async () => {
    const app = newApp();
    const home = await (await app.request("/")).text();
    expect(home).toContain('href="/numbers"');
    const response = await app.request("/numbers");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("Why publish this");
  });
});

describe("fee copy matches the money code", () => {
  it("says the fee comes out of the funded amount, not on top of it", async () => {
    const app = newApp();
    const page = await (await app.request("/numbers")).text();
    expect(page).toContain("the fee comes out of the amount the business funds");
    expect(page).toContain("the coder receives €850 and the platform keeps €150");
    expect(page).not.toContain("on top of the coder");
  });

  it("shows the fee tier on the home page", async () => {
    const app = newApp();
    const page = await (await app.request("/")).text();
    expect(page).toContain("minus the 15% platform fee");
    expect(page).toContain("20% when CodeitLab helps run the project");
  });
});
