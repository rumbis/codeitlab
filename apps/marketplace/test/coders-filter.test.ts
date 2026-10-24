import { afterEach, describe, expect, it } from "vite-plus/test";

import { approveCoder, createCoderProfile, createTestApp, type TestApp } from "./helpers.ts";

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

interface Coder {
  profileId: string;
  displayName: string;
}

async function makeCoder(
  app: TestApp,
  input: { email: string; displayName: string; skills: string; interests: string },
): Promise<Coder> {
  const coder = await app.signIn(input.email, "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: input.displayName,
    skills: input.skills,
    interests: input.interests,
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  return { profileId: profile.id, displayName: input.displayName };
}

/** Insert a paid delivery directly: reputation is derived, so this is the fact. */
function recordPaidDelivery(app: TestApp, coder: Coder, businessAccountId: string): void {
  const jobId = `job_${coder.profileId}`;
  app.app.db
    .prepare(
      `INSERT INTO jobs (id, business_id, title, description, skills, category, budget_min_cents,
        budget_max_cents, currency, timeline, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'web', 5000, 20000, 'EUR', '1 week', 'closed', ?)`,
    )
    .run(
      jobId,
      businessAccountId,
      `Job for ${coder.displayName}`,
      "Inserted by a test.",
      "TypeScript",
      "2026-01-01T00:00:00.000Z",
    );
  app.app.db
    .prepare(
      `INSERT INTO engagements
        (id, job_id, coder_id, business_id, amount_cents, fee_cents, payout_cents, currency,
         status, payment_ref, delivery_note, delivery_evidence, created_at, updated_at)
       VALUES (?, ?, ?, ?, 12000, 1800, 10200, 'EUR', 'paid_out', 'mock_charge_test', '', ?, ?, ?)`,
    )
    .run(
      `e_${coder.profileId}`,
      jobId,
      coder.profileId,
      businessAccountId,
      '["https://example.com/proof"]',
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
}

describe("coder directory filters", () => {
  it("filters by declared interest domain with any-match semantics", async () => {
    const app = newApp();
    await makeCoder(app, {
      email: "video@coders.test",
      displayName: "Vera",
      skills: "After Effects",
      interests: "video, animation",
    });
    await makeCoder(app, {
      email: "web@coders.test",
      displayName: "Wes",
      skills: "TypeScript",
      interests: "web",
    });
    await makeCoder(app, {
      email: "none@coders.test",
      displayName: "Nia",
      skills: "Python",
      interests: "",
    });

    const video = await (await app.request("/coders?interest=video")).text();
    expect(video).toContain("Vera");
    expect(video).not.toContain("Wes");
    expect(video).not.toContain("Nia");

    // "animation" is one of Vera's declared domains, so the same coder matches.
    const animation = await (await app.request("/coders?interest=animation")).text();
    expect(animation).toContain("Vera");

    // Multiple domains are OR-ed.
    const either = await (await app.request("/coders?interest=video,web")).text();
    expect(either).toContain("Vera");
    expect(either).toContain("Wes");
    expect(either).not.toContain("Nia");
  });

  it("combines interest with the all-skills filter", async () => {
    const app = newApp();
    await makeCoder(app, {
      email: "both@coders.test",
      displayName: "Both",
      skills: "TypeScript, React",
      interests: "web",
    });
    await makeCoder(app, {
      email: "half@coders.test",
      displayName: "Half",
      skills: "TypeScript",
      interests: "web",
    });

    const html = await (await app.request("/coders?interest=web&skills=TypeScript,React")).text();
    expect(html).toContain("Both");
    expect(html).not.toContain("Half");
  });

  it("sorts proven work first only when asked, and never hides new coders", async () => {
    const app = newApp();
    const business = await app.signIn("owner@coders.test", "business");
    const proven = await makeCoder(app, {
      email: "proven@coders.test",
      displayName: "Proven",
      skills: "TypeScript",
      interests: "web",
    });
    recordPaidDelivery(app, proven, business.account.id);
    app.advance(1_000);
    const fresh = await makeCoder(app, {
      email: "fresh@coders.test",
      displayName: "Fresh",
      skills: "TypeScript",
      interests: "web",
    });

    // Default order stays newest-first, so the older profile is not buried.
    const newest = await (await app.request("/coders")).text();
    expect(newest.indexOf(">Fresh<")).toBeLessThan(newest.indexOf(">Proven<"));

    const byReputation = await (await app.request("/coders?sort=reputation")).text();
    expect(byReputation.indexOf(">Proven<")).toBeLessThan(byReputation.indexOf(">Fresh<"));
    expect(byReputation).toContain("proven work first");
    expect(byReputation).toContain("1 paid");

    // The sort does not filter: both are still listed.
    expect(byReputation).toContain("Fresh");
    expect(fresh.displayName).toBe("Fresh");
  });

  it("explains an empty result and keeps the filter controls", async () => {
    const app = newApp();
    await makeCoder(app, {
      email: "only@coders.test",
      displayName: "Only",
      skills: "TypeScript",
      interests: "web",
    });

    const html = await (await app.request("/coders?interest=video")).text();
    expect(html).toContain("No coders match that filter");
    expect(html).toContain("Try fewer filters");
    expect(html).toContain('name="interest"');
    expect(html).toContain('name="sort"');
    expect(html).toContain("Clear");
  });
});
