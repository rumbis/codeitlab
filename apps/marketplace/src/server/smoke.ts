import { createApp } from "./app.ts";
import { createMockPaymentProvider } from "./payments.ts";

/**
 * One end-to-end pass over the money path against a fresh in-memory database:
 * sign in, publish a profile, post a job, apply, fund escrow, accept, start,
 * deliver, approve, read the receipt and the ledger. Every step asserts its own
 * response, so the script fails loudly at the first wiring mistake instead of
 * printing a green line over a broken flow.
 */
export interface SmokeStep {
  readonly name: string;
  readonly detail: string;
}

const ORIGIN = "http://marketplace.smoke";

export async function runSmoke(): Promise<readonly SmokeStep[]> {
  const steps: SmokeStep[] = [];
  const codes = new Map<string, string>();
  const app = createApp({
    dbPath: ":memory:",
    adminToken: "smoke-admin-token",
    devEmail: false,
    onDevCode: (email, code) => codes.set(email, code),
    paymentProvider: createMockPaymentProvider(),
  });

  const admin = { authorization: "Bearer smoke-admin-token" };

  async function call(
    path: string,
    options: {
      method?: string;
      cookie?: string;
      headers?: Record<string, string>;
      body?: unknown;
    } = {},
  ): Promise<Response> {
    return app(
      new Request(`${ORIGIN}${path}`, {
        method: options.method ?? "GET",
        headers: {
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
          ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
          ...options.headers,
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      }),
    );
  }

  async function json<T>(path: string, options: Parameters<typeof call>[1] = {}): Promise<T> {
    const response = await call(path, options);
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${path} answered ${response.status}: ${text.slice(0, 300)}`);
    }
    return (text === "" ? null : JSON.parse(text)) as T;
  }

  async function signIn(email: string, role: string): Promise<string> {
    await json("/api/auth/request-code", { method: "POST", body: { email, role } });
    const code = codes.get(email);
    if (code === undefined) throw new Error(`no login code captured for ${email}`);
    const response = await call("/api/auth/verify", {
      method: "POST",
      body: { email, code },
    });
    if (!response.ok) throw new Error(`verify failed for ${email}: ${response.status}`);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
    if (cookie === "") throw new Error(`verify set no session cookie for ${email}`);
    return cookie;
  }

  try {
    const business = await signIn("owner@smoke.test", "business");
    const coder = await signIn("coder@smoke.test", "coder");
    steps.push({ name: "sign in", detail: "two accounts, code auth, session cookies" });

    const profile = await json<{ coder: { id: string; approved: boolean } }>(
      "/api/coders/profile",
      {
        method: "POST",
        cookie: coder,
        body: {
          displayName: "Smoke Coder",
          headline: "Product engineer",
          bio: "I build small reliable web products end to end and ship them.",
          skills: "TypeScript, SQLite",
          interests: "web",
          skillLevels: "",
          evidence: "https://github.com/example/repo",
          availability: "full_time",
          rateMinCents: 5000,
          rateMaxCents: 9000,
          currency: "EUR",
          timezone: "Europe/Berlin",
          links: "",
        },
      },
    );
    if (profile.coder.approved) throw new Error("profile was approved before review");
    await json(`/api/admin/coders/${profile.coder.id}/approve`, {
      method: "POST",
      headers: admin,
    });
    steps.push({ name: "profile", detail: "created unapproved, then approved by an operator" });

    const job = await json<{ job: { id: string; title: string } }>("/api/jobs", {
      method: "POST",
      cookie: business,
      body: {
        title: "Smoke test booking flow",
        description:
          "Build a booking flow with availability, payments and a confirmation email for a small studio.",
        skills: "TypeScript, SQLite",
        category: "web",
        budgetMinCents: 5000,
        budgetMaxCents: 20_000,
        currency: "EUR",
        timeline: "2–3 weeks",
      },
    });
    steps.push({ name: "job", detail: `posted "${job.job.title}"` });

    await json(`/api/jobs/${job.job.id}/interests`, {
      method: "POST",
      cookie: coder,
      body: { message: "I can ship this in two weeks, with the migration and tests." },
    });
    steps.push({ name: "application", detail: "coder applied with a message" });

    const engagement = await json<{
      engagement: { id: string; status: string; payoutCents: number };
    }>("/api/engagements", {
      method: "POST",
      cookie: business,
      body: { jobId: job.job.id, coderId: profile.coder.id, amountCents: 12_000 },
    });
    steps.push({
      name: "escrow",
      detail: `charged ${String(engagement.engagement.payoutCents)} cents payout`,
    });

    for (const action of ["accept", "start"] as const) {
      await json(`/api/engagements/${engagement.engagement.id}/${action}`, {
        method: "POST",
        cookie: coder,
      });
    }
    await json(`/api/engagements/${engagement.engagement.id}/deliver`, {
      method: "POST",
      cookie: coder,
      body: {
        deliveryNote: "Booking flow is live on staging, PR has the migration and tests.",
        deliveryEvidence: "https://github.com/example/repo/pull/12\nhttps://staging.example.com",
      },
    });
    const approved = await json<{ engagement: { status: string } }>(
      `/api/engagements/${engagement.engagement.id}/approve`,
      { method: "POST", cookie: business },
    );
    if (approved.engagement.status !== "paid_out") {
      throw new Error(`approval left the engagement ${approved.engagement.status}`);
    }
    steps.push({ name: "delivery", detail: "delivered with evidence, approved, paid out" });

    const receipt = await call(`/engagements/${engagement.engagement.id}/receipt`, {
      cookie: business,
    });
    if (!receipt.ok) throw new Error(`receipt answered ${receipt.status}`);
    const receiptHtml = await receipt.text();
    for (const needle of ["Receipt", "€120.00", "€18.00", "€102.00", "Escrow charge"]) {
      if (!receiptHtml.includes(needle)) throw new Error(`receipt is missing ${needle}`);
    }
    steps.push({ name: "receipt", detail: "business receipt shows amount, fee, payout, ledger" });

    const ledger = await json<{
      totals: { chargedCents: number; feeCents: number; payoutCents: number; heldCents: number };
      entries: unknown[];
    }>("/api/admin/ledger", { headers: admin });
    if (ledger.totals.chargedCents !== 12_000) throw new Error("ledger charge mismatch");
    if (ledger.totals.feeCents !== 1_800) throw new Error("ledger fee mismatch");
    if (ledger.totals.payoutCents !== 10_200) throw new Error("ledger payout mismatch");
    if (ledger.totals.heldCents !== 0) throw new Error("ledger still holds money after payout");
    steps.push({
      name: "ledger",
      detail: `charge ${String(ledger.totals.chargedCents)}, fee ${String(ledger.totals.feeCents)}, payout ${String(ledger.totals.payoutCents)}, held 0`,
    });

    const health = await json<{ ok: boolean; schemaVersion: number }>("/health");
    if (!health.ok || health.schemaVersion !== 23) {
      throw new Error(`health reports schema ${String(health.schemaVersion)}`);
    }
    steps.push({ name: "health", detail: `ok, schema ${String(health.schemaVersion)}` });

    return steps;
  } finally {
    app.close();
  }
}
