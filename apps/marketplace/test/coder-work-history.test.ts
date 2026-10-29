import { afterEach, describe, expect, it } from "vite-plus/test";

import { formatWorkEntry, parseWorkLine } from "../src/server/profiles.ts";
import { createCoderProfile, createTestApp, type SignedIn, type TestApp } from "./helpers.ts";

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

describe("marketplace: a work history line", () => {
  it("splits a full line into role, company, period and summary", () => {
    expect(
      parseWorkLine("Senior engineer at Acme (2021 - 2024): Led the billing rewrite."),
    ).toEqual({
      company: "Acme",
      role: "Senior engineer",
      period: "2021 - 2024",
      summary: "Led the billing rewrite.",
    });
  });

  it("accepts a bare role, because not every job has the other parts", () => {
    expect(parseWorkLine("Freelance designer")).toEqual({
      company: "",
      role: "Freelance designer",
      period: "",
      summary: "",
    });
  });

  it("keeps a company whose name contains the word at", () => {
    expect(parseWorkLine("Engineer at Atari at Home")).toEqual({
      company: "Atari at Home",
      role: "Engineer",
      period: "",
      summary: "",
    });
  });

  it("round trips through the form representation", () => {
    for (const line of [
      "Senior engineer at Acme (2021 - 2024): Led the billing rewrite.",
      "Freelance designer",
      "Engineer at Atari at Home",
    ]) {
      expect(formatWorkEntry(parseWorkLine(line))).toBe(line);
    }
  });
});

describe("marketplace: work history on a profile", () => {
  it("stores what a person has worked on and shows it back to a business", async () => {
    const app = newApp();
    const coder: SignedIn = await app.signIn("worker@history.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada Lovelace",
      skills: "TypeScript",
    });

    await app.json("/api/coders/profile", {
      method: "POST",
      cookie: coder.cookie,
      body: {
        displayName: "Ada Lovelace",
        headline: "Product engineer",
        bio: "I build small, reliable web products end to end.",
        skills: "TypeScript",
        workHistory: "Senior engineer at Acme (2021 - 2024): Led the billing rewrite.",
        availability: "full_time",
        rateMinCents: 5000,
        rateMaxCents: 8000,
        currency: "EUR",
        timezone: "Europe/Berlin",
      },
    });

    const page = await app.request(`/coders/${profile.id}`);
    const html = await page.text();
    expect(html).toContain("What they have worked on");
    expect(html).toContain("Senior engineer at Acme");
    expect(html).toContain("Led the billing rewrite.");
    expect(html).toContain("2021 - 2024");
  });

  it("shows nothing when the person declared no work", async () => {
    const app = newApp();
    const coder: SignedIn = await app.signIn("empty@history.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Grace Hopper",
      skills: "COBOL",
    });

    const html = await (await app.request(`/coders/${profile.id}`)).text();
    expect(html).not.toContain("What they have worked on");
  });

  it("drops a row that says nothing instead of storing a blank job", async () => {
    const app = newApp();
    const coder: SignedIn = await app.signIn("blank@history.test", "coder");
    const created = await app.json<{ coder: { workHistory: unknown[] } }>("/api/coders/profile", {
      method: "POST",
      cookie: coder.cookie,
      body: {
        displayName: "Katherine Johnson",
        headline: "Computer",
        bio: "I check the numbers that other people trust.",
        skills: "Mathematics",
        workHistory: "   \n\n  \n",
        availability: "full_time",
        rateMinCents: 5000,
        rateMaxCents: 8000,
        currency: "EUR",
        timezone: "Europe/Berlin",
      },
    });
    expect(created.body.coder.workHistory).toEqual([]);
  });
});
