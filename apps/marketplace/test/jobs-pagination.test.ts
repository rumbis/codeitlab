import { afterEach, describe, expect, it } from "vite-plus/test";

import { createJob, createTestApp, type TestApp } from "./helpers.ts";

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(): TestApp {
  const app = createTestApp({ autoApprove: true, rateLimits: { jobPostPerHour: 100 } });
  apps.push(app);
  return app;
}

describe("job board pagination", () => {
  it("pages twenty at a time and keeps the filter in the links", async () => {
    const app = newApp();
    const business = await app.signIn("owner@paging.test", "business");
    for (let index = 1; index <= 25; index += 1) {
      await createJob(app, business.cookie, {
        title: `Paged job ${String(index).padStart(2, "0")}`,
        skills: "TypeScript",
        category: "web",
      });
    }

    const first = await (await app.request("/jobs")).text();
    expect(first).toContain("Page 1 of 2 · 25 open jobs");
    expect(first).toContain("Paged job 25");
    expect(first).not.toContain("Paged job 01");
    expect(first).toContain('rel="next"');

    const second = await (await app.request("/jobs?page=2")).text();
    expect(second).toContain("Page 2 of 2 · 25 open jobs");
    expect(second).toContain("Paged job 01");
    expect(second).not.toContain("Paged job 25");
    expect(second).toContain('rel="prev"');

    const filtered = await (await app.request("/jobs?category=web&page=2")).text();
    expect(filtered).toContain("category=web");
    expect(filtered).toContain('rel="prev"');
    expect(filtered).not.toContain("page=3");
  });

  it("clamps a hostile page number instead of returning an empty board", async () => {
    const app = newApp();
    const business = await app.signIn("owner@paging.test", "business");
    await createJob(app, business.cookie, { title: "Only job", skills: "TypeScript" });
    for (const query of ["?page=99", "?page=-3", "?page=two", "?page=0"]) {
      const page = await (await app.request(`/jobs${query}`)).text();
      expect(page, query).toContain("Only job");
      expect(page, query).not.toContain("Page 99");
    }
  });
});
