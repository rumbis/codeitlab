import { describe, expect, it } from "vite-plus/test";

import { createTestApp } from "./helpers.ts";

interface SavedProfile {
  business: { companyName: string; industry: string };
}

describe("business profile field", () => {
  it("saves the field the business hires in and starts new job posts there", async () => {
    const app = createTestApp();
    const business = await app.signIn("studio@business.test", "business");

    const saved = await app.json<SavedProfile>("/api/business/profile", {
      method: "POST",
      cookie: business.cookie,
      body: {
        companyName: "Studio",
        website: "https://studio.example",
        about: "We ship films.",
        industry: "video",
      },
    });
    expect(saved.response.status).toBe(200);
    expect(saved.body.business.industry).toBe("video");

    // The job form starts in the declared field instead of the generic default,
    // and the coder-alert domain starts there too.
    const dashboard = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    expect(dashboard).toContain('<option value="video" selected>');
    expect(dashboard).toContain('name="interest" id="field-interest" value="video"');

    // Clearing it is allowed and falls back to the default field.
    const cleared = await app.json<SavedProfile>("/api/business/profile", {
      method: "POST",
      cookie: business.cookie,
      body: { companyName: "Studio", website: "", about: "", industry: "" },
    });
    expect(cleared.response.status).toBe(200);
    expect(cleared.body.business.industry).toBe("");
    const after = await (await app.request("/dashboard", { cookie: business.cookie })).text();
    expect(after).toContain('<option value="web" selected>');
    expect(after).toContain('name="interest" id="field-interest" value=""');
  });

  it("rejects a field that is not one of the listed ones", async () => {
    const app = createTestApp();
    const business = await app.signIn("studio@business.test", "business");
    const rejected = await app.json<{ error: string }>("/api/business/profile", {
      method: "POST",
      cookie: business.cookie,
      body: { companyName: "Studio", industry: "gardening" },
    });
    expect(rejected.response.status).toBe(400);
    expect(rejected.body.error).toBe("invalid_industry");
  });
});
