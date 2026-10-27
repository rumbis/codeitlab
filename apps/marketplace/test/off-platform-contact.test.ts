import { afterEach, describe, expect, it } from "vite-plus/test";

import { findOffPlatformContact } from "../src/server/contactGuard.ts";
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

async function world(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@contact.test", "business");
  const coder: SignedIn = await app.signIn("coder@contact.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    title: "Contact test",
    skills: "TypeScript",
  });
  return { business, coder, profile, job };
}

function apply(app: TestApp, cookie: string, jobId: string, message: string) {
  return app.json<{ error?: string; message?: string }>(`/api/jobs/${jobId}/interests`, {
    method: "POST",
    cookie,
    body: { message },
  });
}

describe("off-platform contact guard", () => {
  it("recognises emails, phone numbers and links but not ordinary text", () => {
    expect(findOffPlatformContact("Write to ada@example.com")).toBe("email");
    expect(findOffPlatformContact("call +30 690 123 4567")).toBe("phone");
    expect(findOffPlatformContact("see https://ada.dev/work")).toBe("link");
    expect(findOffPlatformContact("portfolio at ada.dev")).toBe("link");

    for (const text of [
      "I can deliver this in 3–4 days.",
      "I know TypeScript, Node.js and SQLite.",
      "Budget €1,000 works for me.",
      "I have 12 years of experience and 4 launches.",
    ]) {
      expect(findOffPlatformContact(text), text).toBeNull();
    }
  });

  it("refuses an application that moves the conversation off the platform", async () => {
    const app = newApp();
    const { coder, job } = await world(app);
    for (const message of [
      "Email me at ada@example.com and we can skip the fee.",
      "Call 6901234567.",
      "My portfolio is https://ada.dev.",
      "Look at ada.dev.",
    ]) {
      const response = await apply(app, coder.cookie, job.id, message);
      expect(response.response.status, message).toBe(400);
      expect(response.body.error).toBe("off_platform_contact_application");
    }
    const clean = await apply(app, coder.cookie, job.id, "I have shipped three of these.");
    expect(clean.response.status).toBe(201);
  });

  it("refuses an invitation that carries contact details", async () => {
    const app = newApp();
    const { business, profile, job } = await world(app);
    const response = await app.json<{ error?: string }>(`/api/jobs/${job.id}/invite`, {
      method: "POST",
      cookie: business.cookie,
      body: { coderId: profile.id, message: "Ping me on +30 690 123 4567." },
    });
    expect(response.response.status).toBe(400);
    expect(response.body.error).toBe("off_platform_contact_invite");

    const clean = await app.json<{ invite: { id: string } }>(`/api/jobs/${job.id}/invite`, {
      method: "POST",
      cookie: business.cookie,
      body: { coderId: profile.id, message: "This looks like your kind of work." },
    });
    expect(clean.response.status).toBe(200);
  });
});
