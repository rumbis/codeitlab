import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { notify } from "./notifications.ts";
import type { AccountRow } from "./types.ts";
import { requireInteger, type Body } from "./validate.ts";

export interface Rating {
  readonly id: string;
  readonly engagementId: string;
  readonly coderId: string;
  readonly businessId: string;
  readonly score: number;
  readonly comment: string;
  readonly createdAt: string;
}

export interface RatingSummary {
  readonly count: number;
  readonly average: number;
}

export const MAX_RATING_COMMENT_LENGTH = 500;

const RATING_COLUMNS = `id, engagement_id AS engagementId, coder_id AS coderId,
  business_id AS businessId, score, comment, created_at AS createdAt`;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function parseRatingComment(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw badRequest("Comment must be text.", "bad_comment");
  const comment = value.trim();
  if (comment.length > MAX_RATING_COMMENT_LENGTH) {
    throw badRequest(
      `Keep the comment under ${MAX_RATING_COMMENT_LENGTH} characters.`,
      "comment_too_long",
    );
  }
  return comment;
}

/**
 * A rating is a business's verdict after the money has moved, so it can never be
 * used to pressure a coder into a refund: only `paid_out` engagements qualify,
 * one rating per engagement, written by the business that paid.
 */
export function rateEngagement(
  ctx: AppContext,
  account: AccountRow,
  engagementId: string,
  body: Body,
): Rating {
  if (account.role !== "business") {
    throw forbidden("Only the business that paid can rate the delivery.", "wrong_role");
  }
  const engagement = queryOne<{
    id: string;
    business_id: string;
    coder_id: string;
    coder_account_id: string;
    status: string;
  }>(
    ctx.db,
    `SELECT e.id, e.business_id, e.coder_id, p.account_id AS coder_account_id, e.status
     FROM engagements e JOIN coder_profiles p ON p.id = e.coder_id
     WHERE e.id = ?`,
    [engagementId],
  );
  if (engagement === undefined) throw notFound("Engagement not found.", "engagement_not_found");
  if (engagement.business_id !== account.id) {
    throw forbidden("Only the business that paid can rate the delivery.", "wrong_role");
  }
  if (engagement.status !== "paid_out") {
    throw conflict("You can rate the delivery after the payout is complete.", "not_paid_out");
  }
  const score = requireInteger(body, "score", "Rating", 1, 5);
  const comment = parseRatingComment(body.comment);

  const existing = queryOne<{ id: string }>(
    ctx.db,
    "SELECT id FROM ratings WHERE engagement_id = ?",
    [engagementId],
  );
  if (existing !== undefined) {
    throw conflict("This engagement already has a rating.", "already_rated");
  }

  const rating: Rating = {
    id: `rating_${NodeCrypto.randomUUID()}`,
    engagementId,
    coderId: engagement.coder_id,
    businessId: account.id,
    score,
    comment,
    createdAt: ctx.now().toISOString(),
  };
  execute(
    ctx.db,
    `INSERT INTO ratings (id, engagement_id, coder_id, business_id, score, comment, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      rating.id,
      rating.engagementId,
      rating.coderId,
      rating.businessId,
      score,
      comment,
      rating.createdAt,
    ],
  );
  notify(ctx, {
    accountId: engagement.coder_account_id,
    kind: "review",
    message:
      comment === ""
        ? `A business rated the delivery ${score}/5.`
        : `A business rated the delivery ${score}/5: “${comment}”`,
    href: `/dashboard#engagement-${engagementId}`,
    engagementId,
  });
  return rating;
}

export function hasRatingForEngagement(ctx: AppContext, engagementId: string): boolean {
  const row = queryOne<{ id: string }>(ctx.db, "SELECT id FROM ratings WHERE engagement_id = ?", [
    engagementId,
  ]);
  return row !== undefined;
}

export function ratingForEngagement(ctx: AppContext, engagementId: string): Rating | null {
  return (
    queryOne<Rating>(ctx.db, `SELECT ${RATING_COLUMNS} FROM ratings WHERE engagement_id = ?`, [
      engagementId,
    ]) ?? null
  );
}

export function loadRatingsForEngagements(
  ctx: AppContext,
  engagementIds: readonly string[],
): Map<string, Rating> {
  if (engagementIds.length === 0) return new Map();
  const placeholders = engagementIds.map(() => "?").join(", ");
  const rows = queryAll<Rating>(
    ctx.db,
    `SELECT ${RATING_COLUMNS} FROM ratings WHERE engagement_id IN (${placeholders})`,
    [...engagementIds],
  );
  return new Map(rows.map((row) => [row.engagementId, row]));
}

/** Batch summaries for directory and match cards: one query, no N+1. */
export function loadRatingSummaries(
  ctx: AppContext,
  coderIds: readonly string[],
): Map<string, RatingSummary> {
  if (coderIds.length === 0) return new Map();
  const placeholders = coderIds.map(() => "?").join(", ");
  const rows = queryAll<{ coderId: string; count: number; average: number | null }>(
    ctx.db,
    `SELECT coder_id AS coderId, COUNT(*) AS count, AVG(score) AS average
     FROM ratings WHERE coder_id IN (${placeholders}) GROUP BY coder_id`,
    [...coderIds],
  );
  return new Map(
    rows.map((row) => [
      row.coderId,
      { count: Number(row.count), average: round1(Number(row.average ?? 0)) },
    ]),
  );
}

export function ratingSummaryForCoder(ctx: AppContext, coderId: string): RatingSummary {
  const row = queryOne<{ count: number; average: number | null }>(
    ctx.db,
    "SELECT COUNT(*) AS count, AVG(score) AS average FROM ratings WHERE coder_id = ?",
    [coderId],
  );
  return { count: Number(row?.count ?? 0), average: round1(Number(row?.average ?? 0)) };
}

export function listRatingsForCoder(ctx: AppContext, coderId: string, limit = 5): Rating[] {
  const capped = Math.min(Math.max(limit, 1), 20);
  return queryAll<Rating>(
    ctx.db,
    `SELECT ${RATING_COLUMNS} FROM ratings WHERE coder_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [coderId, capped],
  );
}
