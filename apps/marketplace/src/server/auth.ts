import * as NodeCrypto from "node:crypto";

import { AUTH_CODE_TTL_MINUTES, SESSION_COOKIE, type AccountRole } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { countRows, execute, queryAll, queryOne } from "./db.ts";
import { HttpError, badRequest, forbidden, unauthorized } from "./errors.ts";
import { parseCookies } from "./http.ts";
import type { AccountRow } from "./types.ts";
import { isSuspended } from "./admin.ts";
import { enqueueMail, sendLoginCode } from "./mail.ts";
import { describeUserAgent } from "./sessions.ts";
import { requireEmail, requireRole, type Body } from "./validate.ts";

export const AUTH_CODE_TTL_MS = AUTH_CODE_TTL_MINUTES * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_CODE_ATTEMPTS = 5;
export const RATE_LIMIT_WINDOW_MS = 15 * 60_000;
export const MAX_CODES_PER_EMAIL_IP = 5;
export const MAX_CODES_PER_IP = 20;

export interface AuthSession {
  readonly account: AccountRow;
  readonly sessionId: string;
  readonly expiresAt: string;
}

interface AuthCodeRow {
  readonly id: string;
  readonly codeSalt: string;
  readonly codeHash: string;
  readonly attempts: number;
  readonly expiresAt: string;
}

interface SessionRow {
  readonly sessionId: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly email: string;
  readonly role: AccountRole;
  readonly createdAt: string;
}

function sha256(value: string): string {
  return NodeCrypto.createHash("sha256").update(value).digest("hex");
}

function hashCode(salt: string, code: string): string {
  return sha256(`${salt}:${code}`);
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && NodeCrypto.timingSafeEqual(a, b);
}

export function findAccountByEmail(ctx: AppContext, email: string): AccountRow | undefined {
  return queryOne<AccountRow>(
    ctx.db,
    "SELECT id, email, role, created_at AS createdAt FROM accounts WHERE email = ?",
    [email],
  );
}

export function findAccountById(ctx: AppContext, id: string): AccountRow | undefined {
  return queryOne<AccountRow>(
    ctx.db,
    "SELECT id, email, role, created_at AS createdAt FROM accounts WHERE id = ?",
    [id],
  );
}

function createAccount(ctx: AppContext, email: string, role: AccountRole): AccountRow {
  const account: AccountRow = {
    id: NodeCrypto.randomUUID(),
    email,
    role,
    createdAt: ctx.now().toISOString(),
  };
  execute(ctx.db, "INSERT INTO accounts (id, email, role, created_at) VALUES (?, ?, ?, ?)", [
    account.id,
    account.email,
    account.role,
    account.createdAt,
  ]);
  return account;
}

/**
 * The address used for rate limiting. `x-marketplace-peer` is written by the
 * HTTP server from the real socket, so it cannot be spoofed over the wire. The
 * proxy headers are only honoured when the operator declared a trusted proxy;
 * otherwise every client would be free to invent a new identity per request.
 */
export function clientIp(request: Request, trustProxy = false): string {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded !== null) {
      const first = forwarded.split(",")[0];
      if (first !== undefined && first.trim() !== "") return first.trim();
    }
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp !== undefined && realIp !== "") return realIp;
  }
  const peer = request.headers.get("x-marketplace-peer")?.trim();
  return peer !== undefined && peer !== "" ? peer : "local";
}

export interface RequestCodeInput {
  readonly email: string;
  readonly role: AccountRole;
  readonly ip: string;
}

export async function requestCode(
  ctx: AppContext,
  input: RequestCodeInput,
): Promise<{
  account: AccountRow;
  expiresAt: string;
}> {
  const email = input.email.trim().toLowerCase();
  const existing = findAccountByEmail(ctx, email);
  // A role mismatch is not an error the caller gets to see: answering "this
  // email is a business" would turn the form into an account-enumeration oracle
  // (and leak the role) without needing the code. The email owns its account, so
  // the code goes to the real role and the dashboard shows it after login.
  const account = existing ?? createAccount(ctx, email, input.role);

  // A suspended account gets the same 200 as everyone else (no enumeration
  // signal) but no code: verifyCode explains the suspension if they try.
  if (isSuspended(ctx, account.id)) {
    return { account, expiresAt: new Date(ctx.now().getTime() + AUTH_CODE_TTL_MS).toISOString() };
  }

  const windowStart = new Date(ctx.now().getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const perEmail = countRows(
    ctx.db,
    "SELECT COUNT(*) AS count FROM auth_codes WHERE account_id = ? AND request_ip = ? AND created_at >= ?",
    [account.id, input.ip, windowStart],
  );
  if (perEmail >= MAX_CODES_PER_EMAIL_IP) {
    throw new HttpError(
      429,
      "rate_limited",
      "Too many login codes requested. Wait 15 minutes and try again.",
    );
  }
  const perIp = countRows(
    ctx.db,
    "SELECT COUNT(*) AS count FROM auth_codes WHERE request_ip = ? AND created_at >= ?",
    [input.ip, windowStart],
  );
  if (perIp >= MAX_CODES_PER_IP) {
    throw new HttpError(
      429,
      "rate_limited",
      "Too many login codes requested from this address. Wait 15 minutes and try again.",
    );
  }

  const code = String(NodeCrypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const salt = NodeCrypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(ctx.now().getTime() + AUTH_CODE_TTL_MS).toISOString();
  execute(
    ctx.db,
    `INSERT INTO auth_codes
      (id, account_id, code_salt, code_hash, attempts, consumed_at, expires_at, request_ip, created_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, ?, ?)`,
    [
      NodeCrypto.randomUUID(),
      account.id,
      salt,
      hashCode(salt, code),
      expiresAt,
      input.ip,
      ctx.now().toISOString(),
    ],
  );

  // The only place a login code is ever emitted. In dev it goes to the console
  // hook; otherwise it is mailed through the transport, with a durable outbox
  // fallback so a gateway outage delays the code instead of losing it. The code
  // never appears in an HTTP response.
  ctx.onDevCode?.(account.email, code);
  await sendLoginCode(ctx, {
    to: account.email,
    code,
    minutes: Math.round(AUTH_CODE_TTL_MS / 60_000),
  });

  return { account, expiresAt };
}

export interface VerifyCodeResult {
  readonly account: AccountRow;
  readonly token: string;
  readonly expiresAt: string;
}

export function verifyCode(
  ctx: AppContext,
  input: { readonly email: string; readonly code: string; readonly userAgent?: string },
): VerifyCodeResult {
  const account = findAccountByEmail(ctx, input.email);
  // Unknown address and known address with no live code get the identical
  // answer: telling them apart would let anyone probe which emails have
  // accounts without ever holding a code. Requesting a code fixes both.
  if (account === undefined) {
    throw unauthorized("No active login code. Request a new one.", "no_active_code");
  }
  if (isSuspended(ctx, account.id)) {
    throw forbidden(
      "This account is suspended. Contact support if you think this is a mistake.",
      "account_suspended",
    );
  }

  const row = queryOne<AuthCodeRow>(
    ctx.db,
    `SELECT id, code_salt AS codeSalt, code_hash AS codeHash, attempts, expires_at AS expiresAt
     FROM auth_codes
     WHERE account_id = ? AND consumed_at IS NULL
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
    [account.id],
  );
  if (row === undefined) {
    throw unauthorized("No active login code. Request a new one.", "no_active_code");
  }
  if (row.expiresAt <= ctx.now().toISOString()) {
    throw unauthorized("This login code has expired. Request a new one.", "code_expired");
  }
  if (row.attempts >= MAX_CODE_ATTEMPTS) {
    throw new HttpError(429, "too_many_attempts", "Too many attempts. Request a new login code.");
  }

  const attempts = row.attempts + 1;
  execute(ctx.db, "UPDATE auth_codes SET attempts = ? WHERE id = ?", [attempts, row.id]);

  if (!hashesEqual(hashCode(row.codeSalt, input.code), row.codeHash)) {
    if (attempts >= MAX_CODE_ATTEMPTS) {
      throw new HttpError(429, "too_many_attempts", "Too many attempts. Request a new login code.");
    }
    const remaining = MAX_CODE_ATTEMPTS - attempts;
    throw unauthorized(
      `Email or code is incorrect. ${remaining} attempt${remaining === 1 ? "" : "s"} left.`,
      "invalid_code",
    );
  }

  execute(ctx.db, "UPDATE auth_codes SET consumed_at = ? WHERE id = ?", [
    ctx.now().toISOString(),
    row.id,
  ]);

  const userAgent = (input.userAgent ?? "").slice(0, 300);
  if (userAgent !== "") {
    const knownDevices = queryAll<{ userAgent: string }>(
      ctx.db,
      `SELECT DISTINCT user_agent AS userAgent FROM sessions
       WHERE account_id = ? AND expires_at > ?`,
      [account.id, ctx.now().toISOString()],
    );
    const seen = knownDevices.some((row) => row.userAgent === userAgent);
    if (knownDevices.length > 0 && !seen) {
      // Security mail, not a notification: always sent, independent of the
      // email-notifications preference, because a new device is how account
      // takeover looks from the outside.
      enqueueMail(ctx, {
        to: account.email,
        subject: "CodeitLab — new sign-in to your account",
        text: `Someone signed in to your CodeitLab account from a device we have not seen before.\n\nDevice: ${describeUserAgent(userAgent)}\nWhen: ${ctx.now().toISOString()}\n\nIf this was you, nothing to do. If it was not, open Active sessions and sign out every device:\n${ctx.baseUrl}/dashboard#sessions\n\nYou get this email because a new device signed in; it is not a marketing message.`,
      });
    }
  }

  const token = NodeCrypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(ctx.now().getTime() + SESSION_TTL_MS).toISOString();
  execute(
    ctx.db,
    `INSERT INTO sessions (id, account_id, token_hash, created_at, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      NodeCrypto.randomUUID(),
      account.id,
      sha256(token),
      ctx.now().toISOString(),
      expiresAt,
      userAgent,
    ],
  );

  return { account, token, expiresAt };
}

export function authenticate(ctx: AppContext, request: Request): AuthSession | null {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (token === undefined || token === "") return null;

  const row = queryOne<SessionRow>(
    ctx.db,
    `SELECT s.id AS sessionId, s.expires_at AS expiresAt,
            a.id AS id, a.email AS email, a.role AS role, a.created_at AS createdAt
     FROM sessions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = ?`,
    [sha256(token)],
  );
  if (row === undefined) return null;

  if (isSuspended(ctx, row.id)) {
    execute(ctx.db, "DELETE FROM sessions WHERE id = ?", [row.sessionId]);
    return null;
  }

  if (row.expiresAt <= ctx.now().toISOString()) {
    execute(ctx.db, "DELETE FROM sessions WHERE id = ?", [row.sessionId]);
    return null;
  }

  return {
    account: {
      id: row.id,
      email: row.email,
      role: row.role,
      createdAt: row.createdAt,
    },
    sessionId: row.sessionId,
    expiresAt: row.expiresAt,
  };
}

export function logout(ctx: AppContext, request: Request): void {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (token === undefined || token === "") return;
  execute(ctx.db, "DELETE FROM sessions WHERE token_hash = ?", [sha256(token)]);
}

export function sessionCookie(ctx: AppContext, token: string, maxAgeSeconds: number): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    `Path=${ctx.basePath === "" ? "/" : ctx.basePath}`,
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (ctx.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookieFor(ctx: AppContext, token: string): string {
  return sessionCookie(ctx, token, Math.floor(SESSION_TTL_MS / 1000));
}

export function clearedSessionCookie(ctx: AppContext): string {
  return sessionCookie(ctx, "", 0);
}

export function readCredentials(body: Body): { email: string; role: AccountRole } {
  return { email: requireEmail(body), role: requireRole(body) };
}

export function readLoginCode(body: Body): { email: string; code: string } {
  const email = requireEmail(body);
  const raw = body.code;
  const code = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{6}$/u.test(code)) throw badRequest("Enter the six-digit code.", "invalid_code");
  return { email, code };
}
