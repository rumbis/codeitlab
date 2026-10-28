import * as NodeCrypto from "node:crypto";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { execute } from "../src/server/db.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  TEST_ADMIN_TOKEN,
  type TestApp,
} from "./helpers.ts";

interface ReconcileReport {
  ok: boolean;
  engagements: number;
  entries: number;
  problems: Array<{ engagementId: string; detail: string }>;
  totals: {
    chargedCents: number;
    feeCents: number;
    payoutCents: number;
    refundedCents: number;
    heldCents: number;
  };
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

async function reconcile(app: TestApp, token = TEST_ADMIN_TOKEN): Promise<ReconcileReport> {
  const { response, body } = await app.json<ReconcileReport>("/api/admin/reconcile", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return body;
}

async function setupEngagement(
  app: TestApp,
  options: { amountCents?: number; feeTier?: string; cancel?: boolean } = {},
): Promise<{ engagementId: string }> {
  const amountCents = options.amountCents ?? 12_000;
  const business = await app.signIn("owner@money.test", "business");
  const coder = await app.signIn("coder@money.test", "coder");
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

  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: {
      jobId: job.id,
      coderId: profile.id,
      amountCents,
      ...(options.feeTier === undefined ? {} : { feeTier: options.feeTier }),
    },
  });
  expect(created.response.status).toBe(201);
  const engagementId = created.body.engagement.id;

  if (options.cancel === true) {
    const cancelled = await app.request(`/api/engagements/${engagementId}/cancel`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(cancelled.status).toBe(200);
    return { engagementId };
  }

  for (const [action, cookie] of [
    ["accept", coder.cookie],
    ["start", coder.cookie],
    ["deliver", coder.cookie],
    ["approve", business.cookie],
  ] as const) {
    const response = await app.request(`/api/engagements/${engagementId}/${action}`, {
      method: "POST",
      cookie,
    });
    expect(response.status).toBe(200);
  }
  return { engagementId };
}

describe("ledger reconciliation", () => {
  it("reports a healthy paid-out engagement", async () => {
    const app = newApp();
    const { engagementId } = await setupEngagement(app);

    const report = await reconcile(app);
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
    expect(report.engagements).toBe(1);
    expect(report.entries).toBe(3);
    expect(report.totals).toEqual({
      chargedCents: 12_000,
      feeCents: 1800,
      payoutCents: 10_200,
      refundedCents: 0,
      heldCents: 0,
    });
    expect(engagementId).not.toBe("");
  });

  it("reports the assisted 20% tier", async () => {
    const app = newApp();
    await setupEngagement(app, { feeTier: "assisted" });
    const report = await reconcile(app);
    expect(report.ok).toBe(true);
    expect(report.totals.feeCents).toBe(2400);
    expect(report.totals.payoutCents).toBe(9600);
  });

  it("accepts a cancelled engagement with a refund", async () => {
    const app = newApp();
    await setupEngagement(app, { cancel: true });
    const report = await reconcile(app);
    expect(report.ok).toBe(true);
    expect(report.entries).toBe(2);
    expect(report.totals.chargedCents).toBe(12_000);
    expect(report.totals.refundedCents).toBe(-12_000);
    expect(report.totals.heldCents).toBe(0);
  });

  it("names a ledger row that the state machine cannot explain", async () => {
    const app = newApp();
    const { engagementId } = await setupEngagement(app);

    execute(
      app.app.db,
      `INSERT INTO ledger_entries (id, engagement_id, kind, amount_cents, currency, note, created_at)
       VALUES (?, ?, 'payout', ?, 'EUR', 'duplicate payout', ?)`,
      [NodeCrypto.randomUUID(), engagementId, 10_200, new Date().toISOString()],
    );

    const report = await reconcile(app);
    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.detail.startsWith("payout:"))).toBe(true);
  });

  it("flags ledger rows that point at no engagement", async () => {
    const app = newApp();
    // A corrupted database can hold an orphan row; foreign keys are off while we
    // forge one so the reconciler, not SQLite, is what notices it.
    app.app.db.exec("PRAGMA foreign_keys = OFF");
    execute(
      app.app.db,
      `INSERT INTO ledger_entries (id, engagement_id, kind, amount_cents, currency, note, created_at)
       VALUES (?, 'ghost', 'charge', 5000, 'EUR', 'orphan', ?)`,
      [NodeCrypto.randomUUID(), new Date().toISOString()],
    );
    app.app.db.exec("PRAGMA foreign_keys = ON");
    const report = await reconcile(app);
    expect(report.ok).toBe(false);
    expect(report.problems.some((problem) => problem.engagementId === "ghost")).toBe(true);
  });

  it("shows the reconciliation on the admin page", async () => {
    const app = newApp();
    const { engagementId } = await setupEngagement(app);
    const healthy = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(healthy).toContain("Ledger reconciliation");
    expect(healthy).toContain("engagements balance across");

    execute(
      app.app.db,
      `INSERT INTO ledger_entries (id, engagement_id, kind, amount_cents, currency, note, created_at)
       VALUES (?, ?, 'payout', ?, 'EUR', 'duplicate payout', ?)`,
      [NodeCrypto.randomUUID(), engagementId, 10_200, new Date().toISOString()],
    );
    const broken = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(broken).toContain("disagree with the escrow state machine");
    expect(broken).toContain(engagementId);
  });

  it("requires the admin token", async () => {
    const app = newApp();
    const response = await app.request("/api/admin/reconcile");
    expect(response.status).toBe(401);
    const wrong = await app.request("/api/admin/reconcile", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(wrong.status).toBe(401);
  });
});
