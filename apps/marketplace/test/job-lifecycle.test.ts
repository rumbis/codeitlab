import { afterEach, describe, expect, it } from "vite-plus/test";

import type { Job } from "../src/shared/contracts.ts";
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

function newApp(): TestApp {
  const app = createTestApp({ autoApprove: true });
  apps.push(app);
  return app;
}

async function world(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@lifecycle.test", "business");
  const other: SignedIn = await app.signIn("other@lifecycle.test", "business");
  const coder: SignedIn = await app.signIn("coder@lifecycle.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    title: "Closeable job",
    skills: "TypeScript",
  });
  return { business, other, coder, profile, job };
}

function close(app: TestApp, cookie: string, jobId: string) {
  return app.json<{ job?: Job; error?: string }>(`/api/jobs/${jobId}/close`, {
    method: "POST",
    cookie,
  });
}

function reopen(app: TestApp, cookie: string, jobId: string) {
  return app.json<{ job?: Job; error?: string }>(`/api/jobs/${jobId}/reopen`, {
    method: "POST",
    cookie,
  });
}

describe("job lifecycle", () => {
  it("lets the owner close an open job and reopen it later", async () => {
    const app = newApp();
    const { business, job } = await world(app);
    const closed = await close(app, business.cookie, job.id);
    expect(closed.response.status).toBe(200);
    expect(closed.body.job?.status).toBe("closed");

    const board = await (await app.request("/jobs")).text();
    expect(board).not.toContain("Closeable job");
    expect((await app.request(`/jobs/${job.id}`)).status).toBe(200);

    const dashboard = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    expect(dashboard).toContain("Reopen job");
    expect(dashboard).not.toContain("Close job");

    const reopened = await reopen(app, business.cookie, job.id);
    expect(reopened.response.status).toBe(200);
    expect(reopened.body.job?.status).toBe("open");
    expect(await (await app.request("/jobs")).text()).toContain("Closeable job");
  });

  it("refuses close and reopen to the wrong account or state", async () => {
    const app = newApp();
    const { business, other, coder, profile, job } = await world(app);
    expect((await close(app, coder.cookie, job.id)).body.error).toBe("wrong_role");
    expect((await close(app, other.cookie, job.id)).body.error).toBe("not_owner");
    expect((await reopen(app, business.cookie, job.id)).body.error).toBe("job_not_closed");

    const engagement = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    expect(engagement.response.status).toBe(201);
    expect((await close(app, business.cookie, job.id)).body.error).toBe("job_not_open");

    await app.request(`/api/engagements/${engagement.body.engagement.id}/cancel`, {
      method: "POST",
      cookie: business.cookie,
    });
    expect((await close(app, business.cookie, job.id)).body.job?.status).toBe("closed");
  });

  it("does not let an owner reopen a job removed after a report", async () => {
    const app = newApp();
    const { business, coder, job } = await world(app);
    const reported = await app.json<{ report: { id: string } }>("/api/reports", {
      method: "POST",
      cookie: coder.cookie,
      body: { targetKind: "job", targetId: job.id, reason: "scam" },
    });
    expect(reported.response.status).toBe(201);
    await app.request(`/api/admin/reports/${reported.body.report.id}/resolve`, {
      method: "POST",
      headers: ADMIN,
      body: { resolution: "job_removed" },
    });
    const removed = await reopen(app, business.cookie, job.id);
    expect(removed.response.status).toBe(403);
    expect(removed.body.error).toBe("job_removed");
    expect((await close(app, business.cookie, job.id)).body.error).toBe("job_not_open");
  });
});
