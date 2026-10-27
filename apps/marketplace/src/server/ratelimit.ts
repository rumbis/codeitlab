import type { AppContext } from "./context.ts";
import { execute, queryOne } from "./db.ts";
import { tooManyRequests } from "./errors.ts";

export interface RateLimitConfig {
  /** Escrow charges a single business account may start per hour. */
  readonly chargePerHour: number;
  /** Engagement actions a single account may take per hour. */
  readonly transitionPerHour: number;
  /** Coder invitations a single business may send per hour. */
  readonly invitePerHour: number;
  /** Abuse reports a single account may file per hour. */
  readonly reportPerHour: number;
  /** Jobs a single business may post per hour. */
  readonly jobPostPerHour: number;
  /** Job applications a single coder may send per hour. */
  readonly applicationPerHour: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  chargePerHour: 10,
  transitionPerHour: 120,
  invitePerHour: 60,
  reportPerHour: 20,
  jobPostPerHour: 10,
  applicationPerHour: 30,
};

export const RATE_LIMIT_WINDOW_MS = 60 * 60_000;

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function rateLimitsFromEnv(
  env: Record<string, string | undefined> = process.env,
): RateLimitConfig {
  return {
    chargePerHour: positiveInteger(
      env.MARKETPLACE_CHARGE_LIMIT_PER_HOUR,
      DEFAULT_RATE_LIMITS.chargePerHour,
    ),
    transitionPerHour: positiveInteger(
      env.MARKETPLACE_TRANSITION_LIMIT_PER_HOUR,
      DEFAULT_RATE_LIMITS.transitionPerHour,
    ),
    invitePerHour: positiveInteger(
      env.MARKETPLACE_INVITE_LIMIT_PER_HOUR,
      DEFAULT_RATE_LIMITS.invitePerHour,
    ),
    reportPerHour: positiveInteger(
      env.MARKETPLACE_REPORT_LIMIT_PER_HOUR,
      DEFAULT_RATE_LIMITS.reportPerHour,
    ),
    jobPostPerHour: positiveInteger(
      env.MARKETPLACE_JOB_POST_LIMIT_PER_HOUR,
      DEFAULT_RATE_LIMITS.jobPostPerHour,
    ),
    applicationPerHour: positiveInteger(
      env.MARKETPLACE_APPLICATION_LIMIT_PER_HOUR,
      DEFAULT_RATE_LIMITS.applicationPerHour,
    ),
  };
}

/**
 * Sliding-window counter for actions that cost something: a provider charge, or
 * a state change that moves money. It is a guard against a stolen session or a
 * runaway client, not a fraud system — the limit is per account and high enough
 * that a real person never meets it.
 */
export function consumeRateLimit(
  ctx: AppContext,
  bucket: string,
  limit: number,
  message: string,
): void {
  const now = ctx.now();
  const windowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  // Prune this bucket's expired rows on the way in, so the table cannot grow
  // without bound on a long-lived deployment.
  execute(ctx.db, "DELETE FROM rate_events WHERE bucket = ? AND created_at < ?", [
    bucket,
    windowStart,
  ]);
  const row = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM rate_events WHERE bucket = ? AND created_at >= ?",
    [bucket, windowStart],
  );
  if (Number(row?.count ?? 0) >= limit) throw tooManyRequests(message, "rate_limited");
  execute(ctx.db, "INSERT INTO rate_events (bucket, created_at) VALUES (?, ?)", [
    bucket,
    now.toISOString(),
  ]);
}
