import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
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

async function createAlert(app: TestApp, cookie: string, body: Record<string, string>) {
  return app.json<{ watching?: boolean; error?: string }>("/api/coder-alerts", {
    method: "POST",
    cookie,
    body,
  });
}

async function sweep(app: TestApp) {
  return app.json<{ notified: number }>("/api/admin/coder-alerts/run", {
    method: "POST",
    headers: ADMIN,
  });
}

async function feed(app: TestApp, cookie: string) {
  return app.json<{ notifications: { kind: string; message: string; href: string }[] }>(
    "/api/notifications",
    { cookie },
  );
}

describe("coder alerts", () => {
  it("notifies a business when a newly approved coder fits the watch", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@watch.test", "business");
    const coder: SignedIn = await app.signIn("coder@watch.test", "coder");
    const created = await createAlert(app, business.cookie, { skills: "TypeScript, video" });
    expect(created.response.status).toBe(200);
    expect(created.body.watching).toBe(true);

    app.advance(60_000);
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript, video",
      interests: "video",
    });
    await approveCoder(app, profile.id);

    const ran = await sweep(app);
    expect(ran.response.status).toBe(200);
    expect(ran.body.notified).toBe(1);
    const notifications = await feed(app, business.cookie);
    const alert = notifications.body.notifications.find((item) => item.kind === "coder_alert");
    expect(alert?.message).toContain("1 new coder");
    expect(alert?.message).toContain("Ada");
    expect(alert?.href).toContain("/coders?");
    expect(alert?.href).toContain("skills=TypeScript%2Cvideo");
  });

  it("does not notify for coders who do not fit, or for ones who already existed", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@watch.test", "business");
    const before: SignedIn = await app.signIn("before@watch.test", "coder");
    const beforeProfile = await createCoderProfile(app, before.cookie, {
      displayName: "Before",
      skills: "TypeScript",
    });
    await approveCoder(app, beforeProfile.id);
    await createAlert(app, business.cookie, { skills: "TypeScript" });

    app.advance(60_000);
    const after: SignedIn = await app.signIn("after@watch.test", "coder");
    const afterProfile = await createCoderProfile(app, after.cookie, {
      displayName: "After",
      skills: "Rust",
    });
    await approveCoder(app, afterProfile.id);
    expect((await sweep(app)).body.notified).toBe(0);
    expect((await feed(app, business.cookie)).body.notifications).toHaveLength(0);

    const dashboard = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    expect(dashboard).toContain("Watch for coders");
    expect(dashboard).toContain("1 matching now");
  });

  it("validates the watch and only lets businesses create one", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@watch.test", "business");
    const coder: SignedIn = await app.signIn("coder@watch.test", "coder");
    expect((await createAlert(app, coder.cookie, { skills: "TypeScript" })).response.status).toBe(
      403,
    );
    const empty = await createAlert(app, business.cookie, {});
    expect(empty.response.status).toBe(400);
    expect(empty.body.error).toBe("empty_alert");
    expect((await createAlert(app, business.cookie, { maxRate: "80" })).body.watching).toBe(true);
    const duplicate = await createAlert(app, business.cookie, { maxRate: "80" });
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.error).toBe("duplicate_coder_alert");

    const page = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    const watchId = page.match(/\/api\/coder-alerts\/(watch_[^/"]+)\/delete/u)?.[1];
    expect(watchId).toBeDefined();
    const removed = await app.json<{ deleted?: boolean }>(`/api/coder-alerts/${watchId}/delete`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(removed.response.status).toBe(200);
    expect((await app.request("/dashboard", { cookie: business.cookie })).status).toBe(200);
  });
});
