import * as NodeCrypto from "node:crypto";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { AUTH_CODE_TTL_MINUTES, SESSION_COOKIE } from "../src/shared/contracts.ts";
import { cookieHeader, createTestApp, setCookies, type TestApp } from "./helpers.ts";

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

function sha256(value: string): string {
  return NodeCrypto.createHash("sha256").update(value).digest("hex");
}

async function requestCode(app: TestApp, email: string, role: "coder" | "business" = "coder") {
  return app.request("/api/auth/request-code", { method: "POST", body: { email, role } });
}

describe("passwordless auth", () => {
  it("locks a code after five wrong attempts and never accepts the right code afterwards", async () => {
    const app = newApp();
    expect((await requestCode(app, "ada@coders.test")).status).toBe(200);
    const code = app.codes.get("ada@coders.test");
    expect(code).toMatch(/^\d{6}$/u);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const wrong = await app.json<{ error: string }>("/api/auth/verify", {
        method: "POST",
        body: { email: "ada@coders.test", code: "000000" === code ? "111111" : "000000" },
      });
      expect(wrong.response.status).toBe(401);
      expect(wrong.body.error).toBe("invalid_code");
    }

    const fifth = await app.json<{ error: string }>("/api/auth/verify", {
      method: "POST",
      body: { email: "ada@coders.test", code: "000000" === code ? "111111" : "000000" },
    });
    expect(fifth.response.status).toBe(429);
    expect(fifth.body.error).toBe("too_many_attempts");

    const correct = await app.json<{ error: string }>("/api/auth/verify", {
      method: "POST",
      body: { email: "ada@coders.test", code },
    });
    expect(correct.response.status).toBe(429);
    expect(correct.body.error).toBe("too_many_attempts");
  });

  it("expires a code after 15 minutes", async () => {
    const app = newApp();
    expect(AUTH_CODE_TTL_MINUTES).toBe(15);
    await requestCode(app, "early@coders.test");
    app.advance(14 * 60_000 + 59_000);
    const early = await app.request("/api/auth/verify", {
      method: "POST",
      body: { email: "early@coders.test", code: app.codes.get("early@coders.test") },
    });
    expect(early.status).toBe(200);

    app.advance(1000);
    await requestCode(app, "late@coders.test");
    app.advance(15 * 60_000);
    const late = await app.json<{ error: string }>("/api/auth/verify", {
      method: "POST",
      body: { email: "late@coders.test", code: app.codes.get("late@coders.test") },
    });
    expect(late.response.status).toBe(401);
    expect(late.body.error).toBe("code_expired");
  });

  it("expires sessions after 30 days and deletes the stale row", async () => {
    const app = newApp();
    const signedIn = await app.signIn("ada@coders.test", "coder");

    const before = await app.request("/api/engagements", { cookie: signedIn.cookie });
    expect(before.status).toBe(200);

    app.advance(30 * 24 * 60 * 60 * 1000 + 1000);
    const after = await app.json<{ error: string }>("/api/engagements", {
      cookie: signedIn.cookie,
    });
    expect(after.response.status).toBe(401);

    const remaining = app.app.db.prepare("SELECT COUNT(*) AS count FROM sessions").get() as {
      count: number;
    };
    expect(Number(remaining.count)).toBe(0);
  });

  it("stores only hashes of login codes and session tokens", async () => {
    const app = newApp();
    await requestCode(app, "hash@coders.test");
    const code = app.codes.get("hash@coders.test");
    if (code === undefined) throw new Error("missing dev code");

    const codeRows = app.app.db
      .prepare("SELECT code_salt AS salt, code_hash AS hash FROM auth_codes")
      .all() as Array<{ salt: string; hash: string }>;
    expect(codeRows).toHaveLength(1);
    const stored = codeRows[0];
    if (stored === undefined) throw new Error("missing auth code row");
    expect(stored.hash).not.toBe(code);
    expect(stored.hash).toBe(sha256(`${stored.salt}:${code}`));
    expect(JSON.stringify(codeRows)).not.toContain(code);

    const verified = await app.request("/api/auth/verify", {
      method: "POST",
      body: { email: "hash@coders.test", code },
    });
    expect(verified.status).toBe(200);

    const cookie = cookieHeader(verified);
    const token = cookie.split("=")[1] ?? "";
    expect(token).not.toBe("");

    const sessionRows = app.app.db
      .prepare("SELECT token_hash AS hash FROM sessions")
      .all() as Array<{ hash: string }>;
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.hash).not.toBe(token);
    expect(sessionRows[0]?.hash).toBe(sha256(token));
  });

  it("sets an HttpOnly SameSite=Lax session cookie and clears it on logout", async () => {
    const app = newApp();
    expect((await requestCode(app, "cookie@coders.test")).status).toBe(200);
    const verified = await app.request("/api/auth/verify", {
      method: "POST",
      body: { email: "cookie@coders.test", code: app.codes.get("cookie@coders.test") },
    });
    expect(verified.status).toBe(200);

    const cookie = setCookies(verified)[0] ?? "";
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=2592000");

    const sessionCookie = cookieHeader(verified);
    const logout = await app.request("/api/auth/logout", {
      method: "POST",
      cookie: sessionCookie,
    });
    expect(logout.status).toBe(200);
    expect(setCookies(logout)[0]).toContain("Max-Age=0");

    const afterLogout = await app.request("/api/engagements", { cookie: sessionCookie });
    expect(afterLogout.status).toBe(401);
  });

  it("rate limits code requests per email and per address", async () => {
    const app = newApp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await requestCode(app, "spam@coders.test")).status).toBe(200);
    }
    const blocked = await app.json<{ error: string }>("/api/auth/request-code", {
      method: "POST",
      body: { email: "spam@coders.test", role: "coder" },
    });
    expect(blocked.response.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");

    const sharedIpApp = newApp();
    for (let index = 0; index < 20; index += 1) {
      const response = await sharedIpApp.request("/api/auth/request-code", {
        method: "POST",
        body: { email: `coder${index}@coders.test`, role: "coder" },
        headers: { "x-forwarded-for": "203.0.113.9" },
      });
      expect(response.status).toBe(200);
    }
    const perAddress = await sharedIpApp.json<{ error: string }>("/api/auth/request-code", {
      method: "POST",
      body: { email: "coder-final@coders.test", role: "coder" },
      headers: { "x-forwarded-for": "203.0.113.9" },
    });
    expect(perAddress.response.status).toBe(429);
    expect(perAddress.body.error).toBe("rate_limited");
  });

  it("keeps one role per email and does not reveal it to a wrong-role request", async () => {
    const app = newApp();
    await app.signIn("owner@studio.test", "business");

    // Same 200 and same body shape as a brand-new email: asking for the wrong
    // role must not tell anyone that the account exists or which role it has.
    const mismatch = await app.json<{ expiresAt: string }>("/api/auth/request-code", {
      method: "POST",
      body: { email: "owner@studio.test", role: "coder" },
    });
    expect(mismatch.response.status).toBe(200);
    expect(typeof mismatch.body.expiresAt).toBe("string");
    const created = await app.json<{ expiresAt: string }>("/api/auth/request-code", {
      method: "POST",
      body: { email: "fresh@studio.test", role: "coder" },
    });
    expect(created.response.status).toBe(200);
    expect(Object.keys(created.body).sort()).toEqual(Object.keys(mismatch.body).sort());

    // The account still has its original role, and the code signs it in as such.
    const signedIn = await app.signIn("owner@studio.test", "coder");
    expect(signedIn.account.role).toBe("business");

    const malformed = await app.json<{ error: string }>("/api/auth/verify", {
      method: "POST",
      body: { email: "owner@studio.test", code: "not-a-code" },
    });
    expect(malformed.response.status).toBe(400);

    // Unknown address answers exactly like a known one with no live code.
    const unknown = await app.json<{ error: string }>("/api/auth/verify", {
      method: "POST",
      body: { email: "nobody@studio.test", code: "123456" },
    });
    expect(unknown.response.status).toBe(401);
    expect(unknown.body.error).toBe("no_active_code");
    const knownWithoutCode = await app.json<{ error: string }>("/api/auth/verify", {
      method: "POST",
      body: { email: "quiet@studio.test", code: "123456" },
    });
    expect(knownWithoutCode.response.status).toBe(401);
    expect(knownWithoutCode.body.error).toBe(unknown.body.error);

    const invalidEmail = await app.json<{ error: string }>("/api/auth/request-code", {
      method: "POST",
      body: { email: "not-an-email", role: "coder" },
    });
    expect(invalidEmail.response.status).toBe(400);
  });
});
