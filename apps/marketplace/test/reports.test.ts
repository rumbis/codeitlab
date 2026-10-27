import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Report } from "../src/server/reports.ts";
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

async function world(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@reports.test", "business");
  const coder: SignedIn = await app.signIn("coder@reports.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Reported Coder",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    title: "Reported Job",
    skills: "TypeScript",
  });
  return { business, coder, profile, job };
}

async function report(
  app: TestApp,
  cookie: string,
  targetKind: "job" | "coder",
  targetId: string,
  reason = "scam",
  detail = "",
): Promise<{ response: Response; body: { report?: Report; error?: string } }> {
  return app.json("/api/reports", {
    method: "POST",
    cookie,
    body: { targetKind, targetId, reason, detail },
  });
}

describe("abuse reports", () => {
  it("lets a signed-in coder report someone else's job", async () => {
    const app = newApp();
    const { coder, job } = await world(app);
    const created = await report(
      app,
      coder.cookie,
      "job",
      job.id,
      "scam",
      "Asked to pay outside escrow.",
    );
    expect(created.response.status).toBe(201);
    expect(created.body.report?.targetKind).toBe("job");
    expect(created.body.report?.targetLabel).toBe("Reported Job");
    expect(created.body.report?.status).toBe("open");

    const duplicate = await report(app, coder.cookie, "job", job.id);
    expect(duplicate.response.status).toBe(409);
    expect(duplicate.body.error).toBe("already_reported");
  });

  it("refuses self-reports, bad targets, bad reasons and anonymous callers", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await world(app);
    expect((await report(app, business.cookie, "job", job.id)).body.error).toBe("self_report");
    expect((await report(app, coder.cookie, "coder", profile.id)).body.error).toBe("self_report");
    expect((await report(app, coder.cookie, "job", "job_missing")).response.status).toBe(404);
    expect((await report(app, coder.cookie, "job", job.id, "not_a_reason")).body.error).toBe(
      "invalid_reason",
    );
    expect((await report(app, "", "job", job.id)).response.status).toBe(401);
    const long = await report(app, coder.cookie, "job", job.id, "other", "x".repeat(1001));
    expect(long.response.status).toBe(400);
    expect(long.body.error).toBe("invalid_detail");
  });

  it("rate-limits reports per account", async () => {
    const app = newApp({ rateLimits: { reportPerHour: 2 } });
    const { business, coder, job } = await world(app);
    const second = await createJob(app, business.cookie, {
      title: "Second job",
      skills: "TypeScript",
    });
    const third = await createJob(app, business.cookie, {
      title: "Third job",
      skills: "TypeScript",
    });
    expect((await report(app, coder.cookie, "job", job.id)).response.status).toBe(201);
    expect((await report(app, coder.cookie, "job", second.id)).response.status).toBe(201);
    const limited = await report(app, coder.cookie, "job", third.id);
    expect(limited.response.status).toBe(429);
    expect(limited.body.error).toBe("rate_limited");
  });

  it("links to the report form from the job and profile pages", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await world(app);
    const jobPage = await (await app.request(`/jobs/${job.id}`, { cookie: coder.cookie })).text();
    expect(jobPage).toContain(`href="/report?kind=job&amp;id=${job.id}"`);
    const ownerJobPage = await (
      await app.request(`/jobs/${job.id}`, { cookie: business.cookie })
    ).text();
    expect(ownerJobPage).not.toContain("/report?kind=job");

    const profilePage = await (
      await app.request(`/coders/${profile.id}`, { cookie: business.cookie })
    ).text();
    expect(profilePage).toContain(`href="/report?kind=coder&amp;id=${profile.id}"`);
    const ownerProfilePage = await (
      await app.request(`/coders/${profile.id}`, { cookie: coder.cookie })
    ).text();
    expect(ownerProfilePage).not.toContain("/report?kind=coder");
  });

  it("renders the form with the target and the promise about what happens next", async () => {
    const app = newApp();
    const { coder, job } = await world(app);
    const form = await (
      await app.request(`/report?kind=job&id=${job.id}`, { cookie: coder.cookie })
    ).text();
    expect(form).toContain("Reported Job");
    expect(form).toContain('name="reason"');
    expect(form).toContain("not told who reported them");
    expect(form).toContain("A person reads it, not a model.");

    const anonymous = await (await app.request(`/report?kind=job&id=${job.id}`)).text();
    expect(anonymous).toContain("Log in");
    expect(anonymous).not.toContain('name="reason"');
  });

  it("shows the queue to admins only", async () => {
    const app = newApp();
    const { coder, job } = await world(app);
    await report(app, coder.cookie, "job", job.id, "stolen_work", "Copied from a public repo.");
    expect((await app.request("/api/admin/reports")).status).toBe(401);
    const listed = await app.json<{ reports: Report[]; open: number }>("/api/admin/reports", {
      headers: ADMIN,
    });
    expect(listed.body.open).toBe(1);
    expect(listed.body.reports[0]?.reporterEmail).toBe("coder@reports.test");
    expect(listed.body.reports[0]?.reasonLabel).toBe("Stolen work or fake evidence");

    const adminPage = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(adminPage).toContain("Abuse reports");
    expect(adminPage).toContain("Copied from a public repo.");
    expect(adminPage).toContain("Remove job");
  });

  it("dismisses a report and tells the reporter", async () => {
    const app = newApp();
    const { coder, job } = await world(app);
    const created = await report(app, coder.cookie, "job", job.id);
    const resolved = await app.json<{ report: Report }>(
      `/api/admin/reports/${created.body.report?.id}/resolve`,
      { method: "POST", headers: ADMIN, body: { resolution: "dismissed" } },
    );
    expect(resolved.response.status).toBe(200);
    expect(resolved.body.report.status).toBe("resolved");
    expect(resolved.body.report.resolution).toBe("dismissed");
    expect((await app.request(`/jobs/${job.id}`)).status).toBe(200);

    const feed = await app.json<{ notifications: { message: string }[] }>("/api/notifications", {
      cookie: coder.cookie,
    });
    expect(feed.body.notifications[0]?.message).toContain("no rule was broken");

    const again = await app.request(`/api/admin/reports/${created.body.report?.id}/resolve`, {
      method: "POST",
      headers: ADMIN,
      body: { resolution: "dismissed" },
    });
    expect(again.status).toBe(409);
  });

  it("removes a reported job from the list and unapproves a reported coder", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await world(app);

    const jobReport = await report(app, coder.cookie, "job", job.id);
    await app.request(`/api/admin/reports/${jobReport.body.report?.id}/resolve`, {
      method: "POST",
      headers: ADMIN,
      body: { resolution: "job_removed" },
    });
    expect((await app.request(`/jobs/${job.id}`)).status).toBe(200);
    expect(await (await app.request("/jobs")).text()).not.toContain("Reported Job");

    const coderReport = await report(app, business.cookie, "coder", profile.id, "harassment");
    const resolved = await app.json<{ report: Report }>(
      `/api/admin/reports/${coderReport.body.report?.id}/resolve`,
      { method: "POST", headers: ADMIN, body: { resolution: "coder_unapproved" } },
    );
    expect(resolved.body.report.resolution).toBe("coder_unapproved");
    expect((await app.request(`/coders/${profile.id}`)).status).toBe(404);
    expect(await (await app.request("/coders")).text()).not.toContain("Reported Coder");
  });

  it("rejects a resolution that does not fit the target kind", async () => {
    const app = newApp();
    const { coder, job } = await world(app);
    const created = await report(app, coder.cookie, "job", job.id);
    const wrong = await app.request(`/api/admin/reports/${created.body.report?.id}/resolve`, {
      method: "POST",
      headers: ADMIN,
      body: { resolution: "coder_unapproved" },
    });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe("invalid_resolution");
  });
});
