import type * as NodeSqlite from "node:sqlite";

import type { PaymentProvider } from "./payments.ts";

/**
 * Everything the service modules and pages need. Tests build it through
 * `createApp`, so this type is the seam between HTTP and behavior.
 */
export interface AppContext {
  readonly db: NodeSqlite.DatabaseSync;
  /** The database file this process opened; ":memory:" cannot be backed up. */
  readonly dbPath: string;
  /** Where operator-triggered backups are written. */
  readonly backupDir: string;
  /** Prefix for every generated URL, e.g. "/market" behind the site proxy. */
  readonly basePath: string;
  /** Absolute origin for links that leave the app (email, meta tags). */
  readonly baseUrl: string;
  readonly adminToken: string;
  /**
   * Trust `x-forwarded-for` / `x-real-ip` from a reverse proxy. Off by default:
   * a client that can set those headers would otherwise pick its own rate-limit
   * bucket. Enable with MARKETPLACE_TRUST_PROXY=1 behind a real proxy.
   */
  readonly trustProxy: boolean;
  /** Where activity notifications are pushed; empty disables the outbox. */
  readonly notifyWebhook: string;
  /** HMAC key for the outbox signature; required when notifyWebhook is set. */
  readonly notifySecret: string;
  /** Delivers login codes and other mail; a failing send falls back to the outbox. */
  readonly mail: import("./mail.ts").MailTransport;
  /** VAPID keys for Web Push; null disables push (the API reports enabled:false). */
  readonly push: import("./push.ts").PushKeys | null;
  /** Per-account guards on money-path actions. */
  readonly rateLimits: import("./ratelimit.ts").RateLimitConfig;
  /** Stripe-style webhook signing secret; empty disables the webhook route. */
  readonly webhookSecret: string;
  readonly payments: PaymentProvider;
  readonly now: () => Date;
  readonly onDevCode?: (email: string, code: string) => void;
  readonly autoApprove: boolean;
  /** Days a delivery may wait before escrow auto-releases; 0 disables. */
  readonly autoReleaseDays: number;
  readonly cookieSecure: boolean;
}

export function nowIso(ctx: AppContext): string {
  return ctx.now().toISOString();
}

export function isoTimestamp(ctx: AppContext, offsetMs: number): string {
  return new Date(ctx.now().getTime() + offsetMs).toISOString();
}
