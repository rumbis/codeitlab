import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  TEST_ADMIN_TOKEN,
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

async function saveSearch(app: TestApp, cookie: string, body: Record<string, unknown>) {
  return app.json<{ error?: string }>("/api/saved-searches", {
    method: "POST",
    cookie,
    body,
  });
}

async function sweep(app: TestApp) {
  return app.json<{ notified: number }>("/api/admin/job-alerts/run", {
    method: "POST",
    headers: ADMIN,
  });
}

describe("saved job searches", () => {
  it("lets a coder save a filtered search and shows it on the dashboard", async () => {
    const app = newApp();
    const coder: SignedIn = await app.signIn("coder@alerts.test", "coder");
    const saved = await saveSearch(app, coder.cookie, {
      q: "video",
      category: "video",
      minBudget: "500",
    });
    expect(saved.response.status).toBe(200);

    const page = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(page).toContain("Saved searches");
    expect(page).toContain("video");
    expect(page).toContain("Video / motion");
    expect(page).toContain("Remove");

    expect(
      (await saveSearch(app, coder.cookie, { q: "video", category: "video", minBudget: "500" }))
        .response.status,
    ).toBe(409);
    expect((await saveSearch(app, coder.cookie, {})).response.status).toBe(400);
    expect((await saveSearch(app, coder.cookie, { category: "not-a-field" })).response.status).toBe(
      400,
    );
  });

  it("is coder-only, caps the list, and only deletes your own", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@alerts.test", "business");
    const coder: SignedIn = await app.signIn("coder@alerts.test", "coder");
    const other: SignedIn = await app.signIn("other@alerts.test", "coder");
    expect((await saveSearch(app, business.cookie, { q: "video" })).response.status).toBe(403);

    for (let index = 0; index < 10; index += 1) {
      expect((await saveSearch(app, coder.cookie, { q: `term-${index}` })).response.status).toBe(
        200,
      );
    }
    expect((await saveSearch(app, coder.cookie, { q: "term-eleven" })).response.status).toBe(409);

    const page = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    const id = /\/api\/saved-searches\/(search_[^/]+)\/delete/.exec(page)?.[1];
    expect(id).toBeDefined();
    expect(
      (
        await app.request(`/api/saved-searches/${id}/delete`, {
          method: "POST",
          cookie: other.cookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/saved-searches/${id}/delete`, {
          method: "POST",
          cookie: coder.cookie,
        })
      ).status,
    ).toBe(200);
  });

  it("notifies once per search about jobs posted since the last sweep", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@alerts.test", "business");
    const coder: SignedIn = await app.signIn("coder@alerts.test", "coder");
    await saveSearch(app, coder.cookie, { q: "video" });

    app.advance(1_000);
    await createJob(app, business.cookie, {
      title: "Edit a launch video",
      description: "Cut a launch video with captions.",
      skills: "Video editing",
      category: "video",
      budgetMinCents: 20_000,
      budgetMaxCents: 60_000,
    });
    // A job that does not match the saved search must not notify.
    await createJob(app, business.cookie, {
      title: "Build a booking page",
      description: "A small TypeScript page.",
      skills: "TypeScript",
      category: "web",
      budgetMinCents: 20_000,
      budgetMaxCents: 60_000,
    });

    expect((await sweep(app)).body.notified).toBe(1);
    expect((await sweep(app)).body.notified).toBe(0);

    const notifications = await app.json<{
      notifications: { kind: string; href: string; message: string }[];
    }>("/api/notifications", { cookie: coder.cookie });
    const alert = notifications.body.notifications.find((row) => row.kind === "job_alert");
    expect(alert?.message).toContain("1 new job");
    expect(alert?.message).toContain("Edit a launch video");
    expect(alert?.href).toContain("q=video");

    app.advance(1_000);
    await createJob(app, business.cookie, {
      title: "Second video job",
      description: "Another video edit for the launch sequence.",
      skills: "Video editing",
      category: "video",
      budgetMinCents: 20_000,
      budgetMaxCents: 60_000,
    });
    expect((await sweep(app)).body.notified).toBe(1);
  });

  it("keeps the sweep admin-only and surfaces the button", async () => {
    const app = newApp();
    expect((await app.request("/api/admin/job-alerts/run", { method: "POST" })).status).toBe(401);
    const page = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(page).toContain("Saved-search alerts");
    expect(page).toContain("Run job-alert sweep");
  });
});
