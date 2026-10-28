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

interface Export {
  account: { id: string; email: string; role: string };
  profile: { displayName?: string; companyName?: string } | null;
  jobs: { title: string }[];
  applications: unknown[];
  engagements: { id: string }[];
  ledger: unknown[];
  ratings: unknown[];
  notifications: { kind: string }[];
  sessions: { device: string }[];
}

describe("account data export", () => {
  it("returns the coder's own data as a download without secrets", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@export.test", "business");
    const coder: SignedIn = await app.signIn("coder@export.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
      rateMinCents: 5000,
      rateMaxCents: 15_000,
    });
    await approveCoder(app, profile.id);
    const job = await createJob(app, business.cookie, {
      title: "Exportable work",
      skills: "TypeScript",
    });
    await app.request(`/api/jobs/${job.id}/interests`, {
      method: "POST",
      cookie: coder.cookie,
      body: { message: "I can do this." },
    });

    const response = await app.request("/api/me/export", { cookie: coder.cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="codeitlab-account.json"',
    );
    const data = (await response.json()) as Export;
    expect(data.account.email).toBe("coder@export.test");
    expect(data.account.role).toBe("coder");
    expect(data.profile?.displayName).toBe("Ada");
    expect(data.applications).toHaveLength(1);
    expect(data.jobs).toEqual([]);
    expect(data.sessions.length).toBeGreaterThan(0);
    expect(data.sessions[0]).not.toHaveProperty("token");
    const raw = JSON.stringify(data);
    expect(raw).not.toContain("token_hash");
    expect(raw).not.toContain("code_hash");
    expect(raw).not.toContain("owner@export.test");
  });

  it("returns the business's jobs and never another account's rows", async () => {
    const app = newApp();
    const business: SignedIn = await app.signIn("owner@export.test", "business");
    const other: SignedIn = await app.signIn("other@export.test", "business");
    await createJob(app, business.cookie, { title: "Mine to export", skills: "TypeScript" });
    await createJob(app, other.cookie, { title: "Not mine at all", skills: "TypeScript" });

    const data = (await (
      await app.request("/api/me/export", { cookie: business.cookie })
    ).json()) as Export;
    expect(data.jobs.map((job) => job.title)).toEqual(["Mine to export"]);
    expect(JSON.stringify(data)).not.toContain("Not mine at all");
  });

  it("requires a session and links to the download from the dashboard", async () => {
    const app = newApp();
    expect((await app.request("/api/me/export")).status).toBe(401);
    const coder: SignedIn = await app.signIn("coder@export.test", "coder");
    const page = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(page).toContain("Download my data");
    expect(page).toContain("/api/me/export");
  });
});
