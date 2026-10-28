import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type TestApp,
} from "./helpers.ts";

interface Quest {
  id: string;
  title: string;
  done: boolean;
  lesson: string;
  reward: string;
}

interface Board {
  role: string;
  quests: Quest[];
  done: number;
  total: number;
  next: Quest | null;
}

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp(overrides);
  apps.push(app);
  return app;
}

async function board(app: TestApp, cookie: string): Promise<Board> {
  const { response, body } = await app.json<Board>("/api/quests", { cookie });
  expect(response.status).toBe(200);
  return body;
}

describe("quest board", () => {
  it("starts a fresh coder at zero and advances only on real artifacts", async () => {
    const app = newApp();
    const coder = await app.signIn("coder@quests.test", "coder");

    const start = await board(app, coder.cookie);
    expect(start.role).toBe("coder");
    expect(start.total).toBe(9);
    expect(start.done).toBe(0);
    expect(start.next?.id).toBe("profile");
    expect(start.quests.map((quest) => quest.id)).toEqual([
      "profile",
      "interests",
      "evidence",
      "apply",
      "deliver",
      "proof",
      "trusted",
      "search",
      "rating",
    ]);
    // Every quest teaches the mechanic it gates.
    for (const quest of start.quests) {
      expect(quest.lesson.length).toBeGreaterThan(60);
      expect(quest.reward.length).toBeGreaterThan(0);
    }

    // A profile alone completes the first quest, not the interest one.
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
    });
    const afterProfile = await board(app, coder.cookie);
    expect(afterProfile.done).toBe(1);
    expect(afterProfile.next?.id).toBe("interests");
    expect(afterProfile.quests.find((quest) => quest.id === "profile")?.done).toBe(true);

    // Declaring interests and adding evidence complete the next two.
    await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
      interests: "web, ai",
      evidence: "https://ada.example/work",
    });
    const afterDeclarations = await board(app, coder.cookie);
    expect(afterDeclarations.done).toBe(3);
    expect(afterDeclarations.next?.id).toBe("apply");

    // Applying is real work: it needs an open job.
    const business = await app.signIn("owner@quests.test", "business");
    const job = await createJob(app, business.cookie, { skills: "TypeScript" });
    const applied = await app.request(`/api/jobs/${job.id}/interests`, {
      method: "POST",
      cookie: coder.cookie,
      body: { message: "I can ship this in a week." },
    });
    expect(applied.status).toBe(201);
    const afterApply = await board(app, coder.cookie);
    expect(afterApply.done).toBe(4);
    expect(afterApply.next?.id).toBe("deliver");

    // The last quest completes only after a paid, approved delivery.
    await approveCoder(app, profile.id);
    const engagement = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    expect(engagement.response.status).toBe(201);
    const engagementId = engagement.body.engagement.id;
    for (const [action, cookie] of [
      ["accept", coder.cookie],
      ["start", coder.cookie],
    ] as const) {
      const response = await app.request(`/api/engagements/${engagementId}/${action}`, {
        method: "POST",
        cookie,
      });
      expect(response.status).toBe(200);
    }
    const delivered = await app.request(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: { deliveryNote: "Shipped.", deliveryEvidence: "https://ada.example/proof" },
    });
    expect(delivered.status).toBe(303);
    const approved = await app.request(`/api/engagements/${engagementId}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(approved.status).toBe(200);

    const finished = await board(app, coder.cookie);
    expect(finished.done).toBe(6);
    expect(finished.next?.id).toBe("trusted");
    expect(finished.quests.find((quest) => quest.id === "search")?.done).toBe(false);

    const saved = await app.request("/api/saved-searches", {
      method: "POST",
      cookie: coder.cookie,
      body: { q: "video" },
    });
    expect(saved.status).toBe(200);
    const afterSearch = await board(app, coder.cookie);
    expect(afterSearch.quests.find((quest) => quest.id === "search")?.done).toBe(true);
    expect(afterSearch.done).toBe(7);
  });

  it("walks a business from company profile to approved delivery", async () => {
    const app = newApp({ autoApprove: true });
    const business = await app.signIn("owner@biz.test", "business");

    const start = await board(app, business.cookie);
    expect(start.role).toBe("business");
    expect(start.total).toBe(7);
    expect(start.done).toBe(0);
    expect(start.next?.id).toBe("company");

    await app.request("/api/business/profile", {
      method: "POST",
      cookie: business.cookie,
      body: { companyName: "Studio", website: "https://studio.example", about: "We ship films." },
    });
    expect((await board(app, business.cookie)).done).toBe(1);

    const job = await createJob(app, business.cookie, {
      skills: "After Effects",
      category: "video",
    });
    expect((await board(app, business.cookie)).done).toBe(2);

    const coder = await app.signIn("coder@biz.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Bob",
      skills: "After Effects",
      interests: "video",
    });
    const engagement = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 8_000 },
    });
    expect(engagement.response.status).toBe(201);
    expect((await board(app, business.cookie)).done).toBe(3);

    const engagementId = engagement.body.engagement.id;
    for (const [action, cookie] of [
      ["accept", coder.cookie],
      ["start", coder.cookie],
    ] as const) {
      const response = await app.request(`/api/engagements/${engagementId}/${action}`, {
        method: "POST",
        cookie,
      });
      expect(response.status).toBe(200);
    }
    await app.request(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: { deliveryNote: "Delivered.", deliveryEvidence: "https://studio.example/film" },
    });
    await app.request(`/api/engagements/${engagementId}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    const rated = await app.request(`/api/engagements/${engagementId}/rating`, {
      method: "POST",
      cookie: business.cookie,
      body: { score: 5, comment: "Exactly what we needed." },
    });
    expect(rated.status).toBe(200);
    const finished = await board(app, business.cookie);
    expect(finished.done).toBe(6);
    expect(finished.next?.id).toBe("hear");

    const enabled = await app.request("/api/notifications/preferences", {
      method: "POST",
      cookie: business.cookie,
      body: { emailNotifications: "on" },
    });
    expect(enabled.status).toBe(200);
    const afterEmail = await board(app, business.cookie);
    expect(afterEmail.done).toBe(7);
    expect(afterEmail.next).toBeNull();
  });

  it("requires a session", async () => {
    const app = newApp();
    const response = await app.request("/api/quests");
    expect(response.status).toBe(401);
  });
});
