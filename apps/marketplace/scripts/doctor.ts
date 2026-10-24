/**
 * Production preflight: `pnpm --filter @t3tools/marketplace doctor`.
 * Exits 1 if any check fails (a warn does not block, but read it).
 */
import { runDoctor } from "../src/server/doctor.ts";

const report = runDoctor(process.env as Record<string, string | undefined>);
const icon = { ok: "ok  ", warn: "warn", fail: "FAIL" } as const;
for (const check of report.checks) {
  console.log(`${icon[check.status]}  ${check.name}: ${check.detail}`);
}
const failed = report.checks.filter((check) => check.status === "fail").length;
const warned = report.checks.filter((check) => check.status === "warn").length;
console.log(`\n${report.ok ? "READY" : "NOT READY"} — ${failed} failed, ${warned} warnings`);
if (!report.ok) process.exitCode = 1;
