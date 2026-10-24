import { afterEach, describe, expect, it } from "vite-plus/test";

import { describeUserAgent } from "../src/server/sessions.ts";
import { cookieHeader, createTestApp, type TestApp } from "./helpers.ts";

const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const FIREFOX_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

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

/** Sign in with a specific User-Agent so the session list has something to show. */
async function signInAs(
  app: TestApp,
  email: string,
  role: "business" | "coder",
  userAgent: string,
): Promise<string> {
  await app.request("/api/auth/request-code", {
    method: "POST",
    body: { email, role },
    headers: { "user-agent": userAgent },
  });
  const code = app.codes.get(email);
  if (code === undefined) throw new Error("no login code");
  const verified = await app.request("/api/auth/verify", {
    method: "POST",
    body: { email, code },
    headers: { "user-agent": userAgent },
  });
  expect(verified.status).toBe(200);
  const cookie = cookieHeader(verified);
  if (cookie === "") throw new Error("no session cookie");
  return cookie;
}

describe("active sessions", () => {
  it("labels browsers and systems in words", () => {
    expect(describeUserAgent(CHROME_MAC)).toBe("Chrome on macOS");
    expect(describeUserAgent(FIREFOX_WINDOWS)).toBe("Firefox on Windows");
    expect(describeUserAgent(IPHONE_SAFARI)).toBe("Safari on iPhone");
    expect(describeUserAgent("")).toBe("Unknown device");
    expect(describeUserAgent("curl/8.0")).toBe("Browser on device");
  });

  it("lists every live session and marks the current one", async () => {
    const app = newApp();
    const laptop = await signInAs(app, "person@session.test", "coder", CHROME_MAC);
    const phone = await signInAs(app, "person@session.test", "coder", IPHONE_SAFARI);

    const listed = await app.json<{ sessions: { device: string; current: boolean }[] }>(
      "/api/auth/sessions",
      { cookie: phone },
    );
    expect(listed.body.sessions).toHaveLength(2);
    expect(listed.body.sessions.map((session) => session.device)).toEqual(
      expect.arrayContaining(["Chrome on macOS", "Safari on iPhone"]),
    );
    expect(listed.body.sessions.filter((session) => session.current)).toHaveLength(1);

    const dashboard = await (await app.request("/dashboard", { cookie: laptop })).text();
    expect(dashboard).toContain("Active sessions");
    expect(dashboard).toContain("Chrome on macOS");
    expect(dashboard).toContain("Safari on iPhone");
    expect(dashboard).toContain("This device");
    expect(dashboard).toContain("Sign out all other devices");
  });

  it("signs out the other device and keeps the current one", async () => {
    const app = newApp();
    const laptop = await signInAs(app, "person@session.test", "coder", CHROME_MAC);
    const phone = await signInAs(app, "person@session.test", "coder", IPHONE_SAFARI);

    const revoked = await app.request("/api/auth/sessions/revoke-others", {
      method: "POST",
      cookie: phone,
    });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { revoked: number }).revoked).toBe(1);

    expect((await app.request("/api/notifications", { cookie: laptop })).status).toBe(401);
    expect((await app.request("/api/notifications", { cookie: phone })).status).toBe(200);

    const listed = await app.json<{ sessions: unknown[] }>("/api/auth/sessions", { cookie: phone });
    expect(listed.body.sessions).toHaveLength(1);
  });

  it("revokes one session but refuses to revoke the current one", async () => {
    const app = newApp();
    const laptop = await signInAs(app, "person@session.test", "coder", CHROME_MAC);
    const phone = await signInAs(app, "person@session.test", "coder", IPHONE_SAFARI);

    const listed = await app.json<{ sessions: { id: string; current: boolean; device: string }[] }>(
      "/api/auth/sessions",
      { cookie: laptop },
    );
    const other = listed.body.sessions.find((session) => !session.current);
    expect(other).toBeDefined();
    const removed = await app.request(`/api/auth/sessions/${other?.id}/revoke`, {
      method: "POST",
      cookie: laptop,
    });
    expect(removed.status).toBe(200);
    expect((await app.request("/api/notifications", { cookie: phone })).status).toBe(401);
    expect((await app.request("/api/notifications", { cookie: laptop })).status).toBe(200);

    const current = listed.body.sessions.find((session) => session.current);
    const refused = await app.request(`/api/auth/sessions/${current?.id}/revoke`, {
      method: "POST",
      cookie: laptop,
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toBe("current_session");
  });

  it("hides expired sessions and requires a login to manage them", async () => {
    const app = newApp();
    const first = await signInAs(app, "person@session.test", "coder", CHROME_MAC);
    app.advance(31 * 24 * 60 * 60 * 1_000);
    const second = await signInAs(app, "person@session.test", "coder", IPHONE_SAFARI);

    expect((await app.request("/api/auth/sessions", { cookie: first })).status).toBe(401);
    const listed = await app.json<{ sessions: { device: string }[] }>("/api/auth/sessions", {
      cookie: second,
    });
    expect(listed.body.sessions.map((session) => session.device)).toEqual(["Safari on iPhone"]);
    expect((await app.request("/api/auth/sessions")).status).toBe(401);
    expect((await app.request("/api/auth/sessions/revoke-others", { method: "POST" })).status).toBe(
      401,
    );
  });
});
