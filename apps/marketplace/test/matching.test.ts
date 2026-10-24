import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type TestApp,
} from "./helpers.ts";

interface MatchPayload {
  matches: Array<{
    score: number;
    coder: { id: string; displayName: string; approved: boolean };
    reasons: Array<{ kind: string; detail: string }>;
    reputation: { level: string; completedEngagements: number };
  }>;
  count: number;
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

describe("coder matching", () => {
  it("ranks approved coders by the weighted score and explains each score", async () => {
    const app = newApp();
    const business = await app.signIn("owner@studio.test", "business");
    const job = await createJob(app, business.cookie, {
      skills: "Node.js, SQLite",
      budgetMinCents: 5000,
      budgetMaxCents: 10_000,
    });

    // 40% skill overlap, 15% interest, 15% evidence, 10% availability,
    // 10% rate fit, 5% completeness, 5% derived reputation.
    const ada = await app.signIn("ada@coders.test", "coder");
    const adaProfile = await createCoderProfile(app, ada.cookie, {
      displayName: "Ada",
      bio: "I build small, reliable web products end to end, from schema to interface, and ship them.",
      skills: "Node.js, SQLite, React",
      availability: "full_time",
      rateMinCents: 5000,
      rateMaxCents: 8000,
      links: "GitHub=https://github.com/ada",
    });
    await approveCoder(app, adaProfile.id);

    app.advance(1000);
    const bob = await app.signIn("bob@coders.test", "coder");
    const bobProfile = await createCoderProfile(app, bob.cookie, {
      displayName: "Bob",
      bio: "short",
      skills: "Node.js",
      availability: "part_time",
      rateMinCents: 20_000,
      rateMaxCents: 30_000,
    });
    await approveCoder(app, bobProfile.id);

    app.advance(1000);
    const cleo = await app.signIn("cleo@coders.test", "coder");
    const cleoProfile = await createCoderProfile(app, cleo.cookie, {
      displayName: "Cleo",
      bio: "I build small, reliable web products end to end, from schema to interface, and ship them.",
      skills: "React",
      availability: "not_available",
      rateMinCents: 5000,
      rateMaxCents: 5000,
    });
    await approveCoder(app, cleoProfile.id);

    // Unapproved coders never enter matching, even with a perfect profile.
    app.advance(1000);
    const dana = await app.signIn("dana@coders.test", "coder");
    await createCoderProfile(app, dana.cookie, {
      displayName: "Dana",
      skills: "Node.js, SQLite",
      availability: "full_time",
      rateMinCents: 5000,
      rateMaxCents: 6000,
      links: "Site=https://dana.dev",
    });

    const { response, body } = await app.json<MatchPayload>(`/api/jobs/${job.id}/matches`, {
      cookie: business.cookie,
    });

    expect(response.status).toBe(200);
    expect(body.count).toBe(3);
    expect(body.matches.map((match) => match.coder.displayName)).toEqual(["Ada", "Bob", "Cleo"]);
    expect(body.matches.map((match) => match.score)).toEqual([49, 34, 13]);

    const adaMatch = body.matches[0];
    expect(adaMatch?.reasons.map((reason) => reason.kind)).toEqual([
      "skills",
      "interest",
      "evidence",
      "availability",
      "rate",
      "completeness",
      "reputation",
    ]);
    expect(adaMatch?.reasons[0]?.detail).toContain("Matches 2 of 2 required skills");
    expect(adaMatch?.reasons[0]?.detail).toContain("level not set");
    expect(adaMatch?.reasons[1]?.detail).toContain("No declared interest");
    expect(adaMatch?.reasons[2]?.detail).toContain("No evidence links");
    expect(adaMatch?.reasons[3]?.detail).toContain("Full time");
    expect(adaMatch?.reasons[4]?.detail).toContain("fits");
    expect(adaMatch?.reasons[5]?.detail).toContain("link");
    expect(adaMatch?.reasons[6]?.detail).toContain("No paid deliveries yet");

    const bobMatch = body.matches[1];
    expect(bobMatch?.reasons[4]?.detail).toContain("outside");
    expect(bobMatch?.reasons[3]?.detail).toContain("Part time");

    const cleoMatch = body.matches[2];
    expect(cleoMatch?.reasons[0]?.detail).toContain("None of the required skills");
    expect(cleoMatch?.reasons[3]?.detail).toContain("Not currently available");
  });

  it("lets declared interest, skill depth and evidence outrank raw skill overlap", async () => {
    const app = newApp();
    const business = await app.signIn("video@studio.test", "business");
    const job = await createJob(app, business.cookie, {
      skills: "After Effects, Premiere",
      category: "video",
      budgetMinCents: 50_000,
      budgetMaxCents: 120_000,
    });

    // Lists both required skills but declares nothing about wanting the work.
    const ada = await app.signIn("ada@coders.test", "coder");
    const adaProfile = await createCoderProfile(app, ada.cookie, {
      displayName: "Ada",
      bio: "short",
      skills: "After Effects, Premiere",
      rateMinCents: 50_000,
      rateMaxCents: 100_000,
    });
    await approveCoder(app, adaProfile.id);

    // Knows one skill deeply, wants video work, and can prove it.
    app.advance(1000);
    const bob = await app.signIn("bob@coders.test", "coder");
    const bobProfile = await createCoderProfile(app, bob.cookie, {
      displayName: "Bob",
      bio: "I cut and animate product films end to end, from storyboard to the final grade and mix.",
      skills: "After Effects",
      interests: "video, design",
      skillLevels: "After Effects=5",
      evidence:
        "https://bob.example/film-1\nhttps://bob.example/film-2\nhttps://bob.example/film-3",
      rateMinCents: 50_000,
      rateMaxCents: 100_000,
      links: "Portfolio=https://bob.example",
    });
    await approveCoder(app, bobProfile.id);

    const { body } = await app.json<MatchPayload>(`/api/jobs/${job.id}/matches`, {
      cookie: business.cookie,
    });
    expect(body.matches.map((match) => match.coder.displayName)).toEqual(["Bob", "Ada"]);
    expect(body.matches.map((match) => match.score)).toEqual([74, 58]);

    const bobMatch = body.matches[0];
    expect(bobMatch?.reasons[1]?.detail).toContain("Declared interest in Video / motion (video)");
    expect(bobMatch?.reasons[2]?.detail).toContain("3 evidence link(s)");
    expect(bobMatch?.reasons[0]?.detail).toContain("After Effects 5/5");

    const adaMatch = body.matches[1];
    expect(adaMatch?.reasons[1]?.detail).toContain("No declared interest in Video / motion");
    expect(adaMatch?.reasons[2]?.detail).toContain("No evidence links");
  });

  it("adds a small, explained edge for paid delivery history", async () => {
    const app = newApp();
    const business = await app.signIn("reputation@studio.test", "business");
    const job = await createJob(app, business.cookie, {
      skills: "Node.js",
      budgetMinCents: 5000,
      budgetMaxCents: 10_000,
    });

    const fresh = await app.signIn("fresh@coders.test", "coder");
    const freshProfile = await createCoderProfile(app, fresh.cookie, {
      displayName: "Fresh",
      bio: "I build small, reliable web products end to end, from schema to interface, and ship them.",
      skills: "Node.js",
      availability: "full_time",
      rateMinCents: 5000,
      rateMaxCents: 8000,
    });
    await approveCoder(app, freshProfile.id);

    app.advance(1000);
    const proven = await app.signIn("proven@coders.test", "coder");
    const provenProfile = await createCoderProfile(app, proven.cookie, {
      displayName: "Proven",
      bio: "I build small, reliable web products end to end, from schema to interface, and ship them.",
      skills: "Node.js",
      availability: "full_time",
      rateMinCents: 5000,
      rateMaxCents: 8000,
    });
    await approveCoder(app, provenProfile.id);

    const deliveryJob = await createJob(app, business.cookie, { skills: "Node.js" });
    app.app.db
      .prepare(
        `INSERT INTO engagements
          (id, job_id, coder_id, business_id, amount_cents, fee_cents, payout_cents, currency,
           status, payment_ref, delivery_note, delivery_evidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid_out', ?, '', ?, ?, ?)`,
      )
      .run(
        "e-reputation",
        deliveryJob.id,
        provenProfile.id,
        business.account.id,
        12_000,
        1_800,
        10_200,
        "EUR",
        "mock_charge_reputation",
        '["https://example.com/proof"]',
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );

    const response = await app.json<MatchPayload>(`/api/jobs/${job.id}/matches`, {
      cookie: business.cookie,
    });
    expect(response.response.status).toBe(200);
    const [first, second] = response.body.matches;
    expect(first?.coder.displayName).toBe("Proven");
    expect((first?.score ?? 0) - (second?.score ?? 0)).toBe(2);
    expect(first?.reasons[6]?.detail).toContain("Proven reputation");
    expect(second?.reasons[6]?.detail).toContain("No paid deliveries yet");
  });

  it("breaks score ties by older profile and honours the limit", async () => {
    const app = newApp({ autoApprove: true });
    const business = await app.signIn("tie@studio.test", "business");
    const job = await createJob(app, business.cookie, { skills: "Rust" });

    const first = await app.signIn("first@coders.test", "coder");
    const firstProfile = await createCoderProfile(app, first.cookie, {
      displayName: "Older profile",
      skills: "Rust",
    });
    expect(firstProfile.approved).toBe(true);

    app.advance(60_000);
    const second = await app.signIn("second@coders.test", "coder");
    await createCoderProfile(app, second.cookie, {
      displayName: "Newer profile",
      skills: "Rust",
    });

    const full = await app.json<MatchPayload>(`/api/jobs/${job.id}/matches`, {
      cookie: business.cookie,
    });
    expect(full.body.matches.map((match) => match.coder.displayName)).toEqual([
      "Older profile",
      "Newer profile",
    ]);
    expect(full.body.matches[0]?.score).toBe(full.body.matches[1]?.score);

    const limited = await app.json<MatchPayload>(`/api/jobs/${job.id}/matches?limit=1`, {
      cookie: business.cookie,
    });
    expect(limited.body.count).toBe(1);
    expect(limited.body.matches[0]?.coder.displayName).toBe("Older profile");
  });

  it("only shows matches to the business that posted the job", async () => {
    const app = newApp({ autoApprove: true });
    const owner = await app.signIn("owner@studio.test", "business");
    const other = await app.signIn("other@studio.test", "business");
    const job = await createJob(app, owner.cookie, { skills: "TypeScript" });

    const stranger = await app.request(`/api/jobs/${job.id}/matches`, { cookie: other.cookie });
    expect(stranger.status).toBe(403);

    const anonymous = await app.request(`/api/jobs/${job.id}/matches`);
    expect(anonymous.status).toBe(401);
  });

  it("filters the public coder directory to approved profiles with every requested skill", async () => {
    const app = newApp();
    const business = await app.signIn("owner@studio.test", "business");
    const ada = await app.signIn("ada@coders.test", "coder");
    const adaProfile = await createCoderProfile(app, ada.cookie, {
      displayName: "Ada",
      skills: "React, TypeScript",
    });
    await approveCoder(app, adaProfile.id);

    app.advance(1000);
    const bob = await app.signIn("bob@coders.test", "coder");
    const bobProfile = await createCoderProfile(app, bob.cookie, {
      displayName: "Bob",
      skills: "React, Node.js",
    });
    await approveCoder(app, bobProfile.id);

    app.advance(1000);
    const pending = await app.signIn("pending@coders.test", "coder");
    await createCoderProfile(app, pending.cookie, {
      displayName: "Pending",
      skills: "React, TypeScript",
    });

    const all = await app.json<{ coders: Array<{ displayName: string }>; count: number }>(
      "/api/coders",
      { cookie: business.cookie },
    );
    expect(all.body.coders.map((coder) => coder.displayName).sort()).toEqual(["Ada", "Bob"]);

    const react = await app.json<{ coders: Array<{ displayName: string }> }>(
      "/api/coders?skills=react",
      { cookie: business.cookie },
    );
    expect(react.body.coders.map((coder) => coder.displayName).sort()).toEqual(["Ada", "Bob"]);

    const reactTs = await app.json<{ coders: Array<{ displayName: string }> }>(
      "/api/coders?skills=react,typescript",
      { cookie: business.cookie },
    );
    expect(reactTs.body.coders.map((coder) => coder.displayName)).toEqual(["Ada"]);
  });
});
