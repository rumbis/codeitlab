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
  const business = await app.signIn("owner@limits.test", "business");
  const coder = await app.signIn("coder@limits.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  return { business, coder, profile };
}

async function newJob(app: TestApp, cookie: string) {
  return createJob(app, cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
}

async function startEngagement(app: TestApp, cookie: string, jobId: string, coderId: string) {
  return app.request("/api/engagements", {
    method: "POST",
    cookie,
    body: { jobId, coderId, amountCents: 10_000 },
  });
}

describe("money-path rate limits", () => {
  it("caps escrow charges per business per hour and recovers after the window", async () => {
    const app = newApp({ rateLimits: { chargePerHour: 2 } });
    const { business, profile } = await setup(app);

    const first = await startEngagement(
      app,
      business.cookie,
      (await newJob(app, business.cookie)).id,
      profile.id,
    );
    expect(first.status).toBe(201);
    const second = await startEngagement(
      app,
      business.cookie,
      (await newJob(app, business.cookie)).id,
      profile.id,
    );
    expect(second.status).toBe(201);

    const third = await startEngagement(
      app,
      business.cookie,
      (await newJob(app, business.cookie)).id,
      profile.id,
    );
    expect(third.status).toBe(429);
    const body = (await third.json()) as { error: string; message: string };
    expect(body.error).toBe("rate_limited");
    expect(body.message).toContain("escrow charges");

    // The window is sliding: an hour later the same account may charge again.
    app.advance(60 * 60_000 + 1_000);
    const fourth = await startEngagement(
      app,
      business.cookie,
      (await newJob(app, business.cookie)).id,
      profile.id,
    );
    expect(fourth.status).toBe(201);
  });

  it("caps engagement actions per account without touching the other side", async () => {
    const app = newApp({ rateLimits: { transitionPerHour: 3 } });
    const { business, coder, profile } = await setup(app);
    const job = await newJob(app, business.cookie);
    const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    const engagementId = created.body.engagement.id;

    for (const action of ["accept", "start"] as const) {
      expect(
        (
          await app.request(`/api/engagements/${engagementId}/${action}`, {
            method: "POST",
            cookie: coder.cookie,
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await app.request(`/api/engagements/${engagementId}/deliver`, {
          method: "POST",
          cookie: coder.cookie,
          form: { deliveryNote: "Done.", deliveryEvidence: "https://example.com/proof" },
        })
      ).status,
    ).toBe(303);

    // The coder used 3 of 3 actions; a fourth is refused.
    const blocked = await app.request(`/api/engagements/${engagementId}/dispute`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(blocked.status).toBe(429);

    // The business has its own bucket, so approval still works.
    const approved = await app.request(`/api/engagements/${engagementId}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(approved.status).toBe(200);

    // And the coder's bucket recovers after the window.
    app.advance(60 * 60_000 + 1_000);
    const later = await app.request(`/api/engagements/${engagementId}/dispute`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(later.status).toBe(409); // illegal transition, not rate limited
  });

  it("does not count invalid requests against the charge limit", async () => {
    const app = newApp({ rateLimits: { chargePerHour: 1 } });
    const { business, profile } = await setup(app);
    const job = await newJob(app, business.cookie);

    // A rejected amount never reaches the charge guard.
    const rejected = await app.request("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 999_999 },
    });
    expect(rejected.status).toBe(400);

    const first = await startEngagement(app, business.cookie, job.id, profile.id);
    expect(first.status).toBe(201);
    const second = await startEngagement(
      app,
      business.cookie,
      (await newJob(app, business.cookie)).id,
      profile.id,
    );
    expect(second.status).toBe(429);
  });
});
