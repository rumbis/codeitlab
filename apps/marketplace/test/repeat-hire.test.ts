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

async function settledEngagement(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@repeat.test", "business");
  const coder: SignedIn = await app.signIn("coder@repeat.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript, SQLite",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    title: "Build the booking flow",
    description: "A booking flow for a yoga studio with a SQLite backend.",
    skills: "TypeScript, SQLite",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
  });
  await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this." },
  });
  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 12_000 },
  });
  expect(created.response.status).toBe(201);
  const id = created.body.engagement.id;
  for (const action of ["accept", "start", "deliver"]) {
    const response = await app.request(`/api/engagements/${id}/${action}`, {
      method: "POST",
      cookie: coder.cookie,
      body: action === "deliver" ? { deliveryNote: "Shipped.", deliveryEvidence: [] } : undefined,
    });
    expect(response.status).toBe(200);
  }
  const approve = await app.request(`/api/engagements/${id}/approve`, {
    method: "POST",
    cookie: business.cookie,
  });
  expect(approve.status).toBe(200);
  return { business, coder, profile, job, engagementId: id };
}

describe("repeat hire", () => {
  it("offers Hire again only after the money settled", async () => {
    const app = newApp();
    const { business, engagementId } = await settledEngagement(app);
    const dashboard = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    expect(dashboard).toContain("Hire Ada again");
    expect(dashboard).toContain(`/dashboard?repeat=${engagementId}`);
  });

  it("prefills the job form from the settled engagement", async () => {
    const app = newApp();
    const { business, engagementId } = await settledEngagement(app);
    const page = await (
      await app.request(`/dashboard?repeat=${engagementId}`, { cookie: business.cookie })
    ).text();
    expect(page).toContain("Prefilled from a settled engagement");
    expect(page).toContain('name="repeatEngagementId"');
    expect(page).toContain(`value="${engagementId}"`);
    expect(page).toContain('value="Build the booking flow"');
    expect(page).toContain("A booking flow for a yoga studio with a SQLite backend.");
    expect(page).toContain('value="TypeScript, SQLite"');
  });

  it("publishes a fresh job and invites the same coder in one step", async () => {
    const app = newApp();
    const { business, coder, engagementId } = await settledEngagement(app);
    const posted = await app.json<{ job: { id: string; title: string; status: string } }>(
      "/api/jobs",
      {
        method: "POST",
        cookie: business.cookie,
        body: {
          title: "Build the booking flow",
          description: "A booking flow for a yoga studio with a SQLite backend.",
          skills: "TypeScript, SQLite",
          category: "web",
          budgetMinCents: 5000,
          budgetMaxCents: 20_000,
          currency: "EUR",
          timeline: "2–3 weeks",
          repeatEngagementId: engagementId,
        },
      },
    );
    expect(posted.response.status).toBe(201);
    expect(posted.body.job.id).not.toBe(engagementId);

    const notifications = await app.json<{ notifications: { kind: string; message: string }[] }>(
      "/api/notifications",
      { cookie: coder.cookie },
    );
    const invite = notifications.body.notifications.find((row) => row.kind === "invite");
    expect(invite?.message).toContain("You worked with us before");
  });

  it("publishes normally when the engagement is not the business's or not settled", async () => {
    const app = newApp();
    const { engagementId } = await settledEngagement(app);
    const stranger: SignedIn = await app.signIn("other@repeat.test", "business");
    const posted = await app.json<{ job: { id: string } }>("/api/jobs", {
      method: "POST",
      cookie: stranger.cookie,
      body: {
        title: "Unrelated work",
        description: "A small unrelated brief that is long enough to validate.",
        skills: "TypeScript",
        category: "web",
        budgetMinCents: 1000,
        budgetMaxCents: 2000,
        currency: "EUR",
        timeline: "1 week",
        repeatEngagementId: engagementId,
      },
    });
    expect(posted.response.status).toBe(201);

    const page = await (
      await app.request(`/dashboard?repeat=${engagementId}`, { cookie: stranger.cookie })
    ).text();
    expect(page).not.toContain("Prefilled from a settled engagement");
  });
});
