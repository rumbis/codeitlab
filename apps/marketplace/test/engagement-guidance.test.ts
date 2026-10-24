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
  const business: SignedIn = await app.signIn("owner@guide.test", "business");
  const coder: SignedIn = await app.signIn("coder@guide.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, { title: "Guide me", skills: "TypeScript" });
  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
  });
  return { business, coder, engagementId: created.body.engagement.id };
}

async function dashboard(app: TestApp, cookie: string): Promise<string> {
  return (await app.request("/dashboard", { cookie })).text();
}

describe("engagement guidance", () => {
  it("names who acts next as the state changes", async () => {
    const app = newApp();
    const { coder, business, engagementId } = await setup(app);
    expect(await dashboard(app, coder.cookie)).toContain("Waiting for the coder to accept.");

    await app.request(`/api/engagements/${engagementId}/accept`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(await dashboard(app, coder.cookie)).toContain("Waiting for the coder to start.");

    await app.request(`/api/engagements/${engagementId}/start`, {
      method: "POST",
      cookie: coder.cookie,
    });
    expect(await dashboard(app, coder.cookie)).toContain(
      "Waiting for the coder to mark the work delivered.",
    );

    await app.request(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: { deliveryNote: "Shipped.", deliveryEvidence: "https://ada.example/proof" },
    });
    expect(await dashboard(app, business.cookie)).toContain(
      "Waiting for the business to check the evidence and approve or dispute.",
    );

    await app.request(`/api/engagements/${engagementId}/approve`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect(await dashboard(app, coder.cookie)).toContain(
      "Done: the fee and payout are in the ledger and cannot change.",
    );
  });

  it("shows the auto-release date only while a delivery is waiting", async () => {
    const app = newApp();
    const { coder, engagementId } = await setup(app);
    for (const action of ["accept", "start"] as const) {
      await app.request(`/api/engagements/${engagementId}/${action}`, {
        method: "POST",
        cookie: coder.cookie,
      });
    }
    await app.request(`/api/engagements/${engagementId}/deliver`, {
      method: "POST",
      cookie: coder.cookie,
      form: { deliveryNote: "Shipped.", deliveryEvidence: "https://ada.example/proof" },
    });
    const page = await dashboard(app, coder.cookie);
    expect(page).toContain("If the business does not approve or dispute by");
    expect(page).toContain("releases to the coder automatically");
    expect(page).toMatch(/approve or dispute by <strong>\d{4}-\d{2}-\d{2}<\/strong>/u);

    const disabled = newApp({ autoReleaseDays: 0 });
    const second = await setup(disabled);
    for (const action of ["accept", "start"] as const) {
      await disabled.request(`/api/engagements/${second.engagementId}/${action}`, {
        method: "POST",
        cookie: second.coder.cookie,
      });
    }
    await disabled.request(`/api/engagements/${second.engagementId}/deliver`, {
      method: "POST",
      cookie: second.coder.cookie,
      form: { deliveryNote: "Shipped.", deliveryEvidence: "https://ada.example/proof" },
    });
    const noAuto = await dashboard(disabled, second.coder.cookie);
    expect(noAuto).not.toContain("releases to the coder automatically");
    expect(noAuto).toContain("Waiting for the business to check the evidence");
  });
});
