import * as NodeCrypto from "node:crypto";

export interface ChargeInput {
  readonly amountCents: number;
  readonly currency: string;
  readonly description: string;
  readonly reference: string;
  /** Provider idempotency key; retries with the same key must charge once. */
  readonly idempotencyKey: string;
}

export interface ChargeResult {
  readonly paymentRef: string;
  readonly settled: boolean;
}

export interface PayoutInput {
  readonly amountCents: number;
  readonly currency: string;
  readonly reference: string;
  readonly idempotencyKey: string;
}

export interface PayoutResult {
  readonly paymentRef: string;
  readonly settled: boolean;
}

export interface PaymentIntent {
  readonly kind: "charge" | "payout";
  readonly amountCents: number;
  readonly currency: string;
  readonly paymentRef: string;
  readonly reference: string;
  readonly idempotencyKey: string;
  readonly settledAt: string;
}

/**
 * The escrow state machine only ever asks for "charge this" and "pay out this".
 * A Stripe provider can implement this without the state machine learning about
 * webhooks, intents or delayed capture.
 */
export interface PaymentProvider {
  readonly name: string;
  /** Intents settled by the in-process mock provider, oldest first. */
  readonly intents?: readonly PaymentIntent[];
  charge(input: ChargeInput): Promise<ChargeResult>;
  payout(input: PayoutInput): Promise<PayoutResult>;
}

/**
 * Development provider: settles immediately and records every intent in memory
 * so a local run can be inspected. No card data ever touches this service.
 * Idempotency keys are honoured here too, so a retried request cannot create a
 * second intent even in development.
 */
export function createMockPaymentProvider(): PaymentProvider {
  const intents: PaymentIntent[] = [];
  const byKey = new Map<string, PaymentIntent>();

  function settle(
    kind: "charge" | "payout",
    input: { amountCents: number; currency: string; reference: string; idempotencyKey: string },
  ): PaymentIntent {
    const existing = byKey.get(input.idempotencyKey);
    if (existing !== undefined) return existing;
    const intent: PaymentIntent = {
      kind,
      amountCents: input.amountCents,
      currency: input.currency,
      paymentRef: `mock_${kind}_${NodeCrypto.randomUUID()}`,
      reference: input.reference,
      idempotencyKey: input.idempotencyKey,
      settledAt: new Date().toISOString(),
    };
    intents.push(intent);
    byKey.set(input.idempotencyKey, intent);
    return intent;
  }

  return {
    name: "mock",
    intents,
    async charge(input) {
      const intent = settle("charge", input);
      return { paymentRef: intent.paymentRef, settled: true };
    },
    async payout(input) {
      const intent = settle("payout", input);
      return { paymentRef: intent.paymentRef, settled: true };
    },
  };
}

export class PaymentProviderError extends Error {
  readonly status: number;
  readonly providerCode: string;

  constructor(status: number, providerCode: string, message: string) {
    super(message);
    this.name = "PaymentProviderError";
    this.status = status;
    this.providerCode = providerCode;
  }
}

export interface StripeProviderOptions {
  readonly secretKey: string;
  /** Connected account that receives payouts (`acct_...`). */
  readonly connectedAccountId: string;
  /** Defaults to https://api.stripe.com; tests point this at a fake server. */
  readonly apiBase?: string;
  /** Injected for tests; defaults to global fetch. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

interface StripeObject {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly error?: { readonly message?: unknown; readonly code?: unknown };
}

/**
 * Real money, behind the same two-method interface. Charges are PaymentIntents
 * (automatic capture, money lands in the platform balance) and payouts are
 * Transfers to the connected account. Every call carries an idempotency key, so
 * the provider itself guarantees one charge per engagement even if the request
 * is retried after a timeout.
 */
export function createStripePaymentProvider(options: StripeProviderOptions): PaymentProvider {
  const apiBase = (options.apiBase ?? "https://api.stripe.com").replace(/\/+$/u, "");
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function post(
    path: string,
    idempotencyKey: string,
    body: URLSearchParams,
  ): Promise<StripeObject> {
    const response = await request(`${apiBase}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": idempotencyKey,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });

    let payload: StripeObject = {};
    try {
      payload = (await response.json()) as StripeObject;
    } catch {
      // A non-JSON error body still has to fail loudly, not silently.
      payload = {};
    }
    if (!response.ok) {
      const code =
        typeof payload.error?.code === "string" ? payload.error.code : `http_${response.status}`;
      const message =
        typeof payload.error?.message === "string"
          ? payload.error.message
          : `Payment provider returned ${response.status}.`;
      throw new PaymentProviderError(response.status, code, message);
    }
    return payload;
  }

  return {
    name: "stripe",
    async charge(input) {
      const body = new URLSearchParams({
        amount: String(input.amountCents),
        currency: input.currency.toLowerCase(),
        description: input.description.slice(0, 350),
        "automatic_payment_methods[enabled]": "true",
        "metadata[reference]": input.reference,
      });
      const intent = await post("/v1/payment_intents", input.idempotencyKey, body);
      if (typeof intent.id !== "string" || intent.id === "") {
        throw new PaymentProviderError(502, "invalid_response", "Charge returned no id.");
      }
      const status = typeof intent.status === "string" ? intent.status : "";
      return { paymentRef: intent.id, settled: status === "succeeded" || status === "processing" };
    },
    async payout(input) {
      const body = new URLSearchParams({
        amount: String(input.amountCents),
        currency: input.currency.toLowerCase(),
        destination: options.connectedAccountId,
        "metadata[reference]": input.reference,
      });
      const transfer = await post("/v1/transfers", input.idempotencyKey, body);
      if (typeof transfer.id !== "string" || transfer.id === "") {
        throw new PaymentProviderError(502, "invalid_response", "Payout returned no id.");
      }
      return { paymentRef: transfer.id, settled: true };
    },
  };
}

export interface ProviderConfig {
  readonly secretKey?: string;
  readonly connectedAccountId?: string;
  readonly apiBase?: string;
  readonly fetch?: typeof fetch;
}

/**
 * Provider selection. `stripe` refuses to start without its keys, so a deploy
 * cannot accidentally run real charges against a half-configured provider.
 */
export function createPaymentProvider(name: string, config: ProviderConfig = {}): PaymentProvider {
  if (name === "mock") return createMockPaymentProvider();
  if (name === "stripe") {
    const secretKey = config.secretKey ?? process.env.STRIPE_SECRET_KEY ?? "";
    const connectedAccountId =
      config.connectedAccountId ?? process.env.STRIPE_CONNECTED_ACCOUNT_ID ?? "";
    if (secretKey === "" || connectedAccountId === "") {
      throw new Error(
        'PAYMENTS_PROVIDER="stripe" needs STRIPE_SECRET_KEY and STRIPE_CONNECTED_ACCOUNT_ID.',
      );
    }
    return createStripePaymentProvider({
      secretKey,
      connectedAccountId,
      apiBase: config.apiBase ?? process.env.STRIPE_API_BASE,
      fetch: config.fetch,
    });
  }
  throw new Error(`PAYMENTS_PROVIDER="${name}" is not implemented. Use "mock" or "stripe".`);
}
