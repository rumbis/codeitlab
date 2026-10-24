import { afterEach, describe, expect, it } from "vite-plus/test";

import type { MailMessage } from "../src/server/mail.ts";
import { EMAIL_NOTIFICATION_KINDS } from "../src/server/notifications.ts";
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

function newApp() {
  const sent: MailMessage[] = [];
  const app = createTestApp({
    autoApprove: true,
    mailTransport: {
      name: "capture",
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
  });
  apps.push(app);
  return { app, sent };
}

async function setup(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@email.test", "business");
  const coder: SignedIn = await app.signIn("coder@email.test", "coder");
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

async function invite(app: TestApp, business: SignedIn, jobId: string, coderId: string) {
  const response = await app.request(`/api/jobs/${jobId}/invite`, {
    method: "POST",
    cookie: business.cookie,
    body: { coderId, message: "This looks like your kind of work." },
  });
  expect(response.status).toBe(200);
}

async function setEmail(app: TestApp, cookie: string, enabled: boolean) {
  const response = await app.request("/api/notifications/preferences", {
    method: "POST",
    cookie,
    body: enabled ? { emailNotifications: "on" } : {},
  });
  expect(response.status).toBe(200);
}

describe("opt-in email notifications", () => {
  it("sends nothing until the account opts in", async () => {
    const { app, sent } = newApp();
    const { business, profile, job } = await setup(app);
    await invite(app, business, job.id, profile.id);
    const queued = await app.json<{ pending: number }>("/api/admin/mail", { headers: ADMIN });
    expect(queued.body.pending).toBe(0);
    const drained = await app.json<{ delivered: number }>("/api/admin/mail/drain", {
      method: "POST",
      headers: ADMIN,
    });
    expect(drained.body.delivered).toBe(0);
    expect(sent.filter((message) => message.subject.startsWith("CodeitLab —"))).toHaveLength(0);
  });

  it("emails an actionable notification with an absolute link once enabled", async () => {
    const { app, sent } = newApp();
    const { business, coder, profile, job } = await setup(app);
    await setEmail(app, coder.cookie, true);
    await invite(app, business, job.id, profile.id);

    const queued = await app.json<{ pending: number }>("/api/admin/mail", { headers: ADMIN });
    expect(queued.body.pending).toBe(1);
    const drained = await app.json<{ delivered: number }>("/api/admin/mail/drain", {
      method: "POST",
      headers: ADMIN,
    });
    expect(drained.body.delivered).toBe(1);
    const notificationMails = sent.filter((message) => message.subject.startsWith("CodeitLab —"));
    expect(notificationMails).toHaveLength(1);
    const mail = notificationMails[0];
    expect(mail?.to).toBe("coder@email.test");
    expect(mail?.subject).toBe("CodeitLab — you are invited to apply");
    expect(mail?.text).toContain("invited you to apply");
    expect(mail?.text).toContain("https://codeitlab.com/market/jobs/");
    expect(mail?.text).toContain("Sign in and turn them off any time at");
    expect(mail?.text).toContain("/dashboard#notifications");
  });

  it("stops emailing after the account opts out", async () => {
    const { app, sent } = newApp();
    const { business, coder, profile, job } = await setup(app);
    await setEmail(app, coder.cookie, true);
    await setEmail(app, coder.cookie, false);
    await invite(app, business, job.id, profile.id);
    await app.request("/api/admin/mail/drain", { method: "POST", headers: ADMIN });
    expect(sent.filter((message) => message.subject.startsWith("CodeitLab —"))).toHaveLength(0);
    expect(
      (await app.json<{ pending: number }>("/api/admin/mail", { headers: ADMIN })).body.pending,
    ).toBe(0);
  });

  it("only emails events that need the recipient to act", () => {
    for (const kind of [
      "application",
      "engagement",
      "invite",
      "delivery",
      "approved",
      "resolved",
      "disputed",
    ] as const) {
      expect(EMAIL_NOTIFICATION_KINDS.has(kind), kind).toBe(true);
    }
    for (const kind of ["scope", "shortlist", "review", "cancelled"] as const) {
      expect(EMAIL_NOTIFICATION_KINDS.has(kind), kind).toBe(false);
    }
  });

  it("emails the other side when a dispute freezes the escrow", async () => {
    const { app, sent } = newApp();
    const { business, coder, profile, job } = await setup(app);
    const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    expect(created.response.status).toBe(201);
    const engagementId = created.body.engagement.id;
    for (const action of ["accept", "start"] as const) {
      await app.request(`/api/engagements/${engagementId}/${action}`, {
        method: "POST",
        cookie: coder.cookie,
      });
    }
    await setEmail(app, coder.cookie, true);
    sent.length = 0;

    const disputed = await app.request(`/api/engagements/${engagementId}/dispute`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(disputed.status).toBe(200);
    await app.request("/api/admin/mail/drain", { method: "POST", headers: ADMIN });
    const mail = sent.find((message) => message.subject.startsWith("CodeitLab —"));
    expect(mail?.to).toBe("coder@email.test");
    expect(mail?.text.toLowerCase()).toContain("dispute");
    expect(mail?.text).toContain("escrow");
  });

  it("shows the setting on the dashboard and requires a login", async () => {
    const { app } = newApp();
    const { coder } = await setup(app);
    const before = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(before).toContain("Also email me about invitations, deliveries, approvals and disputes");
    expect(before).toContain('name="emailNotifications"');
    expect(before).not.toContain('name="emailNotifications" value="on" checked');

    await setEmail(app, coder.cookie, true);
    const after = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(after).toContain('name="emailNotifications" value="on" checked');

    expect((await app.request("/api/notifications/preferences", { method: "POST" })).status).toBe(
      401,
    );
  });
});
