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
  const app = createTestApp({ autoApprove: true, ...overrides });
  apps.push(app);
  return app;
}

async function setup(app: TestApp) {
  const business = await app.signIn("owner@recs.test", "business");
  const coder = await app.signIn("coder@recs.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "After Effects, Video editing",
    interests: "video",
  });
  await approveCoder(app, profile.id);
  return { business, coder, profile };
}

describe("job recommendations from declared interests", () => {
  it("shows only jobs that overlap the declared skills or field", async () => {
    const app = newApp();
    const { business, coder } = await setup(app);
    const matching = await createJob(app, business.cookie, {
      title: "Edit a product launch video",
      skills: "After Effects",
      category: "video",
    });
    const interestOnly = await createJob(app, business.cookie, {
      title: "Animate a 3D explainer",
      skills: "Blender",
      category: "video",
    });
    await createJob(app, business.cookie, {
      title: "Build a React dashboard",
      skills: "React",
      category: "web",
    });

    const dashboard = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(dashboard).toContain("Jobs for your declared interests");
    expect(dashboard).toContain("Edit a product launch video");
    expect(dashboard).toContain("Matches your skills: After Effects");
    expect(dashboard).toContain("Animate a 3D explainer");
    expect(dashboard).toContain("Field you want: video");
    expect(dashboard).not.toContain("Build a React dashboard");
    expect(matching.id).not.toBe(interestOnly.id);
  });

  it("excludes jobs the coder already applied to", async () => {
    const app = newApp();
    const { business, coder } = await setup(app);
    const job = await createJob(app, business.cookie, {
      title: "Edit a launch video",
      skills: "After Effects",
      category: "video",
    });
    await app.request(`/api/jobs/${job.id}/interests`, {
      method: "POST",
      cookie: coder.cookie,
      body: { message: "I would like this one." },
    });
    const dashboard = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(dashboard).not.toContain("Jobs for your declared interests");
  });

  it("shows nothing when the declared skills and fields match no open job", async () => {
    const app = newApp({ autoApprove: true });
    const business = await app.signIn("owner@empty.test", "business");
    const coder = await app.signIn("coder@empty.test", "coder");
    await createCoderProfile(app, coder.cookie, { displayName: "New", skills: "Gardening" });
    await createJob(app, business.cookie, { skills: "After Effects", category: "video" });
    const dashboard = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(dashboard).not.toContain("Jobs for your declared interests");
  });
});
