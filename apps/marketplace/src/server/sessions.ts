import type { AppContext } from "./context.ts";
import { executeChanges, queryAll } from "./db.ts";
import { badRequest, notFound } from "./errors.ts";

export interface SessionInfo {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  /** Short, human label derived from the User-Agent at sign-in. */
  readonly device: string;
  readonly current: boolean;
}

interface SessionRow {
  readonly id: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly userAgent: string;
}

/** A label a person can recognise, not a User-Agent string they cannot read. */
export function describeUserAgent(userAgent: string): string {
  const ua = userAgent.trim();
  if (ua === "") return "Unknown device";
  const browser = /Edg\//u.test(ua)
    ? "Edge"
    : /OPR\//u.test(ua)
      ? "Opera"
      : /Chrome\//u.test(ua)
        ? "Chrome"
        : /Firefox\//u.test(ua)
          ? "Firefox"
          : /Safari\//u.test(ua)
            ? "Safari"
            : "Browser";
  const system = /iPhone/u.test(ua)
    ? "iPhone"
    : /iPad/u.test(ua)
      ? "iPad"
      : /Android/u.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/u.test(ua)
          ? "macOS"
          : /Windows/u.test(ua)
            ? "Windows"
            : /Linux/u.test(ua)
              ? "Linux"
              : "device";
  return `${browser} on ${system}`;
}

export function listSessions(
  ctx: AppContext,
  accountId: string,
  currentSessionId: string,
): SessionInfo[] {
  const now = ctx.now().toISOString();
  return queryAll<SessionRow>(
    ctx.db,
    `SELECT id, created_at AS createdAt, expires_at AS expiresAt, user_agent AS userAgent
     FROM sessions WHERE account_id = ? AND expires_at > ?
     ORDER BY created_at DESC, rowid DESC`,
    [accountId, now],
  ).map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    device: describeUserAgent(row.userAgent),
    current: row.id === currentSessionId,
  }));
}

/** Sign out every other device; the session making the request stays. */
/** Admin path: sign every device out of one account (lost laptop, compromise). */
export function revokeAllSessions(ctx: AppContext, accountId: string): number {
  return executeChanges(ctx.db, "DELETE FROM sessions WHERE account_id = ?", [accountId]);
}

export function revokeOtherSessions(
  ctx: AppContext,
  accountId: string,
  currentSessionId: string,
): number {
  return executeChanges(ctx.db, "DELETE FROM sessions WHERE account_id = ? AND id != ?", [
    accountId,
    currentSessionId,
  ]);
}

export function revokeSession(
  ctx: AppContext,
  accountId: string,
  sessionId: string,
  currentSessionId: string,
): boolean {
  if (sessionId === currentSessionId) {
    throw badRequest("Use sign out to end this session.", "current_session");
  }
  const removed = executeChanges(ctx.db, "DELETE FROM sessions WHERE account_id = ? AND id = ?", [
    accountId,
    sessionId,
  ]);
  if (removed === 0) throw notFound("That session is already gone.", "session_not_found");
  return true;
}
