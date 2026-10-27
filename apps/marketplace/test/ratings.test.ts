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

interface EngagementPayload {
  engagement: Engagement;
}

async function paidEngagement(app: TestApp, options: { email?: string; approve?: boolean } = {}) {
  const email = options.email ?? "rating";
  const business: SignedIn = await app.signIn(`owner@${email}.test`, "business");
  const coder: SignedIn = await app.signIn(`coder@${email}.test`, "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada Lovelace",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 20_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
  });
  const created = await app.json<EngagementPayload>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 12_000 },
  });
  expect(created.response.status).toBe(201);
  const engagement = created.body.engagement;
  for (const action of ["accept", "start"] as const) {
    expect(
      (
        await app.request(`/api/engagements/${engagement.id}/${action}`, {
          method: "POST",
          cookie: coder.cookie,
        })
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await app.request(`/api/engagements/${engagement.id}/deliver`, {
        method: "POST",
        cookie: coder.cookie,
        form: { deliveryNote: "Shipped.", deliveryEvidence: "https://example.com/proof" },
      })
    ).status,
  ).toBe(303);
  if (options.approve !== false) {
    expect(
      (
        await app.request(`/api/engagements/${engagement.id}/approve`, {
          method: "POST",
          cookie: business.cookie,
        })
      ).status,
    ).toBe(200);
  }
  return { business, coder, profile, job, engagement };
}

async function rate(
  app: TestApp,
  cookie: string,
  engagementId: string,
  body: Record<string, unknown>,
) {
  return app.request(`/api/engagements/${engagementId}/rating`, {
    method: "POST",
    cookie,
    body,
  });
}

describe("ratings after payout", () => {
  it("stores a rating, shows it on cards, and notifies the coder", async () => {
    const app = newApp();
    const { business, coder, engagement } = await paidEngagement(app);

    const saved = await rate(app, business.cookie, engagement.id, {
      score: 5,
      comment: "Clear communication and tests included.",
    });
    expect(saved.status).toBe(200);
    const payload = (await saved.json()) as { rating: { score: number; comment: string } };
    expect(payload.rating.score).toBe(5);

    const coderDashboard = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(coderDashboard).toContain("★ 5.0 · 1");
    expect(coderDashboard).toContain("Clear communication and tests included.");

    const directory = await (await app.request("/coders")).text();
    expect(directory).toContain("★ 5.0");
    expect(directory).toContain("from 1 rating");

    const notifications = await app.json<{ notifications: { kind: string; message: string }[] }>(
      "/api/notifications",
      { cookie: coder.cookie },
    );
    const review = notifications.body.notifications.find((item) => item.kind === "review");
    expect(review?.message).toContain("5/5");
  });

  it("averages ratings and counts them on the directory", async () => {
    const app = newApp();
    const first = await paidEngagement(app, { email: "first" });
    const second = await paidEngagement(app, { email: "second" });
    expect((await rate(app, first.business.cookie, first.engagement.id, { score: 4 })).status).toBe(
      200,
    );
    // Second business hires the first coder profile to make the average meaningful.
    const job = await createJob(app, second.business.cookie, {
      skills: "TypeScript",
      budgetMinCents: 5000,
      budgetMaxCents: 20_000,
    });
    const created = await app.json<EngagementPayload>("/api/engagements", {
      method: "POST",
      cookie: second.business.cookie,
      body: { jobId: job.id, coderId: first.profile.id, amountCents: 10_000 },
    });
    const engagement = created.body.engagement;
    for (const action of ["accept", "start"] as const) {
      expect(
        (
          await app.request(`/api/engagements/${engagement.id}/${action}`, {
            method: "POST",
            cookie: first.coder.cookie,
          })
        ).status,
      ).toBe(200);
    }
    await app.request(`/api/engagements/${engagement.id}/deliver`, {
      method: "POST",
      cookie: first.coder.cookie,
      form: { deliveryNote: "Second delivery." },
    });
    await app.request(`/api/engagements/${engagement.id}/approve`, {
      method: "POST",
      cookie: second.business.cookie,
    });
    expect((await rate(app, second.business.cookie, engagement.id, { score: 5 })).status).toBe(200);

    const directory = await (await app.request("/coders")).text();
    expect(directory).toContain("★ 4.5");
    expect(directory).toContain("from 2 ratings");
  });

  it("refuses ratings before the payout, from the wrong account, or twice", async () => {
    const app = newApp();
    const { business, coder, engagement } = await paidEngagement(app, { approve: false });

    const early = await rate(app, business.cookie, engagement.id, { score: 5 });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toBe("not_paid_out");

    // Approve now, then try the wrong role and the wrong business.
    await app.request(`/api/engagements/${engagement.id}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect((await rate(app, coder.cookie, engagement.id, { score: 5 })).status).toBe(403);
    const otherBusiness = await app.signIn("other@rating.test", "business");
    expect((await rate(app, otherBusiness.cookie, engagement.id, { score: 5 })).status).toBe(403);

    expect((await rate(app, business.cookie, engagement.id, { score: 5 })).status).toBe(200);
    const twice = await rate(app, business.cookie, engagement.id, { score: 4 });
    expect(twice.status).toBe(409);
    expect(((await twice.json()) as { error: string }).error).toBe("already_rated");
  });

  it("validates the score and the comment length", async () => {
    const app = newApp();
    const { business, engagement } = await paidEngagement(app);
    expect((await rate(app, business.cookie, engagement.id, { score: 0 })).status).toBe(400);
    expect((await rate(app, business.cookie, engagement.id, { score: 6 })).status).toBe(400);
    expect((await rate(app, business.cookie, engagement.id, { score: 5.5 })).status).toBe(400);
    expect(
      (await rate(app, business.cookie, engagement.id, { score: 5, comment: "x".repeat(501) }))
        .status,
    ).toBe(400);
    expect((await rate(app, business.cookie, engagement.id, { score: 5 })).status).toBe(200);
  });

  it("completes the rate quest for the business", async () => {
    const app = newApp();
    const { business, engagement } = await paidEngagement(app);
    const before = await app.json<{ quests: { id: string; done: boolean }[] }>("/api/quests", {
      cookie: business.cookie,
    });
    expect(before.body.quests.find((quest) => quest.id === "rate")?.done).toBe(false);
    await rate(app, business.cookie, engagement.id, { score: 5 });
    const after = await app.json<{ quests: { id: string; done: boolean }[] }>("/api/quests", {
      cookie: business.cookie,
    });
    expect(after.body.quests.find((quest) => quest.id === "rate")?.done).toBe(true);
  });
});
