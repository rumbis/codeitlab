import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, executeChanges, queryAll, queryOne } from "./db.ts";
import { badRequest, notFound } from "./errors.ts";
import type { AccountRow } from "./types.ts";

/**
 * Account API tokens. The desktop app needs to call the user's own marketplace
 * deployment without a browser session; the admin token is not an account
 * credential, so account endpoints get their own long-lived token.
 *
 * Only the hash of a token is stored. The raw value is returned once, at
 * creation, and can never be read back out of the database.
 */

export const DEFAULT_API_TOKEN_LABEL = "CodeItLab";
export const MAX_API_TOKEN_LABEL_LENGTH = 60;
const TOKEN_PREFIX = "mk_";

export interface ApiTokenRecord {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

interface ApiTokenRow {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

interface ResolvedTokenRow extends AccountRow {
  readonly tokenId: string;
  readonly suspendedAt: string | null;
  readonly deletedAt: string | null;
}

function hashToken(rawToken: string): string {
  return NodeCrypto.createHash("sha256").update(rawToken).digest("hex");
}

/** An omitted label gets the default; an explicitly empty or long one is a 400. */
function readTokenLabel(raw: unknown): string {
  if (raw === undefined || raw === null) return DEFAULT_API_TOKEN_LABEL;
  if (typeof raw !== "string") throw badRequest("Token label must be text.", "invalid_label");
  const label = raw.trim();
  if (label.length === 0 || label.length > MAX_API_TOKEN_LABEL_LENGTH) {
    throw badRequest(
      `Token label must be 1 to ${MAX_API_TOKEN_LABEL_LENGTH} characters.`,
      "invalid_label",
    );
  }
  return label;
}

export function createApiToken(
  ctx: AppContext,
  account: AccountRow,
  rawLabel: unknown,
): { readonly token: string; readonly record: Omit<ApiTokenRecord, "lastUsedAt"> } {
  const label = readTokenLabel(rawLabel);
  const token = `${TOKEN_PREFIX}${NodeCrypto.randomBytes(32).toString("base64url")}`;
  const record = {
    id: NodeCrypto.randomUUID(),
    label,
    createdAt: ctx.now().toISOString(),
  };
  execute(
    ctx.db,
    `INSERT INTO api_tokens (id, account_id, token_hash, label, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [record.id, account.id, hashToken(token), label, record.createdAt],
  );
  return { token, record };
}

export function listApiTokens(ctx: AppContext, accountId: string): ApiTokenRecord[] {
  return queryAll<ApiTokenRow>(
    ctx.db,
    `SELECT id, label, created_at AS createdAt, last_used_at AS lastUsedAt
     FROM api_tokens WHERE account_id = ? ORDER BY created_at DESC, rowid DESC`,
    [accountId],
  );
}

/** Deleting another account's id is a 404, not a 403: the id is not theirs to know. */
export function revokeApiToken(ctx: AppContext, accountId: string, id: string): boolean {
  const removed = executeChanges(ctx.db, "DELETE FROM api_tokens WHERE id = ? AND account_id = ?", [
    id,
    accountId,
  ]);
  if (removed === 0) throw notFound("That API token does not exist.", "token_not_found");
  return true;
}

/**
 * Turns an `Authorization: Bearer` value into the account it belongs to, or
 * null when the token is unknown, revoked or its account is suspended. Usage is
 * recorded on every call so the token list can show a credential that is still
 * being used after the user thought they were done with it.
 */
export function resolveBearerAccount(ctx: AppContext, rawToken: string): AccountRow | null {
  const token = rawToken.trim();
  if (token === "") return null;
  const row = queryOne<ResolvedTokenRow>(
    ctx.db,
    `SELECT a.id, a.email, a.role, a.created_at AS createdAt, t.id AS tokenId,
            a.suspended_at AS suspendedAt, a.deleted_at AS deletedAt
     FROM api_tokens t JOIN accounts a ON a.id = t.account_id
     WHERE t.token_hash = ?`,
    [hashToken(token)],
  );
  if (row === undefined || row.suspendedAt !== null || row.deletedAt !== null) return null;
  execute(ctx.db, "UPDATE api_tokens SET last_used_at = ? WHERE id = ?", [
    ctx.now().toISOString(),
    row.tokenId,
  ]);
  return { id: row.id, email: row.email, role: row.role, createdAt: row.createdAt };
}
