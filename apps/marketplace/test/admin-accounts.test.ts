import { afterEach, describe, expect, it } from "vite-plus/test";

import { TEST_ADMIN_TOKEN, createTestApp, type TestApp } from "./helpers.ts";

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

interface AdminAccount {
  id: string;
  email: string;
  role: string;
  suspendedAt: string | null;
  suspendedReason: string;
}

describe("admin account lookup", () => {
  it("searches by email fragment and returns nothing for an empty query", async () => {
    const app = newApp();
    await app.signIn("ada@lookup.test", "coder");
    await app.signIn("grace@lookup.test", "business");

    const empty = await app.json<{ accounts: AdminAccount[] }>("/api/admin/accounts?q=", {
      headers: ADMIN,
    });
    expect(empty.body.accounts).toEqual([]);

    const found = await app.json<{ accounts: AdminAccount[] }>("/api/admin/accounts?q=ada", {
      headers: ADMIN,
    });
    expect(found.body.accounts).toHaveLength(1);
    expect(found.body.accounts[0]?.email).toBe("ada@lookup.test");
    expect(found.body.accounts[0]?.role).toBe("coder");
    expect(found.body.accounts[0]?.suspendedAt).toBeNull();

    const both = await app.json<{ accounts: AdminAccount[] }>("/api/admin/accounts?q=lookup", {
      headers: ADMIN,
    });
    expect(both.body.accounts).toHaveLength(2);
    expect((await app.request("/api/admin/accounts?q=ada")).status).toBe(401);
  });

  it("suspends and restores from the admin page, with the reason visible", async () => {
    const app = newApp();
    const coder = await app.signIn("ada@lookup.test", "coder");

    const page = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}&account=ada`)).text();
    expect(page).toContain("ada@lookup.test");
    expect(page).toContain("Active");
    expect(page).toContain("Suspend");
    expect(page).toContain("Find an account by email");

    const suspended = await app.json<{ suspendedAt: string | null }>(
      `/api/admin/accounts/${coder.account.id}/suspend`,
      { method: "POST", headers: ADMIN, body: { reason: "Stolen work report" } },
    );
    expect(suspended.response.status).toBe(200);

    const after = await app.json<{ accounts: AdminAccount[] }>("/api/admin/accounts?q=ada", {
      headers: ADMIN,
    });
    expect(after.body.accounts[0]?.suspendedAt).not.toBeNull();
    expect(after.body.accounts[0]?.suspendedReason).toBe("Stolen work report");

    const suspendedPage = await (
      await app.request(`/admin?token=${TEST_ADMIN_TOKEN}&account=ada`)
    ).text();
    expect(suspendedPage).toContain("Suspended");
    expect(suspendedPage).toContain("Stolen work report");
    expect(suspendedPage).toContain("Restore account");

    await app.request(`/api/admin/accounts/${coder.account.id}/unsuspend`, {
      method: "POST",
      headers: ADMIN,
    });
    const restoredPage = await (
      await app.request(`/admin?token=${TEST_ADMIN_TOKEN}&account=ada`)
    ).text();
    expect(restoredPage).toContain("Active");
    expect(restoredPage).toContain("Suspend");
  });
});
