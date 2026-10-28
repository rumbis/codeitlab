/**
 * End-to-end smoke: `pnpm --filter @codeitlab/marketplace smoke`.
 * Runs the whole money path against a throwaway in-memory database and exits 1
 * on the first broken step. Safe to run on a deploy host: it touches nothing.
 */
import { runSmoke } from "../src/server/smoke.ts";

try {
  const steps = await runSmoke();
  for (const step of steps) console.log(`ok    ${step.name}: ${step.detail}`);
  console.log(`\nSMOKE OK — ${steps.length} steps`);
} catch (error) {
  console.error(`SMOKE FAILED — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
