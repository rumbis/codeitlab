import { afterEach, describe, expect, it } from "vite-plus/test";

import { JOB_TEMPLATES } from "../src/server/jobTemplates.ts";
import { createTestApp, type TestApp } from "./helpers.ts";

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

describe("job templates", () => {
  it("prefills the post form without publishing anything", async () => {
    const app = newApp();
    const business = await app.signIn("owner@templates.test", "business");
    const page = await (
      await app.request("/dashboard?template=video-edit", { cookie: business.cookie })
    ).text();

    const template = JOB_TEMPLATES.find((item) => item.id === "video-edit");
    expect(template).toBeDefined();
    expect(page).toContain("Template: <strong>Video edit</strong>");
    expect(page).toContain("nothing is published until you press Publish");
    expect(page).toContain(template?.title ?? "missing");
    expect(page).toContain("Video editing, captions, motion graphics");
    expect(page).toContain(`value="${template?.budgetMinCents ?? 0}"`);
    expect(page).toContain(`value="${template?.budgetMaxCents ?? 0}"`);
    expect(page).toContain("4–7 days");

    const jobs = await app.json<{ jobs: unknown[] }>("/api/jobs?mine=1", {
      cookie: business.cookie,
    });
    expect(jobs.body.jobs ?? []).toHaveLength(0);
  });

  it("offers every template and ignores an unknown one", async () => {
    const app = newApp();
    const business = await app.signIn("owner@templates.test", "business");
    const page = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    for (const template of JOB_TEMPLATES) {
      expect(page, template.id).toContain(`/dashboard?template=${template.id}`);
    }
    const unknown = await (
      await app.request("/dashboard?template=not-a-template", { cookie: business.cookie })
    ).text();
    expect(unknown).not.toContain("Template: <strong>");
  });

  it("accepts a template as a valid job once the business publishes it", async () => {
    const app = newApp();
    const business = await app.signIn("owner@templates.test", "business");
    const template = JOB_TEMPLATES.find((item) => item.id === "data-cleanup");
    const created = await app.json<{ job: { title: string; category: string } }>("/api/jobs", {
      method: "POST",
      cookie: business.cookie,
      body: {
        title: template?.title,
        description: template?.description,
        skills: template?.skills,
        category: template?.category,
        budgetMinCents: template?.budgetMinCents,
        budgetMaxCents: template?.budgetMaxCents,
        currency: "EUR",
        timeline: template?.timeline,
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.body.job.title).toBe(template?.title);
    expect(created.body.job.category).toBe("data");
  });
});
