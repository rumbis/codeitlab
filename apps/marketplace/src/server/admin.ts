import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { notFound, unauthorized } from "./errors.ts";
import { enqueueMail } from "./mail.ts";
import { consumeRateLimit } from "./ratelimit.ts";
import { hasAdminCookie } from "./security.ts";
import { revokeAllSessions } from "./sessions.ts";
import type { LedgerReport } from "./engagements.ts";
import { ledgerReport } from "./engagements.ts";

function tokenMatches(provided: string, expected: string): boolean {
  const left = NodeCrypto.createHash("sha256").update(provided).digest();
  const right = NodeCrypto.createHash("sha256").update(expected).digest();
  return NodeCrypto.timingSafeEqual(left, right);
}

/**
 * The admin surface is disabled unless MARKETPLACE_ADMIN_TOKEN is set. The token
 * may arrive as a bearer header or as `?token=` for the server-rendered page.
 */
export function requireAdmin(ctx: AppContext, request: Request, url: URL): void {
  if (ctx.adminToken === "") {
    throw notFound(
      "Admin is disabled. Set MARKETPLACE_ADMIN_TOKEN to enable it.",
      "admin_disabled",
    );
  }

  // A valid admin cookie is a session established by opening the page with the
  // token once; it never appears in the HTML.
  if (hasAdminCookie(ctx, request)) return;

  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
  const provided = bearer !== "" ? bearer : (url.searchParams.get("token") ?? "");

  if (provided === "" || !tokenMatches(provided, ctx.adminToken)) {
    // A wrong token is a guessing attempt: cap failures per peer so the token
    // cannot be brute-forced, and let a legitimate token keep working.
    consumeRateLimit(
      ctx,
      `admin_fail:${clientKey(request)}`,
      ADMIN_FAILURE_LIMIT_PER_HOUR,
      "Too many failed admin attempts. Try again later.",
    );
    throw unauthorized("A valid admin token is required.", "admin_unauthorized");
  }
}

/** Failures only; a valid token never consumes the bucket. */
export const ADMIN_FAILURE_LIMIT_PER_HOUR = 20;

function clientKey(request: Request): string {
  const peer = request.headers.get("x-marketplace-peer")?.trim();
  return peer !== undefined && peer !== "" ? peer : "local";
}

export interface AdminAccount {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly createdAt: string;
  readonly suspendedAt: string | null;
  readonly suspendedReason: string;
}

export interface AdminOverview {
  readonly accounts: number;
  readonly suspendedAccounts: number;
  readonly approvedCoders: number;
  readonly pendingCoders: number;
  readonly openJobs: number;
  readonly escrowEngagements: number;
  readonly openReports: number;
  readonly openDisputes: number;
  readonly deliveredAwaitingRelease: number;
  readonly queuedMail: number;
  readonly queuedPush: number;
}

function count(ctx: AppContext, sql: string): number {
  const row = queryOne<{ n: number }>(ctx.db, sql);
  return row === undefined ? 0 : Number(row.n);
}

/**
 * One screen for the person on call: how many people, how much money is held,
 * and what is waiting for a human. Counts only — no emails, no ids — so opening
 * the admin page never becomes a data dump.
 */
export function adminOverview(ctx: AppContext): AdminOverview {
  return {
    accounts: count(ctx, "SELECT COUNT(*) AS n FROM accounts"),
    suspendedAccounts: count(
      ctx,
      "SELECT COUNT(*) AS n FROM accounts WHERE suspended_at IS NOT NULL",
    ),
    approvedCoders: count(ctx, "SELECT COUNT(*) AS n FROM coder_profiles WHERE approved = 1"),
    pendingCoders: count(ctx, "SELECT COUNT(*) AS n FROM coder_profiles WHERE approved = 0"),
    openJobs: count(ctx, "SELECT COUNT(*) AS n FROM jobs WHERE status = 'open'"),
    escrowEngagements: count(
      ctx,
      "SELECT COUNT(*) AS n FROM engagements WHERE status IN ('requested', 'accepted', 'in_progress', 'delivered')",
    ),
    openReports: count(ctx, "SELECT COUNT(*) AS n FROM reports WHERE status = 'open'"),
    openDisputes: count(ctx, "SELECT COUNT(*) AS n FROM engagements WHERE status = 'disputed'"),
    deliveredAwaitingRelease: count(
      ctx,
      "SELECT COUNT(*) AS n FROM engagements WHERE status = 'delivered'",
    ),
    queuedMail: count(ctx, "SELECT COUNT(*) AS n FROM email_outbox WHERE delivered_at IS NULL"),
    queuedPush: count(ctx, "SELECT COUNT(*) AS n FROM push_outbox WHERE delivered_at IS NULL"),
  };
}

/**
 * Account lookup for an operator: search by email fragment, never a full dump.
 * An empty query returns nothing so the admin page cannot page through every
 * person who ever signed up.
 */
export function searchAccounts(ctx: AppContext, query: string, limit = 20): AdminAccount[] {
  const needle = query.trim();
  if (needle === "") return [];
  const bounded = Math.min(Math.max(limit, 1), 50);
  return queryAll<AdminAccount>(
    ctx.db,
    `SELECT id, email, role, created_at AS createdAt,
            suspended_at AS suspendedAt, suspended_reason AS suspendedReason
     FROM accounts
     WHERE email LIKE ?
     ORDER BY created_at DESC LIMIT ?`,
    [`%${needle}%`, bounded],
  );
}

export interface SuspensionResult {
  readonly accountId: string;
  readonly suspendedAt: string | null;
  readonly reason: string;
}

export function suspendAccount(
  ctx: AppContext,
  accountId: string,
  reason: string,
): SuspensionResult {
  const account = queryOne<{ id: string; email: string; suspendedAt: string | null }>(
    ctx.db,
    "SELECT id, email, suspended_at AS suspendedAt FROM accounts WHERE id = ?",
    [accountId],
  );
  if (account === undefined) throw notFound("No such account.", "account_not_found");
  const suspendedAt = ctx.now().toISOString();
  execute(ctx.db, "UPDATE accounts SET suspended_at = ?, suspended_reason = ? WHERE id = ?", [
    suspendedAt,
    reason,
    accountId,
  ]);
  const revoked = revokeAllSessions(ctx, accountId);
  recordAdminAction(ctx, {
    action: "account.suspended",
    targetId: accountId,
    detail: `${reason} (${revoked} session${revoked === 1 ? "" : "s"} revoked)`,
  });
  enqueueMail(ctx, {
    to: account.email,
    subject: "CodeItLab — your account is suspended",
    text: `Your CodeItLab account has been suspended.\n\nReason: ${reason}\n\nEvery device has been signed out. If you think this is a mistake, reply to this email or contact the address in security.txt.\n\nThis is a safety notice, not a marketing message.`,
  });
  return { accountId, suspendedAt, reason };
}

export function unsuspendAccount(ctx: AppContext, accountId: string): SuspensionResult {
  const account = queryOne<{ id: string }>(ctx.db, "SELECT id FROM accounts WHERE id = ?", [
    accountId,
  ]);
  if (account === undefined) throw notFound("No such account.", "account_not_found");
  execute(ctx.db, "UPDATE accounts SET suspended_at = NULL, suspended_reason = '' WHERE id = ?", [
    accountId,
  ]);
  recordAdminAction(ctx, {
    action: "account.unsuspended",
    targetId: accountId,
    detail: "Operator restored the account.",
  });
  return { accountId, suspendedAt: null, reason: "" };
}

export function isSuspended(ctx: AppContext, accountId: string): boolean {
  return (
    queryOne<{ suspendedAt: string | null }>(
      ctx.db,
      "SELECT suspended_at AS suspendedAt FROM accounts WHERE id = ?",
      [accountId],
    )?.suspendedAt != null
  );
}

export function adminLedger(ctx: AppContext): LedgerReport {
  return ledgerReport(ctx);
}

export interface AdminAuditEntry {
  readonly id: string;
  readonly action: string;
  readonly targetId: string;
  readonly detail: string;
  readonly createdAt: string;
}

/** Append-only: there is no update or delete path, by design. */
export function recordAdminAction(
  ctx: AppContext,
  input: { readonly action: string; readonly targetId: string; readonly detail: string },
): void {
  execute(
    ctx.db,
    "INSERT INTO admin_audit (id, action, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?)",
    [
      `audit_${NodeCrypto.randomUUID()}`,
      input.action,
      input.targetId,
      input.detail,
      ctx.now().toISOString(),
    ],
  );
}

export function listAdminAudit(ctx: AppContext, limit = 100): AdminAuditEntry[] {
  const bounded = Math.min(Math.max(limit, 1), 200);
  return queryAll<AdminAuditEntry>(
    ctx.db,
    `SELECT id, action, target_id AS targetId, detail, created_at AS createdAt
     FROM admin_audit ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [bounded],
  );
}
