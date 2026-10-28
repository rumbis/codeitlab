import { afterEach, describe, expect, it } from "vite-plus/test";

import {
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
  const app = createTestApp({
    autoApprove: true,
    rateLimits: { jobPostPerHour: 2, applicationPerHour: 1 },
  });
  apps.push(app);
  return app;
}

describe("job and application abuse limits", () => {
  it("stops a business from flooding the board, without touching other accounts", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@limits.test", "business");
    const other: SignedIn = await app.signIn("other@limits.test", "business");

    await createJob(app, business.cookie, { title: "First job", skills: "TypeScript" });
    await createJob(app, business.cookie, { title: "Second job", skills: "TypeScript" });
    const blocked = await app.json<{ error: string }>("/api/jobs", {
      method: "POST",
      cookie: business.cookie,
      body: {
        title: "Third job",
        description: "This one should hit the hourly limit.",
        skills: "TypeScript",
        budgetMinCents: 10_000,
        budgetMaxCents: 20_000,
        timeline: "One week",
        category: "web",
      },
    });
    expect(blocked.response.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");

    // Invalid posts never consume quota, so a typo does not lock a person out.
    const invalid = await app.request("/api/jobs", {
      method: "POST",
      cookie: business.cookie,
      body: { title: "x" },
    });
    expect(invalid.status).toBe(400);

    await createJob(app, other.cookie, {
      title: "Another account is unaffected",
      skills: "TypeScript",
    });
  });

  it("stops a coder from spamming applications", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@limits.test", "business");
    const coder: SignedIn = await app.signIn("coder@limits.test", "coder");
    await createCoderProfile(app, coder.cookie, { displayName: "Ada", skills: "TypeScript" });
    const first = await createJob(app, business.cookie, {
      title: "First job",
      skills: "TypeScript",
    });
    const second = await createJob(app, business.cookie, {
      title: "Second job",
      skills: "TypeScript",
    });

    expect(
      (
        await app.request(`/api/jobs/${first.id}/interests`, {
          method: "POST",
          cookie: coder.cookie,
          body: { message: "I can do this." },
        })
      ).status,
    ).toBe(201);

    const blocked = await app.json<{ error: string }>(`/api/jobs/${second.id}/interests`, {
      method: "POST",
      cookie: coder.cookie,
      body: { message: "And this one too." },
    });
    expect(blocked.response.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
  });
});
