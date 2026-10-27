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

function newApp(): TestApp {
  const app = createTestApp({ autoApprove: true });
  apps.push(app);
  return app;
}

interface Setup {
  readonly app: TestApp;
  readonly business: SignedIn;
  readonly coder: SignedIn;
  readonly engagementId: string;
  readonly jobTitle: string;
}

async function setupEscrow(app: TestApp, amountCents = 12_000): Promise<Setup> {
  const business = await app.signIn("owner@studio.test", "business");
  const coder = await app.signIn("coder@freelance.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada Lovelace",
    skills: "Node.js, SQLite",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "Node.js, SQLite",
    budgetMinCents: 5000,
    budgetMaxCents: 50_000,
  });
  const interest = await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this in two weeks." },
  });
  expect(interest.status).toBe(201);
  const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
    method: "POST",
    cookie: business.cookie,
    body: { jobId: job.id, coderId: profile.id, amountCents },
  });
  expect(created.response.status).toBe(201);
  return { app, business, coder, engagementId: created.body.engagement.id, jobTitle: job.title };
}

describe("receipts", () => {
  it("shows both parties the money and the ledger, and nobody else", async () => {
    const setup = await setupEscrow(newApp());
    const path = `/engagements/${setup.engagementId}/receipt`;

    const businessView = await setup.app.request(path, { cookie: setup.business.cookie });
    expect(businessView.status).toBe(200);
    const businessHtml = await businessView.text();
    expect(businessHtml).toContain("Receipt");
    expect(businessHtml).toContain(setup.jobTitle);
    expect(businessHtml).toContain("€120.00");
    expect(businessHtml).toContain("€18.00");
    expect(businessHtml).toContain("€102.00");
    expect(businessHtml).toContain("Ada Lovelace");
    expect(businessHtml).toContain("Escrow charge");
    expect(businessHtml).toContain("not a tax invoice");

    const coderView = await setup.app.request(path, { cookie: setup.coder.cookie });
    expect(coderView.status).toBe(200);
    expect(await coderView.text()).toContain("€102.00");

    const stranger = await setup.app.signIn("stranger@elsewhere.test", "business");
    const forbidden = await setup.app.request(path, { cookie: stranger.cookie });
    expect(forbidden.status).toBe(404);
    expect(await forbidden.text()).not.toContain("Ada Lovelace");

    const anonymous = await setup.app.request(path);
    expect(anonymous.status).toBe(401);
  });

  it("links the receipt from the engagement card and shows the fee tier", async () => {
    const setup = await setupEscrow(newApp(), 20_000);
    const dashboard = await (
      await setup.app.request("/dashboard", { cookie: setup.business.cookie })
    ).text();
    expect(dashboard).toContain(`/engagements/${setup.engagementId}/receipt`);
    expect(dashboard).toContain("Printable receipt");

    const receipt = await (
      await setup.app.request(`/engagements/${setup.engagementId}/receipt`, {
        cookie: setup.business.cookie,
      })
    ).text();
    expect(receipt).toContain("Platform fee (15%)");
    expect(receipt).toContain("€200.00");
    expect(receipt).toContain("€30.00");
    expect(receipt).toContain("€170.00");
  });
});
