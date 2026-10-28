import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type TestApp,
} from "./helpers.ts";

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

describe("sitemap", () => {
  it("lists public pages, open jobs and approved coders as absolute URLs", async () => {
    const app = newApp({ autoApprove: false });
    const business = await app.signIn("owner@sitemap.test", "business");
    const coder = await app.signIn("coder@sitemap.test", "coder");
    const pending = await app.signIn("pending@sitemap.test", "coder");
    const openJob = await createJob(app, business.cookie, {
      title: "Indexable job",
      skills: "TypeScript",
    });
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
    });
    await approveCoder(app, profile.id);
    const pendingProfile = await createCoderProfile(app, pending.cookie, {
      displayName: "NotYet",
      skills: "TypeScript",
    });

    const response = await app.request("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    const xml = await response.text();
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain("<urlset");
    for (const path of ["/jobs", "/coders", "/how-it-works", "/numbers", "/security"]) {
      expect(xml).toContain(`<loc>https://codeitlab.com${path}</loc>`);
    }
    expect(xml).toContain(`/jobs/${openJob.id}`);
    expect(xml).toContain(`/coders/${profile.id}`);
    expect(xml).not.toContain(`/coders/${pendingProfile.id}`);
  });

  it("keeps the mount path in every URL and points robots.txt at it", async () => {
    const app = newApp({ basePath: "/market" });
    const xml = await (await app.request("/market/sitemap.xml")).text();
    expect(xml).toContain("<loc>https://codeitlab.com/market/jobs</loc>");
    expect(xml).not.toContain("/market/market");

    const robots = await (await app.request("/market/robots.txt")).text();
    expect(robots).toContain("Sitemap: https://codeitlab.com/market/sitemap.xml");
    expect((await app.request("/market/sitemap.xml", { method: "POST" })).status).toBe(405);
  });
});
