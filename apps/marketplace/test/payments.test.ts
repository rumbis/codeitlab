import * as NodeHttp from "node:http";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  createMockPaymentProvider,
  createPaymentProvider,
  createStripePaymentProvider,
  PaymentProviderError,
} from "../src/server/payments.ts";
import {
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type TestApp,
} from "./helpers.ts";

interface RecordedRequest {
  path: string;
  headers: NodeHttp.IncomingHttpHeaders;
  body: string;
}

interface FakeStripe {
  apiBase: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

type Reply = { status: number; body: unknown };

async function startFakeStripe(reply: (request: RecordedRequest) => Reply): Promise<FakeStripe> {
  const requests: RecordedRequest[] = [];
  const server = NodeHttp.createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const request: RecordedRequest = {
        path: incoming.url ?? "/",
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      requests.push(request);
      const result = reply(request);
      outgoing.statusCode = result.status;
      outgoing.setHeader("content-type", "application/json");
      outgoing.end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fake stripe did not bind");
  return {
    apiBase: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let fakes: FakeStripe[] = [];
let apps: TestApp[] = [];

afterEach(async () => {
  for (const app of apps) app.close();
  apps = [];
  for (const fake of fakes) await fake.close();
  fakes = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp(overrides);
  apps.push(app);
  return app;
}

describe("idempotent mock provider", () => {
  it("settles one intent per idempotency key", async () => {
    const provider = createMockPaymentProvider();
    const first = await provider.charge({
      amountCents: 10_000,
      currency: "EUR",
      description: "Escrow",
      reference: "job_1",
      idempotencyKey: "engagement:e1:charge",
    });
    const retry = await provider.charge({
      amountCents: 10_000,
      currency: "EUR",
      description: "Escrow",
      reference: "job_1",
      idempotencyKey: "engagement:e1:charge",
    });
    expect(retry.paymentRef).toBe(first.paymentRef);
    expect(provider.intents).toHaveLength(1);

    const other = await provider.charge({
      amountCents: 10_000,
      currency: "EUR",
      description: "Escrow",
      reference: "job_1",
      idempotencyKey: "engagement:e2:charge",
    });
    expect(other.paymentRef).not.toBe(first.paymentRef);
    expect(provider.intents).toHaveLength(2);
  });
});

describe("stripe provider", () => {
  it("charges through payment_intents with auth, idempotency and metadata", async () => {
    const fake = await startFakeStripe(() => ({
      status: 200,
      body: { id: "pi_test_123", status: "succeeded" },
    }));
    fakes.push(fake);
    const provider = createStripePaymentProvider({
      secretKey: "sk_test_123",
      connectedAccountId: "acct_test_123",
      apiBase: fake.apiBase,
    });

    const result = await provider.charge({
      amountCents: 12_000,
      currency: "EUR",
      description: 'Escrow for "Booking flow"',
      reference: "job_1",
      idempotencyKey: "engagement:e1:charge",
    });
    expect(result).toEqual({ paymentRef: "pi_test_123", settled: true });

    expect(fake.requests).toHaveLength(1);
    const request = fake.requests[0];
    expect(request?.path).toBe("/v1/payment_intents");
    expect(request?.headers.authorization).toBe("Bearer sk_test_123");
    expect(request?.headers["idempotency-key"]).toBe("engagement:e1:charge");
    expect(request?.headers["content-type"]).toContain("application/x-www-form-urlencoded");
    const body = new URLSearchParams(request?.body ?? "");
    expect(body.get("amount")).toBe("12000");
    expect(body.get("currency")).toBe("eur");
    expect(body.get("metadata[reference]")).toBe("job_1");
  });

  it("pays out with a transfer to the connected account", async () => {
    const fake = await startFakeStripe(() => ({
      status: 200,
      body: { id: "tr_test_123", object: "transfer" },
    }));
    fakes.push(fake);
    const provider = createStripePaymentProvider({
      secretKey: "sk_test_123",
      connectedAccountId: "acct_test_123",
      apiBase: fake.apiBase,
    });

    const result = await provider.payout({
      amountCents: 10_200,
      currency: "EUR",
      reference: "engagement_1",
      idempotencyKey: "engagement:engagement_1:payout",
    });
    expect(result).toEqual({ paymentRef: "tr_test_123", settled: true });
    const body = new URLSearchParams(fake.requests[0]?.body ?? "");
    expect(fake.requests[0]?.path).toBe("/v1/transfers");
    expect(body.get("destination")).toBe("acct_test_123");
    expect(body.get("amount")).toBe("10200");
  });

  it("surfaces a declined charge as a typed provider error", async () => {
    const fake = await startFakeStripe(() => ({
      status: 402,
      body: { error: { code: "card_declined", message: "Your card was declined." } },
    }));
    fakes.push(fake);
    const provider = createStripePaymentProvider({
      secretKey: "sk_test_123",
      connectedAccountId: "acct_test_123",
      apiBase: fake.apiBase,
    });

    await expect(
      provider.charge({
        amountCents: 12_000,
        currency: "EUR",
        description: "Escrow",
        reference: "job_1",
        idempotencyKey: "engagement:e1:charge",
      }),
    ).rejects.toBeInstanceOf(PaymentProviderError);

    await expect(
      provider.charge({
        amountCents: 12_000,
        currency: "EUR",
        description: "Escrow",
        reference: "job_1",
        idempotencyKey: "engagement:e1:charge",
      }),
    ).rejects.toMatchObject({ status: 402, providerCode: "card_declined" });
  });

  it("refuses to start stripe without keys", () => {
    expect(() =>
      createPaymentProvider("stripe", { secretKey: "", connectedAccountId: "" }),
    ).toThrow(/STRIPE_SECRET_KEY/);
    const provider = createPaymentProvider("stripe", {
      secretKey: "sk_test_123",
      connectedAccountId: "acct_test_123",
      apiBase: "http://127.0.0.1:9",
    });
    expect(provider.name).toBe("stripe");
  });
});

describe("escrow through a real provider shape", () => {
  async function setup(app: TestApp) {
    const business = await app.signIn("owner@stripe.test", "business");
    const coder = await app.signIn("coder@stripe.test", "coder");
    const profile = await createCoderProfile(app, coder.cookie, {
      displayName: "Ada",
      skills: "TypeScript",
    });
    await approveCoder(app, profile.id);
    const job = await createJob(app, business.cookie, { skills: "TypeScript" });
    return { business, coder, profile, job };
  }

  it("stores the provider intent id and charges once across a retried request", async () => {
    const fake = await startFakeStripe(() => ({
      status: 200,
      body: { id: "pi_e2e_1", status: "succeeded" },
    }));
    fakes.push(fake);
    const provider = createStripePaymentProvider({
      secretKey: "sk_test_123",
      connectedAccountId: "acct_test_123",
      apiBase: fake.apiBase,
    });
    const app = newApp({ autoApprove: true, paymentProvider: provider });
    const { business, profile, job } = await setup(app);

    const created = await app.json<{ engagement: { id: string; paymentRef: string } }>(
      "/api/engagements",
      {
        method: "POST",
        cookie: business.cookie,
        body: { jobId: job.id, coderId: profile.id, amountCents: 9000 },
      },
    );
    expect(created.response.status).toBe(201);
    expect(created.body.engagement.paymentRef).toBe("pi_e2e_1");
    expect(fake.requests[0]?.headers["idempotency-key"]).toBe(
      `engagement:${created.body.engagement.id}:charge`,
    );
  });

  it("returns 402 and keeps no reservation when the provider declines", async () => {
    const fake = await startFakeStripe(() => ({
      status: 402,
      body: { error: { code: "card_declined", message: "Your card was declined." } },
    }));
    fakes.push(fake);
    const provider = createStripePaymentProvider({
      secretKey: "sk_test_123",
      connectedAccountId: "acct_test_123",
      apiBase: fake.apiBase,
    });
    const app = newApp({ autoApprove: true, paymentProvider: provider });
    const { business, profile, job } = await setup(app);

    const created = await app.json<{ error: string }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 9000 },
    });
    expect(created.response.status).toBe(402);
    expect(created.body.error).toBe("card_declined");

    const list = await app.json<{ engagements: unknown[] }>("/api/engagements", {
      cookie: business.cookie,
    });
    expect(list.body.engagements).toHaveLength(0);
  });
});
