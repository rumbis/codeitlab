import { describe, expect, it } from "vite-plus/test";

import { createMockPaymentProvider, type PaymentProvider } from "../src/server/payments.ts";
import { runPaymentSandbox, validateSandboxKey } from "../src/server/sandbox.ts";

describe("payment sandbox", () => {
  it("charges once, retries idempotently and pays out on the mock provider", async () => {
    const provider = createMockPaymentProvider();
    const result = await runPaymentSandbox({ provider, amountCents: 10_000, currency: "eur" });

    expect(result.ok).toBe(true);
    expect(result.retryRef).toBe(result.chargeRef);
    expect(result.payoutRef).toMatch(/^mock_payout_/u);
    expect(result.checks.map((check) => check.name)).toEqual([
      "charge settled",
      "retry is idempotent",
      "payout settled",
    ]);
    // The retry must not create a second intent: one charge + one payout.
    expect(provider.intents).toHaveLength(2);
    expect(provider.intents?.map((intent) => intent.kind)).toEqual(["charge", "payout"]);
  });

  it("reports a provider that does not settle", async () => {
    const provider: PaymentProvider = {
      name: "broken",
      charge: async () => ({ paymentRef: "ch_broken", settled: false }),
      payout: async () => ({ paymentRef: "po_broken", settled: false }),
    };
    const result = await runPaymentSandbox({ provider });
    expect(result.ok).toBe(false);
    expect(result.checks.filter((check) => !check.ok)).toHaveLength(2);
  });

  it("refuses live, missing and non-test keys", () => {
    expect(() => validateSandboxKey(undefined)).toThrow(/test-mode key/u);
    expect(() => validateSandboxKey("")).toThrow(/test-mode key/u);
    expect(() => validateSandboxKey("sk_live_123")).toThrow(/live key/u);
    expect(() => validateSandboxKey("pk_test_123")).toThrow(/sk_test_/u);
    expect(() => validateSandboxKey("sk_test_123")).not.toThrow();
  });
});
