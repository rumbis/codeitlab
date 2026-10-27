import { afterEach, describe, expect, it } from "vite-plus/test";

import type { MailMessage } from "../src/server/mail.ts";
import { TEST_ADMIN_TOKEN, createTestApp, type SignedIn, type TestApp } from "./helpers.ts";

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
const WRONG = { authorization: "Bearer definitely-not-the-token" };

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp() {
  const sent: MailMessage[] = [];
  const app = createTestApp({
    autoApprove: true,
    mailTransport: {
      name: "capture",
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
  });
  apps.push(app);
  return { app, sent };
}

async function suspend(app: TestApp, accountId: string, reason = "Chargeback fraud pattern") {
  return app.json<{ accountId: string; suspendedAt: string | null }>(
    `/api/admin/accounts/${accountId}/suspend`,
    { method: "POST", headers: ADMIN, body: { reason } },
  );
}

describe("account suspension", () => {
  it("signs the account out, blocks new logins and emails a safety notice", async () => {
    const { app, sent } = newApp();
    const business: SignedIn = await app.signIn("suspend@email.test", "business");
    const oldCode = business.code;

    const result = await suspend(app, business.account.id);
    expect(result.response.status).toBe(200);
    expect(result.body.suspendedAt).not.toBeNull();

    const dashboard = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    expect(dashboard).toContain("Log in with your email code");

    // request-code still answers 200 (no enumeration), but sends no code.
    const requested = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "suspend@email.test", role: "business" },
    });
    expect(requested.status).toBe(200);
    expect(app.codes.get("suspend@email.test")).toBe(oldCode);

    const verify = await app.json<{ error: string }>("/api/auth/verify", {
      method: "POST",
      body: { email: "suspend@email.test", code: oldCode },
    });
    expect(verify.response.status).toBe(403);
    expect(verify.body.error).toBe("account_suspended");

    await app.request("/api/admin/mail/drain", { method: "POST", headers: ADMIN });
    const notice = sent.filter((mail) => mail.subject === "CodeItLab — your account is suspended");
    expect(notice).toHaveLength(1);
    expect(notice[0]?.to).toBe("suspend@email.test");
    expect(notice[0]?.text).toContain("Chargeback fraud pattern");

    const audit = await app.json<{ entries: { action: string; detail: string }[] }>(
      "/api/admin/audit",
      { headers: ADMIN },
    );
    const entry = audit.body.entries.find((row) => row.action === "account.suspended");
    expect(entry?.detail).toContain("1 session revoked");
  });

  it("lets an operator restore the account", async () => {
    const { app } = newApp();
    const business: SignedIn = await app.signIn("restore@email.test", "business");
    await suspend(app, business.account.id);

    const restored = await app.json<{ suspendedAt: string | null }>(
      `/api/admin/accounts/${business.account.id}/unsuspend`,
      { method: "POST", headers: ADMIN },
    );
    expect(restored.response.status).toBe(200);
    expect(restored.body.suspendedAt).toBeNull();

    const again: SignedIn = await app.signIn("restore@email.test", "business");
    const page = await (await app.request("/dashboard", { cookie: again.cookie })).text();
    expect(page).toContain("restore@email.test");
  });

  it("requires a reason, the admin token, and an existing account", async () => {
    const { app } = newApp();
    const business: SignedIn = await app.signIn("validate@email.test", "business");
    expect((await suspend(app, business.account.id, "")).response.status).toBe(400);
    expect(
      (
        await app.request(`/api/admin/accounts/${business.account.id}/suspend`, {
          method: "POST",
          body: { reason: "Valid reason" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/admin/accounts/does-not-exist/suspend", {
          method: "POST",
          headers: ADMIN,
          body: { reason: "Valid reason" },
        })
      ).status,
    ).toBe(404);
  });
});

describe("admin token guessing", () => {
  it("rate-limits wrong tokens per peer without locking out the real token", async () => {
    const { app } = newApp();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await app.request("/api/admin/ledger", { headers: WRONG })).status).toBe(401);
    }
    const limited = await app.json<{ error: string }>("/api/admin/ledger", { headers: WRONG });
    expect(limited.response.status).toBe(429);
    expect(limited.body.error).toBe("rate_limited");

    // A valid token does not consume the failure bucket.
    expect((await app.request("/api/admin/ledger", { headers: ADMIN })).status).toBe(200);
  });
});
