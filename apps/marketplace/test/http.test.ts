import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  cookieHeader,
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
  const app = createTestApp(overrides);
  apps.push(app);
  return app;
}

describe("server-rendered pages", () => {
  it("serves every page and the stylesheet without JavaScript", async () => {
    const app = newApp();
    for (const path of ["/", "/coders", "/jobs", "/join", "/login", "/dashboard"]) {
      const response = await app.request(path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
    }

    const home = await app.request("/");
    const homeHtml = await home.text();
    expect(homeHtml).toContain("CodeitLab");
    expect(homeHtml).toContain('href="/jobs"');
    // Pages stay usable without JavaScript: the only script is the deferred
    // service-worker registration, and there is no inline script at all.
    expect(homeHtml).not.toMatch(/<script(?![^>]*\bsrc=)/u);
    expect(homeHtml.match(/<script/gu)).toHaveLength(1);
    expect(homeHtml).toContain('src="/app.js"');

    const styles = await app.request("/styles.css");
    expect(styles.status).toBe(200);
    expect(styles.headers.get("content-type")).toContain("text/css");
    expect(await styles.text()).toContain("--accent");
  });

  it("exposes health, JSON 404s, method errors and auth failures as JSON", async () => {
    const app = newApp();
    const health = await app.json<{ ok: boolean; service: string }>("/health");
    expect(health.response.status).toBe(200);
    expect(health.body).toEqual({
      ok: true,
      service: "marketplace",
      time: expect.any(String),
      schemaVersion: 23,
    });

    const apiHealth = await app.json<{ ok: boolean }>("/api/health");
    expect(apiHealth.response.status).toBe(200);

    const missingPage = await app.request("/nope");
    expect(missingPage.status).toBe(404);
    expect(missingPage.headers.get("content-type")).toContain("text/html");
    expect(await missingPage.text()).toContain("Not found");

    const missingApi = await app.json<{ error: string; message: string }>("/api/nope");
    expect(missingApi.response.status).toBe(404);
    expect(missingApi.body.error).toBe("not_found");

    const wrongMethod = await app.json<{ error: string }>("/api/jobs", { method: "DELETE" });
    expect(wrongMethod.response.status).toBe(405);
    expect(wrongMethod.body.error).toBe("method_not_allowed");

    const unauthenticated = await app.json<{ error: string }>("/api/engagements");
    expect(unauthenticated.response.status).toBe(401);
    expect(unauthenticated.body.error).toBe("unauthorized");
  });

  it("escapes user text on job and coder pages", async () => {
    const app = newApp({ autoApprove: true });
    const business = await app.signIn("owner@studio.test", "business");
    const job = await createJob(app, business.cookie, {
      title: '<script>alert("title")</script>',
      description: '<img src=x onerror="alert(1)"> Build the booking flow with care.',
      skills: "React, <b>SQL</b>",
    });

    const jobPage = await app.request(`/jobs/${job.id}`);
    const html = await jobPage.text();
    expect(jobPage.status).toBe(200);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain('<script>alert("title")');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");

    const jobsList = await (await app.request("/jobs")).text();
    expect(jobsList).toContain("&lt;script&gt;");
    expect(jobsList).not.toContain('<script>alert("title")');

    const coder = await app.signIn("coder@freelance.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "<b>Ada</b>",
      headline: '<i>engineer</i> "quoted"',
      skills: "React",
    });
    await approveCoder(app, profile.id);

    const codersPage = await (await app.request("/coders")).text();
    expect(codersPage).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(codersPage).not.toContain("<b>Ada</b>");
  });

  it("runs the sign-up and profile flow with plain form posts and redirects", async () => {
    const app = newApp();

    const requestForm = await app.request("/api/auth/request-code", {
      method: "POST",
      form: { email: "form@coders.test", role: "coder" },
    });
    expect(requestForm.status).toBe(303);
    expect(requestForm.headers.get("location")).toContain("/login?email=form%40coders.test");

    const code = app.codes.get("form@coders.test");
    expect(code).toMatch(/^\d{6}$/u);

    const verifyForm = await app.request("/api/auth/verify", {
      method: "POST",
      form: { email: "form@coders.test", code: code ?? "" },
    });
    expect(verifyForm.status).toBe(303);
    expect(
      new URL(verifyForm.headers.get("location") ?? "", "http://marketplace.test").pathname,
    ).toBe("/dashboard");
    const cookie = cookieHeader(verifyForm);
    expect(cookie).toContain("market_session=");

    const profileForm = await app.request("/api/coders/profile", {
      method: "POST",
      cookie,
      form: {
        displayName: "Form Coder",
        headline: "Ships forms",
        bio: "I build server-rendered products with forms that work before JavaScript loads.",
        skills: "Node.js, SQLite",
        availability: "full_time",
        rateMinCents: "5000",
        rateMaxCents: "9000",
        currency: "EUR",
        timezone: "Europe/Berlin",
        links: "Site=https://example.com",
      },
    });
    expect(profileForm.status).toBe(303);
    expect(
      new URL(profileForm.headers.get("location") ?? "", "http://marketplace.test").pathname,
    ).toBe("/dashboard");

    const dashboard = await app.request("/dashboard", { cookie });
    const dashboardHtml = await dashboard.text();
    expect(dashboard.status).toBe(200);
    expect(dashboardHtml).toContain("Form Coder");
    expect(dashboardHtml).toContain("Pending review");
    expect(dashboardHtml).toContain('action="/api/coders/profile"');
  });

  it("shows the owner the ranked coders, scores and reasons on the job page", async () => {
    const app = newApp({ autoApprove: true });
    const business = await app.signIn("owner@studio.test", "business");
    const coder = await app.signIn("coder@freelance.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "Node.js, SQLite",
      rateMinCents: 5000,
      rateMaxCents: 9000,
    });
    await approveCoder(app, profile.id);
    const job = await createJob(app, business.cookie, { skills: "Node.js, SQLite" });

    const page = await app.request(`/jobs/${job.id}`, { cookie: business.cookie });
    const html = await page.text();
    expect(page.status).toBe(200);
    expect(html).toContain("Ranked coders");
    expect(html).toContain("Ada");
    expect(html).toContain("/100");
    expect(html).toContain("skills");
    expect(html).toContain('action="/api/engagements"');
  });
});

describe("admin surface", () => {
  it("guards the admin page and ledger API with the token", async () => {
    const app = newApp();

    const noToken = await app.request("/admin");
    expect(noToken.status).toBe(401);
    expect(await noToken.text()).toContain("Admin token");

    const wrongToken = await app.request("/admin?token=nope");
    expect(wrongToken.status).toBe(401);

    const page = await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Charged into escrow");
    expect(html).toContain("Ledger");

    const apiWithoutToken = await app.json<{ error: string }>("/api/admin/ledger");
    expect(apiWithoutToken.response.status).toBe(401);

    const apiWithBearer = await app.request("/api/admin/ledger", {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    expect(apiWithBearer.status).toBe(200);

    const apiWithQuery = await app.request(`/api/admin/ledger?token=${TEST_ADMIN_TOKEN}`);
    expect(apiWithQuery.status).toBe(200);
  });

  it("is disabled when no admin token is configured", async () => {
    const app = newApp({ adminToken: "" });
    const page = await app.request("/admin");
    expect(page.status).toBe(404);
    const api = await app.json<{ error: string }>("/api/admin/ledger");
    expect(api.response.status).toBe(404);
    expect(api.body.error).toBe("admin_disabled");
  });

  it("lets an admin approve a pending coder profile", async () => {
    const app = newApp();
    const coder = await app.signIn("pending@freelance.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Pending Pat",
      skills: "Rust",
    });
    expect(profile.approved).toBe(false);

    const gate = await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`);
    const gateHtml = await gate.text();
    expect(gateHtml).toContain("Pending Pat");
    expect(gateHtml).toContain(`/api/admin/coders/${profile.id}/approve`);

    const approved = await app.json<{ coder: { approved: boolean } }>(
      `/api/admin/coders/${profile.id}/approve`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
        body: {},
      },
    );
    expect(approved.response.status).toBe(200);
    expect(approved.body.coder.approved).toBe(true);

    const listed = await app.json<{ coders: Array<{ displayName: string }> }>("/api/coders");
    expect(listed.body.coders.map((entry) => entry.displayName)).toContain("Pending Pat");
  });
});
