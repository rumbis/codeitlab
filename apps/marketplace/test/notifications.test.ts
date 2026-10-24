import { describe, expect, it } from "vite-plus/test";

import type { Engagement } from "../src/shared/contracts.ts";
import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

interface NotificationsPayload {
  notifications: {
    kind: string;
    message: string;
    engagementId: string;
    read: boolean;
  }[];
  unread: number;
}

interface EngagementPayload {
  engagement: Engagement;
}

async function setupEngagement(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@notify.test", "business");
  const coder: SignedIn = await app.signIn("coder@notify.test", "coder");
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
  await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this." },
  });
  const created = await app.json<EngagementPayload>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 12_000 },
  });
  expect(created.response.status).toBe(201);
  return { business, coder, profile, job, engagementId: created.body.engagement.id };
}

async function inbox(app: TestApp, cookie: string): Promise<NotificationsPayload> {
  const response = await app.json<NotificationsPayload>("/api/notifications", { cookie });
  expect(response.response.status).toBe(200);
  return response.body;
}

describe("activity feed", () => {
  it("tells the business about an application and the coder about funded escrow", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business, coder } = await setupEngagement(app);

    const businessInbox = await inbox(app, business.cookie);
    expect(businessInbox.unread).toBe(1);
    expect(businessInbox.notifications[0]?.kind).toBe("application");
    expect(businessInbox.notifications[0]?.message).toContain("applied");

    const coderInbox = await inbox(app, coder.cookie);
    expect(coderInbox.unread).toBe(1);
    expect(coderInbox.notifications[0]?.kind).toBe("engagement");
    expect(coderInbox.notifications[0]?.message).toContain("Escrow funded");
  });

  it("follows the turn: delivery notifies the business, approval notifies the coder", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business, coder, engagementId } = await setupEngagement(app);

    for (const action of ["accept", "start"] as const) {
      expect(
        (
          await app.request(`/api/engagements/${engagementId}/${action}`, {
            method: "POST",
            cookie: coder.cookie,
          })
        ).status,
      ).toBe(200);
    }
    expect(
      (
        await app.request(`/api/engagements/${engagementId}/deliver`, {
          method: "POST",
          cookie: coder.cookie,
          form: { deliveryNote: "Done.", deliveryEvidence: "https://example.com/proof" },
        })
      ).status,
    ).toBe(303);

    const afterDelivery = await inbox(app, business.cookie);
    expect(afterDelivery.notifications[0]?.kind).toBe("delivery");
    expect(afterDelivery.notifications[0]?.message).toContain("Delivery ready to review");
    expect(afterDelivery.unread).toBe(2); // application + delivery

    expect(
      (
        await app.request(`/api/engagements/${engagementId}/approve`, {
          method: "POST",
          cookie: business.cookie,
        })
      ).status,
    ).toBe(200);

    const afterApproval = await inbox(app, coder.cookie);
    expect(afterApproval.notifications[0]?.kind).toBe("approved");
    expect(afterApproval.notifications[0]?.message).toContain("Approved");
    expect(afterApproval.notifications[0]?.message).toContain("€102.00");
  });

  it("notifies both parties when an operator resolves a dispute", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business, coder, engagementId } = await setupEngagement(app);
    for (const action of ["accept", "start"] as const) {
      await app.request(`/api/engagements/${engagementId}/${action}`, {
        method: "POST",
        cookie: coder.cookie,
      });
    }
    await app.request(`/api/engagements/${engagementId}/dispute`, {
      method: "POST",
      cookie: business.cookie,
    });
    await app.request(`/api/admin/disputes/${engagementId}/resolve`, {
      method: "POST",
      form: { outcome: "refunded", note: "Scope mismatch; refunding the business." },
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });

    const businessInbox = await inbox(app, business.cookie);
    expect(businessInbox.notifications[0]?.kind).toBe("resolved");
    expect(businessInbox.notifications[0]?.message).toContain("refunded");
    expect(businessInbox.notifications[0]?.message).toContain("Scope mismatch");

    const coderInbox = await inbox(app, coder.cookie);
    expect(coderInbox.notifications[0]?.kind).toBe("resolved");
    expect(coderInbox.notifications[0]?.message).toContain("Scope mismatch");
  });

  it("marks everything read and renders the feed on the dashboard", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business } = await setupEngagement(app);

    const before = await inbox(app, business.cookie);
    expect(before.unread).toBeGreaterThan(0);

    const page = await app.request("/dashboard", { cookie: business.cookie });
    const html = await page.text();
    expect(html).toContain("Activity");
    expect(html).toContain("Mark all read");
    expect(html).toContain("applied");

    const marked = await app.request("/api/notifications/read", {
      method: "POST",
      cookie: business.cookie,
      form: { redirectTo: "/dashboard" },
    });
    expect(marked.status).toBe(303);
    expect((await inbox(app, business.cookie)).unread).toBe(0);

    const anonymous = await app.request("/api/notifications");
    expect(anonymous.status).toBe(401);
  });

  it("notifies the other party when an engagement is cancelled", async () => {
    const app = createTestApp({ autoApprove: true });
    const { business, coder, engagementId } = await setupEngagement(app);

    await app.request(`/api/engagements/${engagementId}/cancel`, {
      method: "POST",
      cookie: business.cookie,
    });
    const coderInbox = await inbox(app, coder.cookie);
    expect(coderInbox.notifications[0]?.kind).toBe("cancelled");
    expect(coderInbox.notifications[0]?.message).toContain("cancelled");
  });
});
