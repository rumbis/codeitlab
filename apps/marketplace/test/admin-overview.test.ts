import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
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

describe("admin operator snapshot", () => {
  it("counts people, escrow and queues without listing anyone", async () => {
    const app = newApp();
    const business = await app.signIn("owner@overview.test", "business");
    const coder = await app.signIn("coder@overview.test", "coder");
    const waiting = await app.signIn("waiting@overview.test", "coder");
    const approved = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
    });
    await approveCoder(app, approved.id);
    await createCoderProfile(app, waiting.cookie, { displayName: "Pending", skills: "TypeScript" });
    const job = await createJob(app, business.cookie, {
      title: "Overview job",
      skills: "TypeScript",
    });
    await app.json("/api/reports", {
      method: "POST",
      cookie: coder.cookie,
      body: { targetKind: "job", targetId: job.id, reason: "scam" },
    });
    await app.request("/api/jobs/" + job.id + "/invite", {
      method: "POST",
      cookie: business.cookie,
      body: { coderId: approved.id, message: "Interested?" },
    });

    const page = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(page).toContain("Operator snapshot");
    expect(page).toContain("waiting for approval");
    expect(page).toContain("delivered, awaiting release");
    expect(page).toContain("reports ·");
    expect(page).toContain("mail ·");
    expect(page).toContain("push");
    // Counts only: the snapshot itself never prints an email or an account id.
    const snapshot = page.slice(page.indexOf("Operator snapshot"), page.indexOf("Open disputes"));
    expect(snapshot).not.toContain("@overview.test");
    expect(snapshot).not.toContain("acct_");

    const accounts = await app.json<{ accounts: unknown[] }>("/api/admin/accounts?q=overview", {
      headers: ADMIN,
    });
    expect(accounts.body.accounts).toHaveLength(3);
  });
});
