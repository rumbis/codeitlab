import { afterEach, describe, expect, it } from "vite-plus/test";

import { createTestApp, type TestApp } from "./helpers.ts";

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp(overrides);
  apps.push(app);
  return app;
}

describe("how it works", () => {
  it("explains the escrow path and both exits without a session", async () => {
    const app = newApp();
    const response = await app.request("/how-it-works");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();

    for (const status of [
      "requested",
      "accepted",
      "in progress",
      "delivered",
      "approved",
      "paid out",
    ]) {
      expect(html, status).toContain(status);
    }
    expect(html).toContain("Cancelled");
    expect(html).toContain("Disputed");
    expect(html).toContain("refunded");
    expect(html).toContain("released");
    expect(html).toContain("append-only");
  });

  it("shows the real fee split for an amount, computed from the fee constants", async () => {
    const app = newApp();
    const html = await (await app.request("/how-it-works?amount=1000")).text();

    // 15% of €1,000 = €150, 20% = €200; the coder receives the rest.
    expect(html).toContain("€150.00");
    expect(html).toContain("€850.00");
    expect(html).toContain("€200.00");
    expect(html).toContain("€800.00");
    expect(html).toContain("15%");
    expect(html).toContain("20%");
    expect(html).toContain("Posting a job is free");
  });

  it("defaults a missing or hostile amount instead of failing", async () => {
    const app = newApp();
    const missing = await (await app.request("/how-it-works")).text();
    expect(missing).toContain("€150.00");

    const hostile = await (await app.request("/how-it-works?amount=-5")).text();
    expect(hostile).toContain("not a usable amount");
    expect(hostile).toContain("€150.00");

    const huge = await (await app.request("/how-it-works?amount=99999999")).text();
    expect(huge).toContain("not a usable amount");
    expect(huge).not.toContain("€14999999");
  });

  it("is honest about where AI is and is not, and about auto-release", async () => {
    const app = newApp();
    const html = await (await app.request("/how-it-works")).text();
    expect(html).toContain("Where AI is — and is not");
    expect(html).toContain("AI is not the judge here");
    expect(html).toContain("No model approves a delivery, sets a fee or moves money");
    expect(html).toContain("coder ranking is arithmetic");
    expect(html).toContain("No surprise release");
    expect(html).toContain("auto-releases on the date shown");
    expect(html).toContain("14 days");

    const disabled = newApp({ autoReleaseDays: 0 });
    const off = await (await disabled.request("/how-it-works")).text();
    expect(off).toContain("Auto-release is off on this deployment");
    expect(off).not.toContain("auto-releases on the date shown");
  });

  it("is reachable from the nav and the home page", async () => {
    const app = newApp();
    const home = await (await app.request("/")).text();
    expect(home).toContain('href="/how-it-works"');
    expect(home).toContain("How it works");
  });

  it("keeps the money path out of the page: no forms that post", async () => {
    const app = newApp();
    const html = await (await app.request("/how-it-works")).text();
    // The only form is the GET calculator; nothing here can charge or approve.
    expect(html.match(/<form/gu)).toHaveLength(1);
    expect(html).toContain('method="get"');
    expect(html).not.toContain('method="post"');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/u);
  });
});
