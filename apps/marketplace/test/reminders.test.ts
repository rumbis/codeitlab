import { afterEach, describe, expect, it } from "vite-plus/test";

import type { MailMessage } from "../src/server/mail.ts";
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
const DAY = 24 * 60 * 60 * 1000;

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

async function deliveredEngagement(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@remind.test", "business");
  const coder: SignedIn = await app.signIn("coder@remind.test", "coder");
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
    budgetMaxCents: 20_000,
  });
  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 12_000 },
  });
  expect(created.response.status).toBe(201);
  const id = created.body.engagement.id;
  for (const action of ["accept", "start"]) {
    expect(
      (
        await app.request(`/api/engagements/${id}/${action}`, {
          method: "POST",
          cookie: coder.cookie,
        })
      ).status,
    ).toBe(200);
  }
  const delivered = await app.json<{ engagement: { status: string } }>(
    `/api/engagements/${id}/deliver`,
    {
      method: "POST",
      cookie: coder.cookie,
      body: {
        deliveryNote: "Shipped, see the deploy link.",
        deliveryEvidence: ["https://example.test/pr/1"],
      },
    },
  );
  expect(delivered.body.engagement.status).toBe("delivered");
  return { business, coder, engagementId: id };
}

async function runReminders(app: TestApp) {
  return app.json<{ reminded: number }>("/api/admin/reminders/run", {
    method: "POST",
    headers: ADMIN,
  });
}

describe("waiting-delivery reminders", () => {
  it("leaves a fresh delivery alone", async () => {
    const { app } = newApp();
    await deliveredEngagement(app);
    expect((await runReminders(app)).body.reminded).toBe(0);
  });

  it("reminds the business after three days, once per 48h, never twice in a row", async () => {
    const { app } = newApp();
    await deliveredEngagement(app);
    app.advance(4 * DAY);
    expect((await runReminders(app)).body.reminded).toBe(1);
    expect((await runReminders(app)).body.reminded).toBe(0);

    app.advance(1 * DAY);
    expect((await runReminders(app)).body.reminded).toBe(0);
    app.advance(1 * DAY);
    expect((await runReminders(app)).body.reminded).toBe(1);
  });

  it("stops once the business approves", async () => {
    const { app } = newApp();
    const { business, engagementId } = await deliveredEngagement(app);
    app.advance(4 * DAY);
    const approve = await app.request(`/api/engagements/${engagementId}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(approve.status).toBe(200);
    expect((await runReminders(app)).body.reminded).toBe(0);
  });

  it("sends the reminder through the opt-in email channel too", async () => {
    const { app, sent } = newApp();
    const { business } = await deliveredEngagement(app);
    await app.request("/api/notifications/preferences", {
      method: "POST",
      cookie: business.cookie,
      body: { emailNotifications: "on" },
    });
    app.advance(4 * DAY);
    expect((await runReminders(app)).body.reminded).toBe(1);
    await app.request("/api/admin/mail/drain", { method: "POST", headers: ADMIN });
    const reminder = sent.filter(
      (mail) => mail.subject === "CodeItLab — a delivery is waiting for review",
    );
    expect(reminder).toHaveLength(1);
    expect(reminder[0]?.to).toBe("owner@remind.test");
    expect(reminder[0]?.text).toContain("over 3 days");
  });

  it("shows the count on the admin page and requires the token", async () => {
    const { app } = newApp();
    await deliveredEngagement(app);
    app.advance(4 * DAY);
    const page = await (await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`)).text();
    expect(page).toContain("Deliveries waiting on a business");
    expect(page).toContain("1 delivery past the 3-day mark");
    expect(page).toContain("Send waiting-delivery reminders");
    expect((await app.request("/api/admin/reminders/run", { method: "POST" })).status).toBe(401);
  });
});
