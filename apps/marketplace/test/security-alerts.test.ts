import { afterEach, describe, expect, it } from "vite-plus/test";

import type { MailMessage } from "../src/server/mail.ts";
import type { AccountRole } from "../src/shared/contracts.ts";
import {
  TEST_ADMIN_TOKEN,
  createTestApp,
  cookieHeader,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126.0 Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64) Firefox/128.0";

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

async function signInWithUa(
  app: TestApp,
  email: string,
  role: AccountRole,
  userAgent: string,
): Promise<SignedIn> {
  const requested = await app.request("/api/auth/request-code", {
    method: "POST",
    body: { email, role },
  });
  expect(requested.status).toBe(200);
  const code = app.codes.get(email);
  if (code === undefined) throw new Error(`no code for ${email}`);
  const verified = await app.request("/api/auth/verify", {
    method: "POST",
    body: { email, code },
    headers: { "user-agent": userAgent },
  });
  expect(verified.status).toBe(200);
  const payload = (await verified.json()) as {
    account: { id: string; email: string; role: AccountRole };
  };
  return { cookie: cookieHeader(verified), account: payload.account, code };
}

function alerts(sent: readonly MailMessage[]): MailMessage[] {
  return sent.filter((message) => message.subject === "CodeItLab — new sign-in to your account");
}

describe("new-device sign-in alerts", () => {
  it("stays quiet for the first sign-in and for the same device again", async () => {
    const { app, sent } = newApp();
    await signInWithUa(app, "alert@email.test", "business", CHROME_MAC);
    await signInWithUa(app, "alert@email.test", "business", CHROME_MAC);
    await app.request("/api/admin/mail/drain", { method: "POST", headers: ADMIN });
    expect(alerts(sent)).toHaveLength(0);
  });

  it("emails a security alert when a new device signs in, regardless of notification prefs", async () => {
    const { app, sent } = newApp();
    await signInWithUa(app, "alert@email.test", "business", CHROME_MAC);
    await signInWithUa(app, "alert@email.test", "business", FIREFOX_LINUX);
    await app.request("/api/admin/mail/drain", { method: "POST", headers: ADMIN });
    const security = alerts(sent);
    expect(security).toHaveLength(1);
    expect(security[0]?.to).toBe("alert@email.test");
    expect(security[0]?.text).toContain("Device: Firefox on Linux");
    expect(security[0]?.text).toContain("https://codeitlab.com/market/dashboard#sessions");
    expect(security[0]?.text).toContain("If this was you, nothing to do.");
  });

  it("does not alert after the device has signed in once", async () => {
    const { app, sent } = newApp();
    await signInWithUa(app, "alert@email.test", "business", CHROME_MAC);
    await signInWithUa(app, "alert@email.test", "business", FIREFOX_LINUX);
    await signInWithUa(app, "alert@email.test", "business", FIREFOX_LINUX);
    await app.request("/api/admin/mail/drain", { method: "POST", headers: ADMIN });
    expect(alerts(sent)).toHaveLength(1);
  });
});

describe("admin session revocation", () => {
  it("signs every device out of an account and audits it", async () => {
    const { app } = newApp();
    const first = await signInWithUa(app, "revoke@email.test", "business", CHROME_MAC);
    await signInWithUa(app, "revoke@email.test", "business", FIREFOX_LINUX);

    const revoked = await app.json<{ accountId: string; revoked: number }>(
      `/api/admin/accounts/${first.account.id}/revoke-sessions`,
      { method: "POST", headers: ADMIN },
    );
    expect(revoked.response.status).toBe(200);
    expect(revoked.body.revoked).toBe(2);

    // A revoked cookie is no session at all, so the dashboard now bounces to the
    // log-in page rather than rendering a shell that says "log in".
    const after = await app.request("/dashboard", { cookie: first.cookie });
    expect(after.status).toBe(303);
    expect(new URL(after.headers.get("location") ?? "", "http://x.test").pathname).toBe("/login");

    const audit = await app.json<{ entries: { action: string; targetId: string }[] }>(
      "/api/admin/audit",
      { headers: ADMIN },
    );
    const entry = audit.body.entries.find((row) => row.action === "account.sessions_revoked");
    expect(entry?.targetId).toBe(first.account.id);
  });

  it("requires the admin token and rejects unknown accounts", async () => {
    const { app } = newApp();
    expect(
      (await app.request("/api/admin/accounts/whatever/revoke-sessions", { method: "POST" }))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request("/api/admin/accounts/whatever/revoke-sessions", {
          method: "POST",
          headers: ADMIN,
        })
      ).status,
    ).toBe(404);
  });
});
