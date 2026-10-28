import type { AppContext } from "./context.ts";
import { queryAll, queryOne } from "./db.ts";
import { releaseEscrow } from "./engagements.ts";
import { notify } from "./notifications.ts";
import { recordAdminAction } from "./admin.ts";
import { formatCents } from "../shared/contracts.ts";
import type { EngagementRow } from "./types.ts";

/** How long a delivery may sit without a response before escrow is released. */
export const DEFAULT_AUTO_RELEASE_DAYS = 14;
export const DAY_MS = 24 * 60 * 60_000;

export function autoReleaseDaysFromEnv(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.MARKETPLACE_AUTO_RELEASE_DAYS ?? DEFAULT_AUTO_RELEASE_DAYS);
  return Number.isInteger(raw) && raw >= 0 && raw <= 365 ? raw : DEFAULT_AUTO_RELEASE_DAYS;
}

function cutoffIso(ctx: AppContext, days: number): string {
  return new Date(ctx.now().getTime() - days * DAY_MS).toISOString();
}

/** Deliveries that would be released if the sweep ran now. */
export function eligibleForAutoRelease(ctx: AppContext, days = ctx.autoReleaseDays): number {
  if (days <= 0) return 0;
  const row = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM engagements WHERE status = 'delivered' AND updated_at <= ?",
    [cutoffIso(ctx, days)],
  );
  return Number(row?.count ?? 0);
}

export interface AutoReleaseResult {
  readonly days: number;
  readonly released: number;
  readonly failed: number;
}

/**
 * Pay the coder when a business goes quiet. A delivery is the coder's side of
 * the contract and the money is already in escrow, so after `autoReleaseDays`
 * (default 14, 0 disables) with no approval and no dispute the escrow is
 * released through the same `releaseEscrow` path as a normal approval: same
 * compare-and-set, same ledger shape, same reconciliation. A provider failure
 * leaves the row delivered so the next run can retry; nothing is ever paid
 * twice. The sweep records an admin-audit row per release.
 */
export async function runAutoRelease(
  ctx: AppContext,
  days = ctx.autoReleaseDays,
): Promise<AutoReleaseResult> {
  if (days <= 0) return { days, released: 0, failed: 0 };
  const rows = queryAll<EngagementRow>(
    ctx.db,
    `SELECT id, job_id AS jobId, coder_id AS coderId, business_id AS businessId,
            amount_cents AS amountCents, fee_bps AS feeBps, fee_cents AS feeCents,
            payout_cents AS payoutCents, currency, status, payment_ref AS paymentRef,
            delivery_note AS deliveryNote, delivery_evidence AS deliveryEvidence,
            resolution_outcome AS resolutionOutcome, resolution_note AS resolutionNote,
            created_at AS createdAt, updated_at AS updatedAt
     FROM engagements WHERE status = 'delivered' AND updated_at <= ?
     ORDER BY updated_at ASC`,
    [cutoffIso(ctx, days)],
  );

  let released = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await releaseEscrow(ctx, row, {
        outcome: "released",
        note: `Released automatically after ${days} days without a response from the business.`,
      });
    } catch {
      failed += 1;
      continue;
    }
    released += 1;
    recordAdminAction(ctx, {
      action: "escrow.auto_released",
      targetId: row.id,
      detail: `${formatCents(Number(row.amountCents), row.currency)} after ${days} days (cron)`,
    });
    const coder = queryOne<{ accountId: string }>(
      ctx.db,
      "SELECT account_id AS accountId FROM coder_profiles WHERE id = ?",
      [row.coderId],
    );
    if (coder !== undefined) {
      notify(ctx, {
        accountId: coder.accountId,
        kind: "approved",
        message: `Escrow released automatically after ${days} days: ${formatCents(Number(row.payoutCents), row.currency)} is on its way to you.`,
        href: `/dashboard#engagement-${row.id}`,
        engagementId: row.id,
      });
    }
    notify(ctx, {
      accountId: row.businessId,
      kind: "approved",
      message: `Escrow for ${formatCents(Number(row.amountCents), row.currency)} was released automatically because the delivery waited ${days} days without approval or a dispute.`,
      href: `/dashboard#engagement-${row.id}`,
      engagementId: row.id,
    });
  }
  return { days, released, failed };
}
