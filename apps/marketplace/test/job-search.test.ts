import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Job } from "../src/shared/contracts.ts";
import { createJob, createTestApp, type SignedIn, type TestApp } from "./helpers.ts";

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

async function setup(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@search.test", "business");
  const video = await createJob(app, business.cookie, {
    title: "Edit a product launch video",
    description: "Cut a 60 second launch video from our footage and add captions.",
    skills: "After Effects, Video editing",
    category: "video",
    budgetMinCents: 40_000,
    budgetMaxCents: 90_000,
  });
  const web = await createJob(app, business.cookie, {
    title: "Build a booking page",
    description: "A small Next.js page that writes bookings into SQLite.",
    skills: "TypeScript, SQLite",
    category: "web",
    budgetMinCents: 10_000,
    budgetMaxCents: 30_000,
  });
  const data = await createJob(app, business.cookie, {
    title: "Clean and chart survey data",
    description: "Python notebook over 4,000 survey rows.",
    skills: "Python, pandas",
    category: "data",
    budgetMinCents: 20_000,
    budgetMaxCents: 50_000,
  });
  return { business, video, web, data };
}

function titles(html: string): string[] {
  return [
    "Edit a product launch video",
    "Build a booking page",
    "Clean and chart survey data",
  ].filter((title) => html.includes(title));
}

describe("job search and filters", () => {
  it("searches title, description and skills", async () => {
    const app = newApp();
    await setup(app);
    expect(titles(await (await app.request("/jobs?q=video")).text())).toEqual([
      "Edit a product launch video",
    ]);
    expect(titles(await (await app.request("/jobs?q=sqlite")).text())).toEqual([
      "Build a booking page",
    ]);
    expect(titles(await (await app.request("/jobs?q=notebook")).text())).toEqual([
      "Clean and chart survey data",
    ]);
    expect(titles(await (await app.request("/jobs?q=zzz-nothing")).text())).toEqual([]);
  });

  it("filters by field and minimum budget, alone and combined", async () => {
    const app = newApp();
    await setup(app);
    expect(titles(await (await app.request("/jobs?category=video")).text())).toEqual([
      "Edit a product launch video",
    ]);
    // video is the only job whose maximum budget reaches €800.
    expect(titles(await (await app.request("/jobs?minBudget=800")).text())).toEqual([
      "Edit a product launch video",
    ]);
    expect(titles(await (await app.request("/jobs?category=web&minBudget=200")).text())).toEqual([
      "Build a booking page",
    ]);
    expect(titles(await (await app.request("/jobs?q=video&category=web")).text())).toEqual([]);
  });

  it("keeps filters in the form and reports the count", async () => {
    const app = newApp();
    await setup(app);
    const page = await (await app.request("/jobs?q=video&category=video&minBudget=100")).text();
    expect(page).toContain('value="video" selected');
    expect(page).toContain('value="video"');
    expect(page).toContain("1 open job matching your filters");
    expect(page).toContain("Clear");
    expect(page).toContain('name="q"');
  });

  it("ignores unknown categories and invalid budgets instead of failing", async () => {
    const app = newApp();
    await setup(app);
    const page = await (await app.request("/jobs?category=not-a-field&minBudget=abc")).text();
    expect(titles(page)).toHaveLength(3);
    expect(page).not.toContain("matching your filters");
  });

  it("applies the same filters to the JSON API", async () => {
    const app = newApp();
    await setup(app);
    const listed = await app.json<{ jobs: Job[]; count: number }>(
      "/api/jobs?q=python&category=data",
    );
    expect(listed.body.count).toBe(1);
    expect(listed.body.jobs[0]?.title).toBe("Clean and chart survey data");
    const byBudget = await app.json<{ jobs: Job[] }>("/api/jobs?minBudget=600");
    expect(byBudget.body.jobs.map((job) => job.title)).toEqual(["Edit a product launch video"]);
  });
});
