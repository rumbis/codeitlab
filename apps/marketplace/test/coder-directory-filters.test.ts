import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  approveCoder,
  createCoderProfile,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

async function directory(): Promise<TestApp> {
  const app = createTestApp({ autoApprove: false });
  apps.push(app);
  const coders: Array<[string, string, number]> = [
    ["Ada", "weekends", 8_000],
    ["Bob", "full_time", 20_000],
    ["Cy", "part_time", 12_000],
  ];
  for (const [name, availability, rateMinCents] of coders) {
    const coder: SignedIn = await app.signIn(`${name.toLowerCase()}@directory.test`, "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: name,
      skills: "TypeScript",
      availability,
      rateMinCents,
      rateMaxCents: rateMinCents * 2,
    });
    await approveCoder(app, profile.id);
  }
  return app;
}

async function shown(app: TestApp, query: string): Promise<string[]> {
  const page = await (await app.request(`/coders${query}`)).text();
  return ["Ada", "Bob", "Cy"].filter((name) => page.includes(`>${name}</a></h3>`));
}

describe("coder directory filters", () => {
  it("filters by declared availability", async () => {
    const app = await directory();
    expect(await shown(app, "")).toHaveLength(3);
    expect(await shown(app, "?availability=weekends")).toEqual(["Ada"]);
    expect(await shown(app, "?availability=part_time")).toEqual(["Cy"]);
    // An unknown value is ignored rather than showing an empty directory.
    expect(await shown(app, "?availability=zzz")).toHaveLength(3);
  });

  it("filters by the coder's own minimum rate", async () => {
    const app = await directory();
    expect(await shown(app, "?maxRate=100")).toEqual(["Ada"]);
    expect(await shown(app, "?maxRate=150")).toEqual(["Ada", "Cy"]);
    expect(await shown(app, "?maxRate=999")).toHaveLength(3);
  });

  it("combines filters and explains the active ones", async () => {
    const app = await directory();
    expect(await shown(app, "?availability=part_time&maxRate=150")).toEqual(["Cy"]);
    const page = await (await app.request("/coders?availability=weekends&maxRate=100")).text();
    expect(page).toContain('name="availability"');
    expect(page).toContain('name="maxRate"');
    expect(page).toContain("Part time");
    expect(page).toContain("starting under €100.00");
    expect(page).toContain("1 coder shown");
  });
});
