import { afterEach, describe, expect, it } from "vite-plus/test";

import { DAY_MS } from "../src/server/autoRelease.ts";
import { maintenanceMinutesFromEnv, startMaintenance } from "../src/server/maintenance.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  TEST_ADMIN_TOKEN,
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

describe("maintenance loop", () => {
  it("parses the interval and stays manual by default", () => {
    expect(maintenanceMinutesFromEnv({})).toBe(0);
    expect(maintenanceMinutesFromEnv({ MARKETPLACE_MAINTENANCE_MINUTES: "15" })).toBe(15);
    expect(maintenanceMinutesFromEnv({ MARKETPLACE_MAINTENANCE_MINUTES: "0" })).toBe(0);
    expect(maintenanceMinutesFromEnv({ MARKETPLACE_MAINTENANCE_MINUTES: "-3" })).toBe(0);
    expect(maintenanceMinutesFromEnv({ MARKETPLACE_MAINTENANCE_MINUTES: "nope" })).toBe(0);
  });

  it("sweeps reminders, alerts and auto-release in one pass", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@maint.test", "business");
    const coder: SignedIn = await app.signIn("coder@maint.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
    });
    await approveCoder(app, profile.id);
    const job = await createJob(app, business.cookie, { title: "Sweep me", skills: "TypeScript" });
    const created = await app.json<{ engagement: { id: string } }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    const engagementId = created.body.engagement.id;
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

    app.advance(14 * DAY_MS + 1_000);
    const summary = await app.app.sweep();
    expect(summary.released).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.reminders).toBeGreaterThanOrEqual(1);

    const reconcile = await app.json<{ ok: boolean }>("/api/admin/reconcile", {
      headers: { authorization: `Bearer ${TEST_ADMIN_TOKEN}` },
    });
    expect(reconcile.body.ok).toBe(true);

    const idle = await app.app.sweep();
    expect(idle.released).toBe(0);
    expect(idle.reminders).toBe(0);
    expect(idle.alerts).toBe(0);
  });

  it("keeps running after a failing sweep and stops cleanly", async () => {
    let failures = 0;
    const handle = startMaintenance(
      {
        sweep: async () => {
          failures += 1;
          throw new Error("provider down");
        },
      },
      { minutes: 0.0002, onError: () => undefined },
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    handle.stop();
    expect(failures).toBeGreaterThanOrEqual(1);

    const stopped = startMaintenance({ sweep: async () => ({}) as never }, { minutes: 0 });
    stopped.stop();
  });
});
