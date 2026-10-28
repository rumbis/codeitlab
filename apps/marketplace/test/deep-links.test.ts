import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

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
  const business: SignedIn = await app.signIn("owner@links.test", "business");
  const coder: SignedIn = await app.signIn("coder@links.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
  });
  const interest = await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this." },
  });
  expect(interest.status).toBe(201);
  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 12_000 },
  });
  expect(created.response.status).toBe(201);
  return { business, coder, engagementId: created.body.engagement.id };
}

describe("PWA shortcuts and engagement deep links", () => {
  it("publishes launcher shortcuts that respect the base path", async () => {
    const app = newApp();
    const response = await app.request("/manifest.webmanifest");
    expect(response.status).toBe(200);
    const manifest = (await response.json()) as {
      id: string;
      start_url: string;
      scope: string;
      shortcuts: { name: string; url: string }[];
    };
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.id).toBe("/");
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual([
      "/jobs",
      "/dashboard",
      "/numbers",
    ]);
    expect(manifest.shortcuts.map((shortcut) => shortcut.name)).toEqual([
      "Open jobs",
      "My dashboard",
      "Public numbers",
    ]);
  });

  it("builds every shortcut from a non-root base path", async () => {
    const app = createTestApp({ autoApprove: true, basePath: "/market" });
    apps.push(app);
    const manifest = (await (await app.request("/manifest.webmanifest")).json()) as {
      start_url: string;
      shortcuts: { url: string }[];
    };
    expect(manifest.start_url).toBe("/market/");
    expect(manifest.shortcuts.map((shortcut) => shortcut.url)).toEqual([
      "/market/jobs",
      "/market/dashboard",
      "/market/numbers",
    ]);
  });

  it("points notifications at the exact engagement card", async () => {
    const app = newApp();
    const { business, engagementId } = await world(app);
    const notifications = await app.json<{
      notifications: { kind: string; href: string }[];
    }>("/api/notifications", { cookie: business.cookie });
    const delivery = notifications.body.notifications.find((row) => row.kind === "delivery");
    // The business has no delivery notification until the coder delivers; the
    // escrow notification to the coder proves the anchor pattern instead.
    expect(delivery).toBeUndefined();

    const coderNotifications = await app.json<{
      notifications: { kind: string; href: string }[];
    }>("/api/notifications", { cookie: (await app.signIn("coder@links.test", "coder")).cookie });
    const funded = coderNotifications.body.notifications.find((row) => row.kind === "engagement");
    expect(funded?.href).toBe(`/dashboard#engagement-${engagementId}`);

    const dashboard = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    expect(dashboard).toContain(`id="engagement-${engagementId}"`);
    expect(dashboard).toContain(`id="engagement-${engagementId}-title"`);
  });

  it("keeps the notification click handler on the notification href", async () => {
    const app = newApp();
    const sw = await (await app.request("/sw.js")).text();
    expect(sw).toContain("event.notification.data.href");
    expect(sw).toContain("clients.openWindow(target)");
  });
});
