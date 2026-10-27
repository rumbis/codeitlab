import { describe, expect, it } from "vite-plus/test";

import { reputationFrom } from "../src/server/reputation.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

function summary(overrides: Partial<Parameters<typeof reputationFrom>[0]> = {}) {
  return {
    completedEngagements: 0,
    earnedCents: 0,
    evidenceDeliveries: 0,
    disputes: 0,
    repeatClients: 0,
    ...overrides,
  };
}

describe("reputationFrom", () => {
  it("starts at New with every badge locked and a concrete next step", () => {
    const reputation = reputationFrom(summary(), "EUR");
    expect(reputation.level).toBe("new");
    expect(reputation.levelLabel).toBe("New");
    expect(reputation.badges.every((badge) => !badge.earned)).toBe(true);
    expect(reputation.nextMilestone).toContain("one paid delivery");
  });

  it("promotes to Proven after one paid delivery, then Trusted with evidence", () => {
    expect(
      reputationFrom(summary({ completedEngagements: 1, earnedCents: 10_200 }), "EUR").level,
    ).toBe("proven");
    const trusted = reputationFrom(
      summary({ completedEngagements: 3, evidenceDeliveries: 1, earnedCents: 30_600 }),
      "EUR",
    );
    expect(trusted.level).toBe("trusted");
    expect(trusted.badges.find((badge) => badge.id === "first_delivery")?.earned).toBe(true);
    expect(trusted.nextMilestone).toContain("eight paid deliveries");
  });

  it("requires eight clean deliveries for Expert and drops back when a dispute is refunded", () => {
    const expert = reputationFrom(
      summary({ completedEngagements: 8, evidenceDeliveries: 8 }),
      "EUR",
    );
    expect(expert.level).toBe("expert");
    expect(expert.badges.find((badge) => badge.id === "dispute_free")?.earned).toBe(true);

    const withDispute = reputationFrom(
      summary({ completedEngagements: 8, evidenceDeliveries: 8, disputes: 1 }),
      "EUR",
    );
    expect(withDispute.level).toBe("trusted");
    expect(withDispute.badges.find((badge) => badge.id === "dispute_free")?.earned).toBe(false);
  });

  it("earns the repeat-client badge only from a business that came back", () => {
    expect(
      reputationFrom(summary({ repeatClients: 1 }), "EUR").badges.find(
        (badge) => badge.id === "repeat_clients",
      )?.earned,
    ).toBe(true);
    expect(
      reputationFrom(summary({ repeatClients: 0 }), "EUR").badges.find(
        (badge) => badge.id === "repeat_clients",
      )?.earned,
    ).toBe(false);
  });
});

function insertEngagement(
  app: TestApp,
  input: {
    readonly id: string;
    readonly jobId: string;
    readonly coderId: string;
    readonly businessId: string;
    readonly status: string;
    readonly payoutCents?: number;
    readonly evidence?: string;
    readonly resolutionOutcome?: string;
  },
): void {
  app.app.db
    .prepare(
      `INSERT INTO engagements
        (id, job_id, coder_id, business_id, amount_cents, fee_cents, payout_cents, currency, status,
         payment_ref, delivery_note, delivery_evidence, resolution_outcome, resolution_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.jobId,
      input.coderId,
      input.businessId,
      12_000,
      1_800,
      input.payoutCents ?? 10_200,
      "EUR",
      input.status,
      `mock_charge_${input.id}`,
      "",
      input.evidence ?? "[]",
      input.resolutionOutcome ?? "",
      "",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
}

async function setupCoder(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@reputation.test", "business");
  const coder: SignedIn = await app.signIn("coder@reputation.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript, SQLite",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  return { business, coder, profile };
}

/** One engagement per job is a schema invariant, so each row needs its own job. */
async function newJob(app: TestApp, business: SignedIn) {
  return createJob(app, business.cookie, {
    skills: "TypeScript, SQLite",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
  });
}

describe("reputation surfaces", () => {
  it("shows the derived level on the directory card and the dashboard", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business, coder, profile } = await setupCoder(app);
    const job = await newJob(app, business);
    insertEngagement(app, {
      id: "e1",
      jobId: job.id,
      coderId: profile.id,
      businessId: business.account.id,
      status: "paid_out",
      evidence: '["https://example.com/proof"]',
    });

    const directory = await app.request("/coders");
    const directoryHtml = await directory.text();
    expect(directoryHtml).toContain("Proven");
    expect(directoryHtml).toContain("1 paid delivery");
    expect(directoryHtml).toContain("1 with evidence");

    const dashboard = await app.request("/dashboard", { cookie: coder.cookie });
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain("Reputation");
    expect(dashboardHtml).toContain("First delivery");
    expect(dashboardHtml).toContain("Reach three paid deliveries");
    expect(dashboardHtml).toContain("€102.00"); // earned, formatted for EUR
  });

  it("earns Trusted, evidence and repeat-client badges from real rows", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business, profile } = await setupCoder(app);
    for (const index of [1, 2, 3]) {
      const job = await newJob(app, business);
      insertEngagement(app, {
        id: `e${index}`,
        jobId: job.id,
        coderId: profile.id,
        businessId: business.account.id,
        status: "paid_out",
        evidence: '["https://example.com/proof"]',
      });
    }

    const directory = await app.request("/coders");
    const html = await directory.text();
    expect(html).toContain("Trusted");
    expect(html).toContain("3 paid deliveries");

    const dashboard = await app.request("/dashboard", {
      cookie: (await app.signIn("coder@reputation.test", "coder")).cookie,
    });
    const dashboardHtml = await dashboard.text();
    expect(dashboardHtml).toContain("Evidence backed");
    expect(dashboardHtml).toContain("Repeat client");
    expect(dashboardHtml).toContain("Reach eight paid deliveries");
  });

  it("counts a refunded dispute against the record", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business, coder, profile } = await setupCoder(app);
    const job1 = await newJob(app, business);
    const job2 = await newJob(app, business);
    insertEngagement(app, {
      id: "e1",
      jobId: job1.id,
      coderId: profile.id,
      businessId: business.account.id,
      status: "paid_out",
      evidence: '["https://example.com/proof"]',
    });
    insertEngagement(app, {
      id: "e2",
      jobId: job2.id,
      coderId: profile.id,
      businessId: business.account.id,
      status: "cancelled",
      resolutionOutcome: "refunded",
    });

    const dashboard = await app.request("/dashboard", { cookie: coder.cookie });
    const html = await dashboard.text();
    expect(html).toContain("1 dispute");
    expect(html).toContain("Dispute free");
    expect(html).not.toContain("8 paid deliveries");
  });
});
