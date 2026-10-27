/**
 * One-command verification against a real Stripe test-mode account:
 *
 *   STRIPE_SECRET_KEY=sk_test_... STRIPE_CONNECTED_ACCOUNT_ID=acct_... \
 *     pnpm --filter @codeitlab/marketplace stripe:sandbox
 *
 * Use `--mock` to run the same checks without any key. The harness refuses live
 * keys on purpose: it moves money, and only test mode is acceptable here.
 */
import { createPaymentProvider } from "../src/server/payments.ts";
import { runPaymentSandbox, validateSandboxKey } from "../src/server/sandbox.ts";

const args = new Set(process.argv.slice(2));
const mock = args.has("--mock");
const amountArg = process.argv.find((arg) => arg.startsWith("--amount="));
const amountCents = amountArg === undefined ? 1_234 : Number(amountArg.split("=")[1]);

async function main(): Promise<void> {
  let provider;
  if (mock) {
    provider = createPaymentProvider("mock");
  } else {
    validateSandboxKey(process.env.STRIPE_SECRET_KEY);
    provider = createPaymentProvider("stripe");
  }

  const result = await runPaymentSandbox({
    provider,
    amountCents,
    currency: process.env.SANDBOX_CURRENCY ?? "eur",
    log: (line) => console.log(`[sandbox] ${line}`),
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error("[sandbox] FAILED — the provider contract is not behaving as expected.");
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(`[sandbox] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
});
