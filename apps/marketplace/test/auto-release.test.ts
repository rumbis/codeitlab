import { afterEach, describe, expect, it } from "vite-plus/test";

import { DAY_MS } from "../src/server/autoRelease.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  TEST_ADMIN_TOKEN,
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

interface Delivered {
  engagementId: string;
  coder: SignedIn;
  business: SignedIn;
}

async function deliveredEngagement(app: TestApp): Promise<Delivered> {
  const business: SignedIn = await app.signIn("owner@release.test", "business");
  const coder: SignedIn = await app.signIn("coder@release.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
    interests: "web",
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, { title: "Release me", skills: "TypeScript" });
  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
  });
  expect(created.response.status).toBe(201);
  const engagementId = created.body.engagement.id;
  for (const action of ["accept", "start"] as const) {
    expect(
      (
        await app.request(`/api/engagements/${engagementId}/${action}`, {
          method: "POST",
          cookie: coder.cookie,
        })
      ).status,
    ).toBe(200);
  }
  const delivered = await app.request(`/api/engagements/${engagementId}/deliver`, {
    method: "POST",
    cookie: coder.cookie,
    form: { deliveryNote: "Shipped.", deliveryEvidence: "https://ada.example/proof" },
  });
  expect(delivered.status).toBe(303);
  return { engagementId, coder, business };
}

async function run(app: TestApp) {
  return app.json<{ days: number; released: number; failed: number }>(
    "/api/admin/auto-release/run",
    { method: "POST", headers: ADMIN },
  );
}

describe("auto-release of stale deliveries", () => {
  it("pays the coder after the window, exactly once, through the normal ledger", async () => {
    const app = newApp();
    const { engagementId, coder, business } = await deliveredEngagement(app);

    app.advance(14 * DAY_MS + 1_000);
    const first = await run(app);
    expect(first.response.status).toBe(200);
    expect(first.body.released).toBe(1);
    expect(first.body.failed).toBe(0);

    const engagements = await app.json<{
      engagements: { id: string; status: string; resolutionNote: string }[];
    }>("/api/engagements", { cookie: coder.cookie });
    const released = engagements.body.engagements.find((row) => row.id === engagementId);
    expect(released?.status).toBe("paid_out");
    expect(released?.resolutionNote).toContain("automatically after 14 days");

    expect((await run(app)).body.released).toBe(0);

    const reconcile = await app.json<{ ok: boolean }>("/api/admin/reconcile", { headers: ADMIN });
    expect(reconcile.body.ok).toBe(true);

    const coderFeed = await app.json<{ notifications: { kind: string; message: string }[] }>(
      "/api/notifications",
      { cookie: coder.cookie },
    );
    expect(
      coderFeed.body.notifications.some(
        (row) => row.kind === "approved" && row.message.includes("released automatically"),
      ),
    ).toBe(true);
    const businessFeed = await app.json<{ notifications: { message: string }[] }>(
      "/api/notifications",
      { cookie: business.cookie },
    );
    expect(
      businessFeed.body.notifications.some((row) =>
        row.message.includes("without approval or a dispute"),
      ),
    ).toBe(true);

    const audit = await app.json<{ entries: { action: string; targetId: string }[] }>(
      "/api/admin/audit",
      { headers: ADMIN },
    );
    expect(
      audit.body.entries.some(
        (row) => row.action === "escrow.auto_released" && row.targetId === engagementId,
      ),
    ).toBe(true);
  });

  it("leaves a fresh delivery and a disputed one alone", async () => {
    const app = newApp();
    const { engagementId } = await deliveredEngagement(app);
    app.advance(13 * DAY_MS);
    expect((await run(app)).body.released).toBe(0);

    app.advance(2 * DAY_MS);
    expect(
      (
        await app.request(`/api/engagements/${engagementId}/dispute`, {
          method: "POST",
          cookie: (await app.signIn("coder@release.test", "coder")).cookie,
        })
      ).status,
    ).toBe(200);
    expect((await run(app)).body.released).toBe(0);
  });

  it("can be disabled, and says so on the public page", async () => {
    const app = newApp({ autoReleaseDays: 0 });
    const { engagementId, coder } = await deliveredEngagement(app);
    app.advance(15 * DAY_MS);
    const result = await run(app);
    expect(result.body.days).toBe(0);
    expect(result.body.released).toBe(0);
    const engagements = await app.json<{ engagements: { id: string; status: string }[] }>(
      "/api/engagements",
      { cookie: coder.cookie },
    );
    expect(engagements.body.engagements.find((row) => row.id === engagementId)?.status).toBe(
      "delivered",
    );
    const page = await (await app.request("/how-it-works")).text();
    expect(page).toContain("Auto-release is off on this deployment");
  });

  it("shows the window and eligible count on the admin page", async () => {
    const app = newApp();
    await deliveredEngagement(app);
    app.advance(15 * DAY_MS);
    const page = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(page).toContain("Auto-release");
    expect(page).toContain("14 days");
    expect(page).toContain("1 delivery eligible now");
    expect(page).toContain("Run auto-release sweep");
    expect((await app.request("/api/admin/auto-release/run", { method: "POST" })).status).toBe(401);
  });
});
