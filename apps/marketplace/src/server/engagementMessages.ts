import * as NodeCrypto from "node:crypto";

import type { AccountRole } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { badRequest, notFound } from "./errors.ts";
import type { AccountRow } from "./types.ts";
import { requireText, type Body } from "./validate.ts";

/**
 * Chat between the two sides of an engagement. It is deliberately separate from
 * the state machine: both sides can talk before, during and after delivery, and
 * a message never moves money or changes status. Messages are append-only.
 */

export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_MESSAGE_EVIDENCE = 10;
export const MESSAGE_PAGE_SIZE = 100;

export type MessageAuthorRole = Extract<AccountRole, "coder" | "business">;

export interface EngagementMessage {
  readonly id: string;
  readonly engagementId: string;
  readonly authorRole: MessageAuthorRole;
  readonly authorName: string;
  readonly body: string;
  readonly evidence: readonly string[];
  readonly createdAt: string;
}

interface MessageRow {
  readonly id: string;
  readonly engagementId: string;
  readonly authorRole: MessageAuthorRole;
  readonly authorName: string;
  readonly body: string;
  readonly evidence: string;
  readonly createdAt: string;
}

interface CursorRow {
  readonly createdAt: string;
  readonly rowId: number;
}

const MESSAGE_SELECT = `
  SELECT m.id, m.engagement_id AS engagementId, m.author_role AS authorRole,
         m.body, m.evidence, m.created_at AS createdAt,
         COALESCE(
           CASE WHEN m.author_role = 'coder' THEN NULLIF(cp.display_name, '') END,
           CASE WHEN m.author_role = 'business' THEN NULLIF(bp.company_name, '') END,
           a.email
         ) AS authorName
  FROM engagement_messages m
  JOIN accounts a ON a.id = m.author_account_id
  LEFT JOIN coder_profiles cp ON m.author_role = 'coder' AND cp.account_id = m.author_account_id
  LEFT JOIN business_profiles bp
    ON m.author_role = 'business' AND bp.account_id = m.author_account_id
`;

function parseStoredEvidence(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}

function toMessage(row: MessageRow): EngagementMessage {
  return {
    id: row.id,
    engagementId: row.engagementId,
    authorRole: row.authorRole,
    authorName: row.authorName,
    body: row.body,
    evidence: parseStoredEvidence(row.evidence),
    createdAt: row.createdAt,
  };
}

/**
 * Both sides of the engagement, and nobody else. A third account gets the same
 * 404 as an unknown id so the endpoint does not confirm that an engagement
 * exists between two other people.
 */
function requireParticipant(
  ctx: AppContext,
  account: AccountRow,
  engagementId: string,
): MessageAuthorRole {
  const row = queryOne<{ businessId: string; coderAccountId: string | null }>(
    ctx.db,
    `SELECT e.business_id AS businessId, p.account_id AS coderAccountId
     FROM engagements e LEFT JOIN coder_profiles p ON p.id = e.coder_id
     WHERE e.id = ?`,
    [engagementId],
  );
  if (row === undefined) throw notFound("Engagement not found.", "engagement_not_found");
  if (row.businessId === account.id) return "business";
  if (row.coderAccountId === account.id) return "coder";
  throw notFound("Engagement not found.", "engagement_not_found");
}

/**
 * Message links are proof, like delivery evidence, but a conversation can carry
 * more of them than one delivery (10 instead of the 5 parseEvidence allows), so
 * the cap is local rather than changing the delivery contract.
 */
function parseMessageEvidence(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === "") return [];
  let values: string[];
  if (Array.isArray(raw)) {
    values = raw.filter((value): value is string => typeof value === "string");
  } else if (typeof raw === "string") {
    values = raw.split(/[,\n]/u);
  } else {
    throw badRequest("Message evidence must be a list of URLs.", "invalid_evidence");
  }

  const seen = new Set<string>();
  const evidence: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "") continue;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw badRequest("Message evidence must be full http(s) URLs.", "invalid_evidence");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw badRequest("Message evidence must use http or https.", "invalid_evidence");
    }
    const href = parsed.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    evidence.push(href);
    if (evidence.length > MAX_MESSAGE_EVIDENCE) {
      throw badRequest(
        `Message evidence can list at most ${MAX_MESSAGE_EVIDENCE} URLs.`,
        "invalid_evidence",
      );
    }
  }
  return evidence;
}

/**
 * Newest messages are appended, so a page is the oldest 100 after the cursor.
 * `created_at` alone cannot order messages posted in the same millisecond (the
 * tests use a fixed clock), so the rowid breaks the tie in insertion order.
 */
export function listEngagementMessages(
  ctx: AppContext,
  account: AccountRow,
  engagementId: string,
  after?: string,
): EngagementMessage[] {
  requireParticipant(ctx, account, engagementId);

  const cursor = after === undefined || after === "" ? undefined : after;
  if (cursor === undefined) {
    const rows = queryAll<MessageRow>(
      ctx.db,
      `${MESSAGE_SELECT} WHERE m.engagement_id = ?
       ORDER BY m.created_at ASC, m.rowid ASC LIMIT ${MESSAGE_PAGE_SIZE}`,
      [engagementId],
    );
    return rows.map(toMessage);
  }

  const cursorRow = queryOne<CursorRow>(
    ctx.db,
    "SELECT created_at AS createdAt, rowid AS rowId FROM engagement_messages WHERE id = ? AND engagement_id = ?",
    [cursor, engagementId],
  );
  if (cursorRow === undefined) {
    throw badRequest("Unknown message cursor.", "invalid_cursor");
  }
  const rows = queryAll<MessageRow>(
    ctx.db,
    `${MESSAGE_SELECT} WHERE m.engagement_id = ?
       AND (m.created_at > ? OR (m.created_at = ? AND m.rowid > ?))
     ORDER BY m.created_at ASC, m.rowid ASC LIMIT ${MESSAGE_PAGE_SIZE}`,
    [engagementId, cursorRow.createdAt, cursorRow.createdAt, cursorRow.rowId],
  );
  return rows.map(toMessage);
}

export function postEngagementMessage(
  ctx: AppContext,
  account: AccountRow,
  engagementId: string,
  body: Body,
): EngagementMessage {
  const role = requireParticipant(ctx, account, engagementId);
  const text = requireText(body, "body", "Message", 1, MAX_MESSAGE_LENGTH);
  const evidence = parseMessageEvidence(body.evidence);
  const id = NodeCrypto.randomUUID();
  execute(
    ctx.db,
    `INSERT INTO engagement_messages
       (id, engagement_id, author_account_id, author_role, body, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, engagementId, account.id, role, text, JSON.stringify(evidence), ctx.now().toISOString()],
  );
  const row = queryOne<MessageRow>(ctx.db, `${MESSAGE_SELECT} WHERE m.id = ?`, [id]);
  if (row === undefined) throw new Error("The message was inserted but could not be read back.");
  return toMessage(row);
}
