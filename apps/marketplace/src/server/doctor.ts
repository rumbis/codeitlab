/**
 * Preflight for a production deployment. Every check is a mistake that is cheap
 * to catch here and expensive to discover in production: login codes nobody can
 * receive, cookies that a browser drops, an admin token that is a guess away, or
 * a mock payment provider quietly moving fake money.
 *
 * Pure on purpose: the caller passes the environment, so this is testable and
 * never reads process.env behind your back.
 */
export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  readonly name: string;
  readonly status: DoctorStatus;
  readonly detail: string;
}

export interface DoctorReport {
  readonly ok: boolean;
  readonly checks: readonly DoctorCheck[];
}

const MIN_ADMIN_TOKEN_LENGTH = 24;

export function runDoctor(env: Record<string, string | undefined>): DoctorReport {
  const checks: DoctorCheck[] = [];
  const add = (name: string, status: DoctorStatus, detail: string): void => {
    checks.push({ name, status, detail });
  };

  const devEmail = env.MARKETPLACE_DEV_EMAIL ?? "1";
  const baseUrl = env.MARKETPLACE_BASE_URL ?? "https://codeitlab.com/market";
  const cookieSecure = env.MARKETPLACE_COOKIE_SECURE ?? "0";
  const trustProxy = env.MARKETPLACE_TRUST_PROXY ?? "0";
  const basePath = env.MARKETPLACE_BASE_PATH ?? "";
  const provider = env.PAYMENTS_PROVIDER ?? "mock";
  const adminToken = env.MARKETPLACE_ADMIN_TOKEN ?? "";
  const dbPath = env.MARKETPLACE_DB ?? "";

  // 1. Login must be able to reach a human.
  if (devEmail === "1") {
    add(
      "login mail",
      "fail",
      "MARKETPLACE_DEV_EMAIL=1 prints codes to stdout; production must be 0.",
    );
  } else {
    const transport = env.MARKETPLACE_MAIL_TRANSPORT ?? "";
    if (transport !== "webhook") {
      add("login mail", "fail", "Set MARKETPLACE_MAIL_TRANSPORT=webhook for production.");
    } else if ((env.MARKETPLACE_MAIL_WEBHOOK ?? "") === "") {
      add("login mail", "fail", "MARKETPLACE_MAIL_WEBHOOK is empty, so codes cannot be sent.");
    } else {
      add("login mail", "ok", `Login codes are mailed through ${env.MARKETPLACE_MAIL_WEBHOOK}.`);
    }
  }

  // 2. Payments must not be the mock provider.
  if (provider === "mock") {
    add("payments", "warn", "PAYMENTS_PROVIDER=mock settles fake money; use stripe in production.");
  } else if (provider !== "stripe") {
    add("payments", "fail", `PAYMENTS_PROVIDER="${provider}" is not a supported provider.`);
  } else {
    const missing = [
      (env.STRIPE_SECRET_KEY ?? "") === "" ? "STRIPE_SECRET_KEY" : "",
      (env.STRIPE_CONNECTED_ACCOUNT_ID ?? "") === "" ? "STRIPE_CONNECTED_ACCOUNT_ID" : "",
    ].filter(Boolean);
    if (missing.length > 0) {
      add("payments", "fail", `Stripe is selected but ${missing.join(" and ")} is empty.`);
    } else {
      add("payments", "ok", "Stripe keys are present.");
    }
    if ((env.PAYMENTS_WEBHOOK_SECRET ?? "") === "") {
      add(
        "payment webhooks",
        "fail",
        "PAYMENTS_WEBHOOK_SECRET is empty; the webhook route is disabled and provider events cannot be verified.",
      );
    } else {
      add("payment webhooks", "ok", "Webhook signatures are verified.");
    }
  }

  // 3. Admin access.
  if (adminToken === "") {
    add("admin token", "fail", "MARKETPLACE_ADMIN_TOKEN is empty; /admin is unavailable.");
  } else if (adminToken.length < MIN_ADMIN_TOKEN_LENGTH) {
    add(
      "admin token",
      "warn",
      `MARKETPLACE_ADMIN_TOKEN is shorter than ${MIN_ADMIN_TOKEN_LENGTH} characters; use a generated secret.`,
    );
  } else {
    add("admin token", "ok", "Admin token is long enough to be a real secret.");
  }

  // 4. URLs and cookies.
  if (baseUrl.startsWith("https://")) {
    add("base url", "ok", baseUrl);
  } else {
    add("base url", "fail", `MARKETPLACE_BASE_URL must be https, got "${baseUrl}".`);
  }
  if (baseUrl.startsWith("https://") && cookieSecure !== "1") {
    add(
      "cookie security",
      "fail",
      "MARKETPLACE_COOKIE_SECURE must be 1 over HTTPS, otherwise the session cookie can leak.",
    );
  } else if (cookieSecure === "1") {
    add("cookie security", "ok", "Session cookies are Secure and SameSite=Lax.");
  } else {
    add("cookie security", "warn", "Cookie is not Secure; acceptable only for local development.");
  }

  // 5. Proxy identity: rate limits key on the socket unless a proxy is declared.
  if (basePath !== "" && trustProxy !== "1") {
    add(
      "proxy trust",
      "warn",
      `MARKETPLACE_BASE_PATH="${basePath}" suggests a reverse proxy; set MARKETPLACE_TRUST_PROXY=1 only if it is really there.`,
    );
  } else if (trustProxy === "1") {
    add(
      "proxy trust",
      "ok",
      "Forwarded headers are trusted; ensure only the proxy can reach the server.",
    );
  } else {
    add(
      "proxy trust",
      "ok",
      "Rate limits key on the socket address (no forwarded headers trusted).",
    );
  }

  // 6. Database and port.
  if (dbPath === "" || dbPath === ":memory:") {
    add("database", "fail", "MARKETPLACE_DB must point at a persistent file in production.");
  } else {
    add("database", "ok", dbPath);
  }
  const port = env.PORT ?? "4174";
  const portNumber = Number(port);
  if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65_535) {
    add("port", "fail", `PORT="${port}" is not a valid port.`);
  } else {
    add("port", "ok", `Listening on ${port}.`);
  }

  // 7. Optional outbox secret.
  if (
    (env.MARKETPLACE_NOTIFY_WEBHOOK ?? "") !== "" &&
    (env.MARKETPLACE_NOTIFY_SECRET ?? "") === ""
  ) {
    add(
      "activity outbox",
      "warn",
      "MARKETPLACE_NOTIFY_WEBHOOK is set without MARKETPLACE_NOTIFY_SECRET; receivers cannot verify pushes.",
    );
  }

  // Web Push is optional, but a half-configured pair fails at startup anyway.
  const vapidPublic = env.VAPID_PUBLIC_KEY ?? "";
  const vapidPrivate = env.VAPID_PRIVATE_KEY ?? "";
  const vapidSubject = env.VAPID_SUBJECT ?? "mailto:security@codeitlab.com";
  if (vapidPublic === "" && vapidPrivate === "") {
    add("web push", "warn", "VAPID keys are unset; the dashboard explains that push is off.");
  } else if (vapidPublic === "" || vapidPrivate === "") {
    add("web push", "fail", "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY together.");
  } else if (!vapidSubject.startsWith("mailto:") && !vapidSubject.startsWith("https://")) {
    add("web push", "warn", "VAPID_SUBJECT should be a mailto: or https: contact.");
  } else {
    add("web push", "ok", "VAPID keys are present; browsers can subscribe.");
  }

  // 8. Scheduled work: auto-release and the maintenance loop are one decision.
  const autoReleaseRaw = env.MARKETPLACE_AUTO_RELEASE_DAYS ?? "14";
  const autoRelease = Number(autoReleaseRaw);
  const autoReleaseValid = Number.isInteger(autoRelease) && autoRelease >= 0;
  const maintenanceRaw = env.MARKETPLACE_MAINTENANCE_MINUTES ?? "0";
  const maintenance = Number(maintenanceRaw);
  const maintenanceValid = Number.isInteger(maintenance) && maintenance >= 0;
  if (!autoReleaseValid) {
    add(
      "auto-release",
      "warn",
      `MARKETPLACE_AUTO_RELEASE_DAYS="${autoReleaseRaw}" is not a whole number; auto-release is disabled.`,
    );
  } else if (autoRelease === 0) {
    add(
      "auto-release",
      "warn",
      "Auto-release is off; a delivery nobody answers waits forever (a human can still approve or dispute).",
    );
  } else {
    add("auto-release", "ok", `Deliveries auto-release after ${autoRelease} days.`);
  }
  if (!maintenanceValid) {
    add(
      "maintenance loop",
      "warn",
      `MARKETPLACE_MAINTENANCE_MINUTES="${maintenanceRaw}" is not a whole number; sweeps stay manual.`,
    );
  } else if (maintenance === 0) {
    add(
      "maintenance loop",
      "warn",
      autoReleaseValid && autoRelease > 0
        ? "Auto-release is on but no maintenance loop is set; run POST /api/admin/auto-release/run from cron or set MARKETPLACE_MAINTENANCE_MINUTES."
        : "Sweeps (reminders, job alerts, auto-release) are manual; run them from cron or set MARKETPLACE_MAINTENANCE_MINUTES.",
    );
  } else {
    add(
      "maintenance loop",
      "ok",
      `Reminders, job alerts and auto-release run every ${maintenance} minutes.`,
    );
  }

  // 9. Rate limits: a typo should not silently become the default.
  const limits: readonly [string, string][] = [
    ["MARKETPLACE_CHARGE_LIMIT_PER_HOUR", "10"],
    ["MARKETPLACE_TRANSITION_LIMIT_PER_HOUR", "120"],
    ["MARKETPLACE_INVITE_LIMIT_PER_HOUR", "60"],
    ["MARKETPLACE_REPORT_LIMIT_PER_HOUR", "20"],
    ["MARKETPLACE_JOB_POST_LIMIT_PER_HOUR", "10"],
    ["MARKETPLACE_APPLICATION_LIMIT_PER_HOUR", "30"],
  ];
  for (const [name, fallback] of limits) {
    const raw = env[name];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1) {
      add("rate limits", "warn", `${name}="${raw}" is not a positive integer; using ${fallback}.`);
    }
  }

  return { ok: checks.every((check) => check.status !== "fail"), checks };
}
