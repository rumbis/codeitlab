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

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp({ autoApprove: true, ...overrides });
  apps.push(app);
  return app;
}

async function setup(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@invites.test", "business");
  const coder: SignedIn = await app.signIn("coder@invites.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
  return { business, coder, profile, job };
}

async function invite(app: TestApp, cookie: string, jobId: string, body: Record<string, unknown>) {
  return app.request(`/api/jobs/${jobId}/invite`, { method: "POST", cookie, body });
}

describe("job invitations", () => {
  it("notifies the coder and shows the invitation on the dashboard", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await setup(app);

    const sent = await invite(app, business.cookie, job.id, {
      coderId: profile.id,
      message: "Your profile fits this one.",
    });
    expect(sent.status).toBe(200);
    const payload = (await sent.json()) as { invite: { id: string; message: string } };
    expect(payload.invite.message).toBe("Your profile fits this one.");

    const notifications = await app.json<{
      notifications: { kind: string; message: string; href: string }[];
    }>("/api/notifications", { cookie: coder.cookie });
    const notification = notifications.body.notifications.find((item) => item.kind === "invite");
    expect(notification?.message).toContain(job.title);
    expect(notification?.href).toBe(`/jobs/${job.id}`);

    const dashboard = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(dashboard).toContain("Invitations");
    expect(dashboard).toContain(job.title);
    expect(dashboard).toContain("Your profile fits this one.");
    expect(dashboard).toContain("View job and apply");

    // The coder page explains that an invite is not an application.
    const jobPage = await (await app.request(`/jobs/${job.id}`, { cookie: coder.cookie })).text();
    expect(jobPage).toContain("You were invited to apply");
    expect(jobPage).toContain("Invitations are not applications");
  });

  it("does not create an application on the coder's behalf", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await setup(app);
    await invite(app, business.cookie, job.id, { coderId: profile.id });

    const jobPage = await (await app.request(`/jobs/${job.id}`, { cookie: coder.cookie })).text();
    expect(jobPage).toContain("Apply for this job");

    const applied = await app.request(`/api/jobs/${job.id}/interests`, {
      method: "POST",
      cookie: coder.cookie,
      body: { message: "I would like to work on this." },
    });
    expect(applied.status).toBe(201);

    const ownerPage = await (
      await app.request(`/jobs/${job.id}`, { cookie: business.cookie })
    ).text();
    expect(ownerPage).toContain("I would like to work on this.");
  });

  it("shows the invited state on the job page instead of the invite button", async () => {
    const app = newApp();
    const { business, profile, job } = await setup(app);
    await invite(app, business.cookie, job.id, { coderId: profile.id });
    const page = await (await app.request(`/jobs/${job.id}`, { cookie: business.cookie })).text();
    expect(page).toContain("Invited ✓");
    expect(page).toContain("They can apply from their dashboard.");
  });

  it("refuses duplicates, wrong owners, coders, unapproved profiles and closed jobs", async () => {
    const app = newApp();
    const { business, coder, profile, job } = await setup(app);

    expect((await invite(app, business.cookie, job.id, { coderId: profile.id })).status).toBe(200);
    const duplicate = await invite(app, business.cookie, job.id, { coderId: profile.id });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as { error: string }).error).toBe("already_invited");

    const other = await app.signIn("other@invites.test", "business");
    expect((await invite(app, other.cookie, job.id, { coderId: profile.id })).status).toBe(403);
    expect((await invite(app, coder.cookie, job.id, { coderId: profile.id })).status).toBe(403);
  });

  it("refuses to invite a profile that is not approved yet", async () => {
    const app = newApp({ autoApprove: false });
    const business = await app.signIn("owner@pending.test", "business");
    const coder = await app.signIn("coder@pending.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Pending",
      skills: "TypeScript",
    });
    const job = await createJob(app, business.cookie, { skills: "TypeScript" });
    const refused = await invite(app, business.cookie, job.id, { coderId: profile.id });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe("coder_not_available");
  });

  it("validates the message length and requires a coder id", async () => {
    const app = newApp();
    const { business, profile, job } = await setup(app);
    expect(
      (
        await invite(app, business.cookie, job.id, {
          coderId: profile.id,
          message: "x".repeat(301),
        })
      ).status,
    ).toBe(400);
    expect((await invite(app, business.cookie, job.id, {})).status).toBe(400);
  });
});
