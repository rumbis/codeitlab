import { afterEach, describe, expect, it } from "vite-plus/test";

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

interface EngagementPayload {
  engagement: Engagement;
}

interface LedgerPayload {
  entries: unknown[];
}

async function setupDelivery(
  app: TestApp,
  options: { feeTier: "standard" | "assisted"; deliver: boolean },
) {
  const business: SignedIn = await app.signIn("owner@assisted.test", "business");
  const coder: SignedIn = await app.signIn("coder@assisted.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 20_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 20_000,
  });
  const created = await app.json<EngagementPayload>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: {
      jobId: job.id,
      coderId: profile.id,
      amountCents: 12_000,
      feeTier: options.feeTier,
    },
  });
  expect(created.response.status).toBe(201);
  const engagement = created.body.engagement;
  for (const action of ["accept", "start"] as const) {
    expect(
      (
        await app.request(`/api/engagements/${engagement.id}/${action}`, {
          method: "POST",
          cookie: coder.cookie,
        })
      ).status,
    ).toBe(200);
  }
  if (options.deliver) {
    const delivered = await app.request(`/api/engagements/${engagement.id}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: {
        deliveryNote: "Shipped the endpoint and the tests.",
        deliveryEvidence: "https://example.com/proof",
      },
    });
    expect(delivered.status).toBe(303);
  }
  return { business, coder, job, profile, engagement };
}

async function ledger(app: TestApp): Promise<LedgerPayload> {
  const response = await app.json<LedgerPayload>("/api/admin/ledger", { headers: ADMIN });
  return response.body;
}

describe("assisted delivery review", () => {
  it("queues only assisted deliveries and shows the evidence to the operator", async () => {
    const app = newApp();
    const assisted = await setupDelivery(app, { feeTier: "assisted", deliver: true });
    const standard = await setupDelivery(app, { feeTier: "standard", deliver: true });

    const page = await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("Assisted deliveries waiting for review");
    const section = html.slice(
      html.indexOf("Assisted deliveries waiting for review"),
      html.indexOf("Profiles waiting for review"),
    );
    expect(section).toContain(assisted.engagement.id.slice(0, 8));
    expect(section).not.toContain(standard.engagement.id.slice(0, 8));
    expect(section).toContain("https://example.com/proof");
    expect(section).toContain("20% tier");
    expect(section.match(/Record review/gu)).toHaveLength(1);
  });

  it("records the review without moving a cent", async () => {
    const app = newApp();
    const { business, engagement } = await setupDelivery(app, {
      feeTier: "assisted",
      deliver: true,
    });
    const before = await ledger(app);

    const short = await app.request(`/api/admin/assisted/${engagement.id}/review`, {
      method: "POST",
      headers: ADMIN,
      form: { note: "ok" },
    });
    expect(short.status).toBe(400);

    const reviewed = await app.request(`/api/admin/assisted/${engagement.id}/review`, {
      method: "POST",
      headers: ADMIN,
      form: {
        note: "Opened the deploy link; the endpoint matches the note.",
        redirectTo: "/admin",
      },
    });
    expect(reviewed.status).toBe(303);

    // Advisory only: status and ledger are untouched.
    const after = await ledger(app);
    expect(after.entries).toHaveLength(before.entries.length);
    const listed = await app.json<{ engagements: Engagement[] }>("/api/engagements", {
      cookie: business.cookie,
    });
    expect(listed.response.status).toBe(200);
    expect(listed.body.engagements.find((item) => item.id === engagement.id)?.status).toBe(
      "delivered",
    );

    const audit = await app.json<{ entries: { action: string; detail: string }[] }>(
      "/api/admin/audit",
      { headers: ADMIN },
    );
    expect(audit.body.entries[0]?.action).toBe("assisted.review");
    expect(audit.body.entries[0]?.detail).toContain("deploy link");
  });

  it("tells both sides that an operator read the evidence", async () => {
    const app = newApp();
    const { business, coder, engagement } = await setupDelivery(app, {
      feeTier: "assisted",
      deliver: true,
    });
    await app.request(`/api/admin/assisted/${engagement.id}/review`, {
      method: "POST",
      headers: ADMIN,
      form: { note: "Evidence checked against the note; looks complete." },
    });

    const businessInbox = await app.json<{ notifications: { kind: string; message: string }[] }>(
      "/api/notifications",
      { cookie: business.cookie },
    );
    expect(businessInbox.body.notifications[0]?.kind).toBe("review");
    expect(businessInbox.body.notifications[0]?.message).toContain("Evidence checked");

    const coderInbox = await app.json<{ notifications: { kind: string }[] }>("/api/notifications", {
      cookie: coder.cookie,
    });
    expect(coderInbox.body.notifications[0]?.kind).toBe("review");
  });

  it("refuses standard tiers and already-approved engagements", async () => {
    const app = newApp();
    const standard = await setupDelivery(app, { feeTier: "standard", deliver: true });
    const refused = await app.request(`/api/admin/assisted/${standard.engagement.id}/review`, {
      method: "POST",
      headers: ADMIN,
      form: { note: "Trying to review a standard engagement." },
    });
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("not_assisted");

    const assisted = await setupDelivery(app, { feeTier: "assisted", deliver: false });
    const notDelivered = await app.request(`/api/admin/assisted/${assisted.engagement.id}/review`, {
      method: "POST",
      headers: ADMIN,
      form: { note: "Not delivered yet, so nothing to review." },
    });
    expect(notDelivered.status).toBe(409);
  });

  it("requires the admin token", async () => {
    const app = newApp();
    const { engagement } = await setupDelivery(app, { feeTier: "assisted", deliver: true });
    const response = await app.request(`/api/admin/assisted/${engagement.id}/review`, {
      method: "POST",
      form: { note: "No token, no review." },
    });
    expect(response.status).toBe(401);
  });
});
