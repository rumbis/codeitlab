import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Engagement, Job } from "../src/shared/contracts.ts";
import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

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
  const business: SignedIn = await app.signIn("owner@assisted-jobs.test", "business");
  const coder: SignedIn = await app.signIn("coder@assisted-jobs.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript, React",
    rateMinCents: 5000,
    rateMaxCents: 20_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript, React",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
    assisted: true,
  });
  return { business, coder, profile, job };
}

async function post(
  app: TestApp,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = ADMIN,
) {
  return app.request(path, { method: "POST", headers, body });
}

describe("assisted jobs", () => {
  it("marks the job assisted and shows the 20% badge", async () => {
    const app = newApp();
    const { business, job } = await setup(app);
    const fetched = await app.json<{ job: Job }>(`/api/jobs/${job.id}`);
    expect(fetched.body.job.assisted).toBe(true);

    const page = await (await app.request(`/jobs/${job.id}`, { cookie: business.cookie })).text();
    expect(page).toContain("Assisted · 20%");
    expect(page).toContain("CodeitLab is helping run this job");
  });

  it("lets an operator write the scoping note the business paid for", async () => {
    const app = newApp();
    const { business, job } = await setup(app);

    const short = await post(app, `/api/admin/assisted/jobs/${job.id}/scope`, {
      note: "Too short",
    });
    expect(short.status).toBe(400);

    const saved = await post(app, `/api/admin/assisted/jobs/${job.id}/scope`, {
      note: "Done means the booking flow runs end to end on staging, with the confirmation email verified.",
    });
    expect(saved.status).toBe(200);

    const notifications = await app.json<{ notifications: { kind: string; message: string }[] }>(
      "/api/notifications",
      { cookie: business.cookie },
    );
    const scope = notifications.body.notifications.find((item) => item.kind === "scope");
    expect(scope?.message).toContain("operator note");

    const page = await (await app.request(`/jobs/${job.id}`, { cookie: business.cookie })).text();
    expect(page).toContain("CodeitLab operator note");
    expect(page).toContain("Done means the booking flow runs end to end");
  });

  it("shortlists up to three coders and notifies both sides", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await setup(app);

    const saved = await post(app, `/api/admin/assisted/jobs/${job.id}/shortlist`, {
      coderIds: profile.id,
    });
    expect(saved.status).toBe(200);

    const ownerPage = await (
      await app.request(`/jobs/${job.id}`, { cookie: business.cookie })
    ).text();
    expect(ownerPage).toContain("Operator pick");

    const coderPage = await (await app.request(`/jobs/${job.id}`, { cookie: coder.cookie })).text();
    expect(coderPage).toContain("Operator pick");
    expect(coderPage).toContain("The business sees your profile in the shortlist");

    const notifications = await app.json<{ notifications: { kind: string; message: string }[] }>(
      "/api/notifications",
      { cookie: coder.cookie },
    );
    expect(notifications.body.notifications.some((item) => item.kind === "shortlist")).toBe(true);
  });

  it("refuses too many, unknown, unapproved or non-assisted shortlist entries", async () => {
    const app = newApp();
    const { business, profile, job } = await setup(app);
    expect(
      (
        await post(app, `/api/admin/assisted/jobs/${job.id}/shortlist`, {
          coderIds: `${profile.id}, a, b, c`,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post(app, `/api/admin/assisted/jobs/${job.id}/shortlist`, {
          coderIds: "coder_missing",
        })
      ).status,
    ).toBe(404);

    const plain = await createJob(app, business.cookie, { skills: "TypeScript" });
    expect(
      (await post(app, `/api/admin/assisted/jobs/${plain.id}/shortlist`, { coderIds: profile.id }))
        .status,
    ).toBe(409);
  });

  it("requires the assisted tier when the job asked for help", async () => {
    const app = newApp();
    const { business, profile, job } = await setup(app);
    const standard = await app.request("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000, feeTier: "standard" },
    });
    expect(standard.status).toBe(400);
    expect(((await standard.json()) as { error: string }).error).toBe("assisted_tier_required");

    const assisted = await app.json<{ engagement: Engagement }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000, feeTier: "assisted" },
    });
    expect(assisted.response.status).toBe(201);
    expect(assisted.body.engagement.feeBps).toBe(2000);
  });

  it("requires the admin token for both endpoints", async () => {
    const app = newApp();
    const { job } = await setup(app);
    expect(
      (
        await app.request(`/api/admin/assisted/jobs/${job.id}/scope`, {
          method: "POST",
          body: { note: "x".repeat(30) },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(`/api/admin/assisted/jobs/${job.id}/shortlist`, {
          method: "POST",
          body: { coderIds: "" },
        })
      ).status,
    ).toBe(401);
  });
});
