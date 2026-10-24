import { afterEach, describe, expect, it } from "vite-plus/test";

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

function newApp(): TestApp {
  const app = createTestApp({ autoApprove: true });
  apps.push(app);
  return app;
}

async function world(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@delete.test", "business");
  const coder: SignedIn = await app.signIn("coder@delete.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada Lovelace",
    skills: "TypeScript",
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, { title: "Delete test", skills: "TypeScript" });
  return { business, coder, profile, job };
}

async function deleteAccount(app: TestApp, cookie: string, confirm = "delete") {
  return app.json<{ deleted?: boolean; error?: string }>("/api/me/delete", {
    method: "POST",
    cookie,
    body: { confirm },
  });
}

describe("account deletion", () => {
  it("removes personal data but keeps the money record", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await world(app);
    const engagement = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    const id = engagement.body.engagement.id;
    for (const action of ["accept", "start"] as const) {
      await app.request(`/api/engagements/${id}/${action}`, {
        method: "POST",
        cookie: coder.cookie,
      });
    }
    await app.request(`/api/engagements/${id}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: { deliveryNote: "Done.", deliveryEvidence: "https://ada.example/proof" },
    });
    await app.request(`/api/engagements/${id}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });

    const deleted = await deleteAccount(app, coder.cookie);
    expect(deleted.response.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);

    // The old session is gone.
    expect((await app.request("/api/me/export", { cookie: coder.cookie })).status).toBe(401);

    // The profile is hidden and emptied.
    const directory = await (await app.request("/coders")).text();
    expect(directory).not.toContain("Ada Lovelace");
    expect((await app.request(`/coders/${profile.id}`)).status).toBe(404);

    // The ledger still balances and still holds the payout.
    const ledger = await app.json<{ totals: { payoutCents: number }; entries: unknown[] }>(
      "/api/admin/ledger",
      { headers: ADMIN },
    );
    expect(ledger.body.totals.payoutCents).toBe(8500);
    expect(ledger.body.entries.length).toBeGreaterThan(0);

    // The business's job is closed, and the business is untouched.
    const jobPage = await (await app.request(`/jobs/${job.id}`)).text();
    expect(jobPage).toContain("Delete test");
    expect((await app.request("/dashboard", { cookie: business.cookie })).status).toBe(200);
  });

  it("refuses deletion without confirmation or with active escrow", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await world(app);
    const unconfirmed = await deleteAccount(app, coder.cookie, "yes");
    expect(unconfirmed.response.status).toBe(409);
    expect(unconfirmed.body.error).toBe("confirmation_required");

    const engagement = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    expect(engagement.response.status).toBe(201);
    const blocked = await deleteAccount(app, coder.cookie);
    expect(blocked.response.status).toBe(409);
    expect(blocked.body.error).toBe("active_engagements");

    await app.request(`/api/engagements/${engagement.body.engagement.id}/cancel`, {
      method: "POST",
      cookie: business.cookie,
    });
    const allowed = await deleteAccount(app, coder.cookie);
    expect(allowed.response.status).toBe(200);
  });

  it("closes a business's open jobs and scrubs the business profile", async () => {
    const app = newApp();
    const { business, job } = await world(app);
    const deleted = await deleteAccount(app, business.cookie);
    expect(deleted.response.status).toBe(200);

    const board = await (await app.request("/jobs")).text();
    expect(board).not.toContain("Delete test");
    expect((await app.request(`/jobs/${job.id}`)).status).toBe(200);

    const accounts = await app.json<{ accounts: { email: string; suspended: boolean }[] }>(
      "/api/admin/accounts?q=deleted%2B",
      { headers: ADMIN },
    );
    expect(accounts.body.accounts).toHaveLength(1);
    expect(accounts.body.accounts[0]?.email).toContain("@deleted.invalid");
    expect(accounts.body.accounts[0]?.email).not.toContain("owner@delete.test");
  });
});
