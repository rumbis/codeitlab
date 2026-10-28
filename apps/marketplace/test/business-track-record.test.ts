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

async function setup(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@track.test", "business");
  const coder: SignedIn = await app.signIn("coder@track.test", "coder");
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
    budgetMaxCents: 15_000,
  });
  return { business, coder, profile, job };
}

async function payOneEngagement(
  app: TestApp,
  business: SignedIn,
  coder: SignedIn,
  coderId: string,
) {
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
  const created = await app.json<{ engagement: Engagement }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId, amountCents: 12_000 },
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
    form: { deliveryNote: "Done." },
  });
  await app.request(`/api/engagements/${engagement.id}/approve`, {
    method: "POST",
    cookie: business.cookie,
  });
  return engagement;
}

describe("business track record on a job", () => {
  it("tells a coder when the business has never paid anyone", async () => {
    const app = newApp();
    const { job } = await setup(app);
    const page = await (await app.request(`/jobs/${job.id}`)).text();
    expect(page).toContain("New business: no completed engagements yet");
    expect(page).toContain("Escrow still protects you");
  });

  it("shows paid engagements and the month of the first payout", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await setup(app);
    await payOneEngagement(app, business, coder, profile.id);
    const page = await (await app.request(`/jobs/${job.id}`)).text();
    expect(page).toContain("Has paid out 1 engagement through escrow since");
    expect(page).not.toContain("New business: no completed engagements yet");
  });

  it("does not count requested or delivered engagements as paid", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await setup(app);
    const created = await app.json<{ engagement: Engagement }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    const engagement = created.body.engagement;
    for (const action of ["accept", "start"] as const) {
      await app.request(`/api/engagements/${engagement.id}/${action}`, {
        method: "POST",
        cookie: coder.cookie,
      });
    }
    const page = await (await app.request(`/jobs/${job.id}`)).text();
    expect(page).toContain("New business: no completed engagements yet");
  });
});
