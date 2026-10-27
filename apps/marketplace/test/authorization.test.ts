import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Engagement } from "../src/shared/contracts.ts";
import {
  TEST_ADMIN_TOKEN,
  TEST_ORIGIN,
  approveCoder,
  cookieHeader,
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
  const app = createTestApp({ autoApprove: true, baseUrl: TEST_ORIGIN, ...overrides });
  apps.push(app);
  return app;
}

interface World {
  app: TestApp;
  businessA: SignedIn;
  businessB: SignedIn;
  coderA: SignedIn;
  coderB: SignedIn;
  profileA: { id: string };
  profileB: { id: string };
  jobA: { id: string };
  jobB: { id: string };
  engagement: Engagement;
}

async function world(): Promise<World> {
  const app = newApp();
  const businessA = await app.signIn("owner-a@authz.test", "business");
  const businessB = await app.signIn("owner-b@authz.test", "business");
  const coderA = await app.signIn("coder-a@authz.test", "coder");
  const coderB = await app.signIn("coder-b@authz.test", "coder");
  const profileA = await createCoderProfile(app, coderA.cookie, {
    displayName: "Coder A",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  const profileB = await createCoderProfile(app, coderB.cookie, {
    displayName: "Coder B",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profileA.id);
  await approveCoder(app, profileB.id);
  const jobA = await createJob(app, businessA.cookie, {
    title: "Job A",
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
  const jobB = await createJob(app, businessB.cookie, {
    title: "Job B",
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
  const created = await app.json<{ engagement: Engagement }>("/api/engagements", {
    method: "POST",
    cookie: businessA.cookie,
    body: { jobId: jobA.id, coderId: profileA.id, amountCents: 10_000 },
  });
  expect(created.response.status).toBe(201);
  return {
    app,
    businessA,
    businessB,
    coderA,
    coderB,
    profileA,
    profileB,
    jobA,
    jobB,
    engagement: created.body.engagement,
  };
}

describe("authorization matrix", () => {
  it("rejects anonymous access to private API routes", async () => {
    const { app } = await world();
    for (const [method, path] of [
      ["GET", "/api/notifications"],
      ["POST", "/api/jobs"],
      ["POST", "/api/engagements"],
      ["GET", "/api/engagements"],
      ["POST", "/api/notifications/read"],
      ["GET", "/api/quests"],
      ["GET", "/api/admin/ledger"],
      ["POST", "/api/admin/mail/drain"],
    ] as const) {
      const response = await app.request(path, { method });
      expect(response.status, `${method} ${path}`).toBe(401);
    }
  });

  it("keeps each side out of the other side's jobs and matches", async () => {
    const { app, businessA, businessB, coderA, jobA, profileA } = await world();
    expect(
      (await app.request(`/api/jobs/${jobA.id}/matches`, { cookie: businessB.cookie })).status,
    ).toBe(403);
    expect(
      (await app.request(`/api/jobs/${jobA.id}/matches`, { cookie: businessA.cookie })).status,
    ).toBe(200);

    // A business cannot apply, a coder cannot post a job.
    expect(
      (
        await app.request(`/api/jobs/${jobA.id}/interests`, {
          method: "POST",
          cookie: businessA.cookie,
          body: { message: "hire me" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/jobs", {
          method: "POST",
          cookie: coderA.cookie,
          body: {
            title: "x",
            description: "y".repeat(30),
            skills: "TypeScript",
            budgetMinCents: 1,
            budgetMaxCents: 2,
            currency: "EUR",
            timeline: "now",
          },
        })
      ).status,
    ).toBe(403);

    // A coder cannot start an engagement, and cannot hire themselves.
    expect(
      (
        await app.request("/api/engagements", {
          method: "POST",
          cookie: coderA.cookie,
          body: { jobId: jobA.id, coderId: profileA.id, amountCents: 10_000 },
        })
      ).status,
    ).toBe(403);
  });

  it("refuses engagement actions from anyone who is not a party", async () => {
    const { app, businessA, businessB, coderA, coderB, engagement } = await world();
    for (const action of ["accept", "start", "deliver", "approve", "cancel", "dispute"] as const) {
      const response = await app.request(`/api/engagements/${engagement.id}/${action}`, {
        method: "POST",
        cookie: businessB.cookie,
      });
      expect([403, 409], `${action} by another business`).toContain(response.status);
      const coderResponse = await app.request(`/api/engagements/${engagement.id}/${action}`, {
        method: "POST",
        cookie: coderB.cookie,
      });
      expect([403, 409], `${action} by another coder`).toContain(coderResponse.status);
    }
    // The wrong party of the same engagement is refused too.
    expect(
      (
        await app.request(`/api/engagements/${engagement.id}/approve`, {
          method: "POST",
          cookie: coderA.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(`/api/engagements/${engagement.id}/accept`, {
          method: "POST",
          cookie: businessA.cookie,
        })
      ).status,
    ).toBe(403);
  });

  it("lists and marks read only the caller's notifications", async () => {
    const { app, businessA, coderA, coderB } = await world();
    const mine = await app.json<{ notifications: { message: string }[]; unread: number }>(
      "/api/notifications",
      { cookie: coderA.cookie },
    );
    expect(mine.body.notifications.length).toBeGreaterThan(0);
    expect(mine.body.unread).toBeGreaterThan(0);

    const theirs = await app.json<{ notifications: unknown[]; unread: number }>(
      "/api/notifications",
      { cookie: coderB.cookie },
    );
    expect(theirs.body.notifications).toHaveLength(0);
    expect(theirs.body.unread).toBe(0);

    await app.request("/api/notifications/read", { method: "POST", cookie: coderB.cookie });
    const stillMine = await app.json<{ unread: number }>("/api/notifications", {
      cookie: coderA.cookie,
    });
    expect(stillMine.body.unread).toBeGreaterThan(0);
    await app.request("/api/notifications/read", { method: "POST", cookie: coderA.cookie });
    expect(
      (await app.json<{ unread: number }>("/api/notifications", { cookie: coderA.cookie })).body
        .unread,
    ).toBe(0);
    void businessA;
  });

  it("keeps engagement listings scoped to the caller", async () => {
    const { app, businessB, coderB } = await world();
    const asBusiness = await app.json<{ count: number }>("/api/engagements", {
      cookie: businessB.cookie,
    });
    expect(asBusiness.body.count).toBe(0);
    const asCoder = await app.json<{ count: number }>("/api/engagements", {
      cookie: coderB.cookie,
    });
    expect(asCoder.body.count).toBe(0);
  });

  it("refuses profile creation for the wrong role", async () => {
    const { app, businessA, coderA } = await world();
    expect(
      (
        await app.request("/api/business/profile", {
          method: "POST",
          cookie: coderA.cookie,
          body: { companyName: "X", website: "", about: "We do things with software." },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request("/api/coders/profile", {
          method: "POST",
          cookie: businessA.cookie,
          body: {
            displayName: "X",
            headline: "Y",
            bio: "Z".repeat(30),
            skills: "TypeScript",
            rateMinCents: 1000,
            rateMaxCents: 2000,
            currency: "EUR",
            timezone: "UTC",
          },
        })
      ).status,
    ).toBe(403);
  });

  it("rejects cross-origin writes and accepts same-origin ones", async () => {
    const { app, businessA } = await world();
    const body = {
      title: "Origin check job",
      description: "A description long enough to pass validation.",
      skills: "TypeScript",
      budgetMinCents: 5000,
      budgetMaxCents: 9000,
      currency: "EUR",
      timeline: "2 weeks",
    };
    const cross = await app.request("/api/jobs", {
      method: "POST",
      cookie: businessA.cookie,
      headers: { origin: "https://evil.example" },
      body,
    });
    expect(cross.status).toBe(403);
    expect(((await cross.json()) as { error: string }).error).toBe("cross_origin");

    const same = await app.request("/api/jobs", {
      method: "POST",
      cookie: businessA.cookie,
      headers: { origin: TEST_ORIGIN },
      body,
    });
    expect(same.status).toBe(201);
  });

  it("never redirects a form back to another origin", async () => {
    const { app, businessA } = await world();
    const response = await app.request("/api/jobs", {
      method: "POST",
      cookie: businessA.cookie,
      form: {
        title: "Redirect check job",
        description: "A description long enough to pass validation.",
        skills: "TypeScript",
        budgetMinCents: "5000",
        budgetMaxCents: "9000",
        currency: "EUR",
        timeline: "2 weeks",
        redirectTo: "https://evil.example/steal",
      },
    });
    expect(response.status).toBe(303);
    const location = response.headers.get("location") ?? "";
    expect(location.startsWith("/")).toBe(true);
    expect(location).not.toContain("evil.example");
  });

  it("sets secure, HttpOnly, SameSite session cookies and no-store private pages", async () => {
    const app = newApp({ cookieSecure: true });
    const requested = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "cookie@authz.test", role: "coder" },
    });
    expect(requested.status).toBe(200);
    const code = app.codes.get("cookie@authz.test");
    const verified = await app.request("/api/auth/verify", {
      method: "POST",
      body: { email: "cookie@authz.test", code },
    });
    expect(verified.status).toBe(200);
    const cookie = (verified.headers.get("set-cookie") ?? "").toLowerCase();
    expect(cookie).toContain("httponly");
    expect(cookie).toContain("samesite=lax");
    expect(cookie).toContain("secure");
    expect(cookie).toContain("path=/");

    const session = cookieHeader(verified);
    const dashboard = await app.request("/dashboard", { cookie: session });
    expect(dashboard.headers.get("cache-control")).toBe("no-store");
    const csp = dashboard.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(dashboard.headers.get("x-frame-options")).toBe("DENY");
    expect(dashboard.headers.get("x-content-type-options")).toBe("nosniff");
    expect(dashboard.headers.get("referrer-policy")).toBe("same-origin");
    expect(dashboard.headers.get("strict-transport-security")).toContain("max-age=31536000");
  });

  it("protects admin routes with the token and returns no-store API errors", async () => {
    const { app } = await world();
    expect((await app.request("/api/admin/ledger")).status).toBe(401);
    expect((await app.request("/api/admin/ledger", { headers: ADMIN })).status).toBe(200);
    const denied = await app.request("/api/admin/ledger");
    expect(denied.headers.get("cache-control")).toBe("no-store");
  });

  it("does not expose other accounts' engagement details through the API", async () => {
    const { app, coderB, engagement } = await world();
    // There is no public engagement GET; the list is the only read path.
    const list = await app.json<{ engagements: { id: string }[] }>("/api/engagements", {
      cookie: coderB.cookie,
    });
    expect(list.body.engagements.map((item) => item.id)).not.toContain(engagement.id);
  });
});
