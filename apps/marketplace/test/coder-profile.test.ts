import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Engagement } from "../src/shared/contracts.ts";
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

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp({ autoApprove: true, ...overrides });
  apps.push(app);
  return app;
}

async function setup(app: TestApp, email = "profile") {
  const business: SignedIn = await app.signIn(`owner@${email}.test`, "business");
  const coder: SignedIn = await app.signIn(`coder@${email}.test`, "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada Lovelace",
    headline: "Backend engineer for small teams",
    bio: "I build booking flows and the boring parts that keep them running.",
    skills: "TypeScript, SQLite",
    interests: "web, ai",
    evidence: "https://github.com/ada/booking",
  });
  await approveCoder(app, profile.id);
  return { business, coder, profile };
}

async function paidEngagement(app: TestApp, business: SignedIn, coder: SignedIn, coderId: string) {
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
  const created = await app.json<{ engagement: Engagement }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId, amountCents: 10_000 },
  });
  const engagement = created.body.engagement;
  for (const action of ["accept", "start"] as const) {
    await app.request(`/api/engagements/${engagement.id}/${action}`, {
      method: "POST",
      cookie: coder.cookie,
    });
  }
  await app.request(`/api/engagements/${engagement.id}/deliver`, {
    method: "POST",
    cookie: coder.cookie,
    form: { deliveryNote: "Done.", deliveryEvidence: "https://github.com/ada/booking" },
  });
  await app.request(`/api/engagements/${engagement.id}/approve`, {
    method: "POST",
    cookie: business.cookie,
  });
  return engagement;
}

describe("public coder profile", () => {
  it("shows the bio, evidence, track record and ratings", async () => {
    const app = newApp();
    const { business, coder, profile } = await setup(app);
    const engagement = await paidEngagement(app, business, coder, profile.id);
    await app.request(`/api/engagements/${engagement.id}/rating`, {
      method: "POST",
      cookie: business.cookie,
      body: { score: 5, comment: "Exactly the booking flow we needed." },
    });

    const response = await app.request(`/coders/${profile.id}`);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain("Backend engineer for small teams");
    expect(html).toContain("booking flows and the boring parts");
    expect(html).toContain("https://github.com/ada/booking");
    expect(html).toContain("Track record");
    expect(html).toContain("1 paid delivery");
    expect(html).toContain("★ 5.0 · 1");
    expect(html).toContain("Exactly the booking flow we needed.");
    expect(html).toContain("Written by the paying business after the payout");
    expect(html).toContain("Hire Ada Lovelace");
    expect(html).toContain("Post a job");
  });

  it("links directory and match cards to the profile", async () => {
    const app = newApp();
    const { business, profile } = await setup(app);
    const directory = await (await app.request("/coders")).text();
    expect(directory).toContain(`href="/coders/${profile.id}"`);

    const job = await createJob(app, business.cookie, { skills: "TypeScript" });
    const jobPage = await (
      await app.request(`/jobs/${job.id}`, { cookie: business.cookie })
    ).text();
    expect(jobPage).toContain(`href="/coders/${profile.id}"`);
  });

  it("hides pending profiles from strangers but shows the owner a preview", async () => {
    const app = newApp({ autoApprove: false });
    const coder = await app.signIn("pending@profile.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Pending Person",
      skills: "TypeScript",
    });
    expect((await app.request(`/coders/${profile.id}`)).status).toBe(404);
    const preview = await app.request(`/coders/${profile.id}`, { cookie: coder.cookie });
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain("Pending review");
  });

  it("returns 404 for an unknown coder id", async () => {
    const app = newApp();
    expect((await app.request("/coders/coder_missing")).status).toBe(404);
  });
});
