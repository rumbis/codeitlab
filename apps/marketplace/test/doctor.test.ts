import { describe, expect, it } from "vite-plus/test";

import { runDoctor } from "../src/server/doctor.ts";

const GOOD_ENV: Record<string, string> = {
  MARKETPLACE_DEV_EMAIL: "0",
  MARKETPLACE_MAIL_TRANSPORT: "webhook",
  MARKETPLACE_MAIL_WEBHOOK: "https://mail.example/hook",
  PAYMENTS_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: "sk_live_like_but_present",
  STRIPE_CONNECTED_ACCOUNT_ID: "acct_123",
  PAYMENTS_WEBHOOK_SECRET: "whsec_123",
  MARKETPLACE_ADMIN_TOKEN: "a".repeat(32),
  MARKETPLACE_BASE_URL: "https://codeitlab.com/market",
  MARKETPLACE_COOKIE_SECURE: "1",
  MARKETPLACE_DB: "/var/lib/codeitlab/marketplace.sqlite",
  PORT: "4174",
};

function statusOf(env: Record<string, string | undefined>, name: string) {
  return runDoctor(env).checks.find((check) => check.name === name)?.status;
}

describe("production preflight", () => {
  it("passes a correctly configured deployment", () => {
    const report = runDoctor(GOOD_ENV);
    expect(report.ok).toBe(true);
    expect(report.checks.every((check) => check.status !== "fail")).toBe(true);
  });

  it("fails when login codes cannot reach anyone", () => {
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_DEV_EMAIL: "1" }, "login mail")).toBe("fail");
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_MAIL_TRANSPORT: "log" }, "login mail")).toBe("fail");
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_MAIL_WEBHOOK: "" }, "login mail")).toBe("fail");
  });

  it("fails on insecure or incomplete production settings", () => {
    expect(
      statusOf({ ...GOOD_ENV, PAYMENTS_PROVIDER: "stripe", STRIPE_SECRET_KEY: "" }, "payments"),
    ).toBe("fail");
    expect(statusOf({ ...GOOD_ENV, PAYMENTS_WEBHOOK_SECRET: "" }, "payment webhooks")).toBe("fail");
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_ADMIN_TOKEN: "" }, "admin token")).toBe("fail");
    expect(
      statusOf({ ...GOOD_ENV, MARKETPLACE_BASE_URL: "http://codeitlab.com" }, "base url"),
    ).toBe("fail");
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_COOKIE_SECURE: "0" }, "cookie security")).toBe(
      "fail",
    );
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_DB: ":memory:" }, "database")).toBe("fail");
    expect(statusOf({ ...GOOD_ENV, PORT: "nope" }, "port")).toBe("fail");
  });

  it("warns instead of failing on dev-only choices", () => {
    expect(statusOf({ ...GOOD_ENV, PAYMENTS_PROVIDER: "mock" }, "payments")).toBe("warn");
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_ADMIN_TOKEN: "short" }, "admin token")).toBe("warn");
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_COOKIE_SECURE: "0" }, "cookie security")).toBe(
      "fail",
    );
    const dev = runDoctor({ MARKETPLACE_DB: "dev.sqlite" });
    expect(dev.ok).toBe(false); // dev email default is 1 -> fail
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_BASE_PATH: "/market" }, "proxy trust")).toBe("warn");
    expect(
      statusOf(
        { ...GOOD_ENV, MARKETPLACE_NOTIFY_WEBHOOK: "https://hook", MARKETPLACE_NOTIFY_SECRET: "" },
        "activity outbox",
      ),
    ).toBe("warn");
  });

  it("checks Web Push keys only as far as they can be checked", () => {
    expect(statusOf(GOOD_ENV, "web push")).toBe("warn");
    expect(
      statusOf({ ...GOOD_ENV, VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "" }, "web push"),
    ).toBe("fail");
    expect(
      statusOf(
        { ...GOOD_ENV, VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" },
        "web push",
      ),
    ).toBe("ok");
    expect(
      statusOf(
        {
          ...GOOD_ENV,
          VAPID_PUBLIC_KEY: "public",
          VAPID_PRIVATE_KEY: "private",
          VAPID_SUBJECT: "admin@example.com",
        },
        "web push",
      ),
    ).toBe("warn");
  });

  it("ties auto-release to a maintenance loop", () => {
    const scheduled = {
      ...GOOD_ENV,
      MARKETPLACE_AUTO_RELEASE_DAYS: "14",
      MARKETPLACE_MAINTENANCE_MINUTES: "15",
    };
    expect(statusOf(scheduled, "auto-release")).toBe("ok");
    expect(statusOf(scheduled, "maintenance loop")).toBe("ok");
    expect(runDoctor(scheduled).ok).toBe(true);

    const manual = { ...GOOD_ENV, MARKETPLACE_AUTO_RELEASE_DAYS: "14" };
    expect(statusOf(manual, "maintenance loop")).toBe("warn");
    expect(
      runDoctor(manual).checks.find((check) => check.name === "maintenance loop")?.detail,
    ).toContain("cron");
    expect(runDoctor(manual).ok).toBe(true);

    const disabled = { ...GOOD_ENV, MARKETPLACE_AUTO_RELEASE_DAYS: "0" };
    expect(statusOf(disabled, "auto-release")).toBe("warn");
    expect(statusOf(disabled, "maintenance loop")).toBe("warn");

    const typo = {
      ...GOOD_ENV,
      MARKETPLACE_AUTO_RELEASE_DAYS: "fourteen",
      MARKETPLACE_MAINTENANCE_MINUTES: "-5",
    };
    expect(statusOf(typo, "auto-release")).toBe("warn");
    expect(statusOf(typo, "maintenance loop")).toBe("warn");
  });

  it("warns on a rate limit that is not a positive integer", () => {
    const env = { ...GOOD_ENV, MARKETPLACE_CHARGE_LIMIT_PER_HOUR: "ten" };
    const report = runDoctor(env);
    expect(statusOf(env, "rate limits")).toBe("warn");
    expect(report.checks.find((check) => check.name === "rate limits")?.detail).toContain(
      "MARKETPLACE_CHARGE_LIMIT_PER_HOUR",
    );
    expect(report.ok).toBe(true);
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_CHARGE_LIMIT_PER_HOUR: "5" }, "rate limits")).toBe(
      undefined,
    );
  });

  it("accepts trust-proxy only when explicitly enabled", () => {
    expect(statusOf({ ...GOOD_ENV, MARKETPLACE_TRUST_PROXY: "1" }, "proxy trust")).toBe("ok");
    expect(statusOf(GOOD_ENV, "proxy trust")).toBe("ok");
  });
});
