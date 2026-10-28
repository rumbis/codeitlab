import type { PaymentProvider } from "./payments.ts";

export interface SandboxCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface SandboxResult {
  readonly ok: boolean;
  readonly provider: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly chargeRef: string;
  readonly retryRef: string;
  readonly payoutRef: string;
  readonly checks: readonly SandboxCheck[];
}

/**
 * The only key this harness accepts. A live key would move real money from a
 * test script, so it is rejected before any request is made — the check lives
 * here, not only in the CLI, so an embedder cannot skip it.
 */
export function validateSandboxKey(secretKey: string | undefined): void {
  if (secretKey === undefined || secretKey.trim() === "") {
    throw new Error(
      "Set STRIPE_SECRET_KEY to a test-mode key (sk_test_...). The sandbox never runs without one.",
    );
  }
  if (secretKey.trim().startsWith("sk_live_")) {
    throw new Error(
      "Refusing to run with a live key. This harness is for test mode only (sk_test_...).",
    );
  }
  if (!secretKey.trim().startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key starting with sk_test_.");
  }
}

/**
 * One real round trip against the provider: charge, the same charge retried with
 * the same idempotency key (must not create a second intent), and a payout. The
 * point is to prove the provider contract the marketplace depends on, before a
 * real engagement depends on it.
 */
export async function runPaymentSandbox(options: {
  readonly provider: PaymentProvider;
  readonly amountCents?: number;
  readonly currency?: string;
  readonly log?: (line: string) => void;
}): Promise<SandboxResult> {
  const amountCents = Math.max(options.amountCents ?? 1_234, 1);
  const currency = (options.currency ?? "eur").toLowerCase();
  const log = options.log ?? (() => {});
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const chargeKey = `sandbox:${stamp}:charge`;
  const payoutKey = `sandbox:${stamp}:payout`;
  const reference = `sandbox_${stamp}`;

  log(`charging ${amountCents} ${currency.toUpperCase()} through ${options.provider.name}`);
  const charge = await options.provider.charge({
    amountCents,
    currency,
    description: "CodeItLab marketplace sandbox charge",
    reference,
    idempotencyKey: chargeKey,
  });

  log("retrying the same charge with the same idempotency key");
  const retry = await options.provider.charge({
    amountCents,
    currency,
    description: "CodeItLab marketplace sandbox charge",
    reference,
    idempotencyKey: chargeKey,
  });

  log(
    `paying out ${Math.max(amountCents - Math.round(amountCents * 0.15), 1)} ${currency.toUpperCase()}`,
  );
  const payout = await options.provider.payout({
    amountCents: Math.max(amountCents - Math.round(amountCents * 0.15), 1),
    currency,
    reference,
    idempotencyKey: payoutKey,
  });

  const checks: SandboxCheck[] = [
    {
      name: "charge settled",
      ok: charge.settled,
      detail: `charge ${charge.paymentRef} settled=${String(charge.settled)}`,
    },
    {
      name: "retry is idempotent",
      ok: retry.paymentRef === charge.paymentRef,
      detail: `retry returned ${retry.paymentRef} (expected ${charge.paymentRef})`,
    },
    {
      name: "payout settled",
      ok: payout.settled,
      detail: `payout ${payout.paymentRef} settled=${String(payout.settled)}`,
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    provider: options.provider.name,
    amountCents,
    currency,
    chargeRef: charge.paymentRef,
    retryRef: retry.paymentRef,
    payoutRef: payout.paymentRef,
    checks,
  };
}
