import { afterEach, describe, expect, it } from "vite-plus/test";

import { TEST_ADMIN_TOKEN, createTestApp, setCookies, type TestApp } from "./helpers.ts";

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

function adminCookie(response: Response): string {
  const cookies = setCookies(response);
  const cookie = cookies.find((value) => value.startsWith("codeitlab_admin="));
  if (cookie === undefined) throw new Error("no admin cookie was set");
  return cookie.split(";")[0] ?? "";
}

describe("admin page session", () => {
  it("trades the token for an HttpOnly cookie and keeps it out of the HTML", async () => {
    const app = newApp();
    const response = await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`);
    expect(response.status).toBe(200);
    const raw = setCookies(response).find((value) => value.startsWith("codeitlab_admin=")) ?? "";
    expect(raw).toContain("HttpOnly");
    expect(raw).toContain("SameSite=Strict");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    const html = await response.text();
    expect(html).not.toContain(TEST_ADMIN_TOKEN);
    expect(html).toContain("Back up now");

    const cookie = adminCookie(await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`));
    const cookieOnly = await app.request("/admin", { cookie });
    expect(cookieOnly.status).toBe(200);
    expect(await cookieOnly.text()).toContain("Operator snapshot");

    const wrong = await app.request("/admin", { cookie: "codeitlab_admin=deadbeef" });
    expect(wrong.status).toBe(401);
  });

  it("accepts the cookie for admin actions and rejects a forged one", async () => {
    const app = newApp();
    const cookie = adminCookie(await app.request(`/admin?token=${TEST_ADMIN_TOKEN}`));

    const run = await app.json<{ notified: number }>("/api/admin/coder-alerts/run", {
      method: "POST",
      cookie,
    });
    expect(run.response.status).toBe(200);
    expect(run.body.notified).toBe(0);

    const forged = await app.json<{ error: string }>("/api/admin/coder-alerts/run", {
      method: "POST",
      cookie: "codeitlab_admin=deadbeef",
    });
    expect(forged.response.status).toBe(401);
    expect(forged.body.error).toBe("admin_unauthorized");
  });
});
