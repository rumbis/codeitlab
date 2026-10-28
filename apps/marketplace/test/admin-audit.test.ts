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

interface AuditPayload {
  entries: { action: string; targetId: string; detail: string; createdAt: string }[];
  count: number;
}

interface EngagementPayload {
  engagement: Engagement;
}

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

async function setupDisputed(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@audit.test", "business");
  const coder: SignedIn = await app.signIn("coder@audit.test", "coder");
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
  const engagementId = created.body.engagement.id;
  for (const action of ["accept", "start", "dispute"] as const) {
    const moved = await app.request(`/api/engagements/${engagementId}/${action}`, {
      method: "POST",
      cookie: action === "dispute" ? business.cookie : coder.cookie,
    });
    expect(moved.status).toBe(200);
  }
  return { business, coder, profile, engagementId };
}

describe("admin audit", () => {
  it("records a dispute decision with the reason", async () => {
    const app = createTestApp({ autoApprove: true });
    const { engagementId } = await setupDisputed(app);

    const resolved = await app.request(`/api/admin/disputes/${engagementId}/resolve`, {
      method: "POST",
      form: { outcome: "refunded", note: "Scope mismatch; refunding the business." },
      headers: ADMIN,
    });
    expect(resolved.status).toBe(303);

    const audit = await app.json<AuditPayload>("/api/admin/audit", { headers: ADMIN });
    expect(audit.response.status).toBe(200);
    expect(audit.body.count).toBe(2); // profile approval + the decision
    expect(audit.body.entries[0]?.action).toBe("dispute.resolve");
    expect(audit.body.entries[0]?.targetId).toBe(engagementId);
    expect(audit.body.entries[0]?.detail).toContain("refunded");
    expect(audit.body.entries[0]?.detail).toContain("Scope mismatch");
  });

  it("records a profile approval and lists newest first", async () => {
    const app = createTestApp({ autoApprove: false });
    const coder: SignedIn = await app.signIn("coder@audit2.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Grace",
      skills: "SQLite",
      rateMinCents: 5000,
      rateMaxCents: 15_000,
    });
    await approveCoder(app, profile.id);

    const first = await app.json<AuditPayload>("/api/admin/audit", { headers: ADMIN });
    expect(first.body.entries[0]?.action).toBe("coder.approve");
    expect(first.body.entries[0]?.targetId).toBe(profile.id);

    const { engagementId } = await setupDisputed(app);
    await app.request(`/api/admin/disputes/${engagementId}/resolve`, {
      method: "POST",
      form: { outcome: "released", note: "Evidence matches the scope; releasing." },
      headers: ADMIN,
    });
    const second = await app.json<AuditPayload>("/api/admin/audit", { headers: ADMIN });
    expect(second.body.entries[0]?.action).toBe("dispute.resolve");
    expect(second.body.entries[1]?.action).toBe("coder.approve");
  });

  it("requires the admin token and renders the audit trail on the admin page", async () => {
    const app = createTestApp({ autoApprove: true });
    const { engagementId } = await setupDisputed(app);

    const unauthorizedResponse = await app.request("/api/admin/audit");
    expect(unauthorizedResponse.status).toBe(401);

    await app.request(`/api/admin/disputes/${engagementId}/resolve`, {
      method: "POST",
      form: { outcome: "released", note: "Verified the delivery evidence; releasing." },
      headers: ADMIN,
    });

    const page = await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`);
    const html = await page.text();
    expect(html).toContain("Recent admin actions");
    expect(html).toContain("dispute.resolve");
    expect(html).toContain("Verified the delivery evidence");
  });
});
