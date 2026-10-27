import type { AppContext } from "./context.ts";
import { queryOne } from "./db.ts";

export interface BusinessTrackRecord {
  readonly paidEngagements: number;
  /** Total charged through escrow, including the platform fee. */
  readonly totalPaidCents: number;
  readonly currency: string;
  /** Month of the first completed payout, or "" when none. */
  readonly firstPaidAt: string;
  readonly refundedEngagements: number;
}

/**
 * What a coder can check before saying yes: has this business actually paid
 * anyone through escrow, and for how much? It is derived from paid_out
 * engagements only — a job post, an application or a promise proves nothing.
 */
export function businessTrackRecord(ctx: AppContext, businessId: string): BusinessTrackRecord {
  const paid = queryOne<{
    count: number;
    total: number | null;
    first: string | null;
    currency: string | null;
  }>(
    ctx.db,
    `SELECT COUNT(*) AS count, SUM(amount_cents) AS total, MIN(updated_at) AS first,
            (SELECT currency FROM engagements WHERE business_id = ? AND status = 'paid_out'
             ORDER BY updated_at ASC LIMIT 1) AS currency
     FROM engagements WHERE business_id = ? AND status = 'paid_out'`,
    [businessId, businessId],
  );
  const refunded = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM engagements WHERE business_id = ? AND resolution_outcome = 'refunded'",
    [businessId],
  );
  return {
    paidEngagements: Number(paid?.count ?? 0),
    totalPaidCents: Number(paid?.total ?? 0),
    currency: paid?.currency ?? "EUR",
    firstPaidAt: paid?.first ?? "",
    refundedEngagements: Number(refunded?.count ?? 0),
  };
}

/** One sentence a coder can read in two seconds. */
export function businessTrackRecordLine(record: BusinessTrackRecord): string {
  if (record.paidEngagements === 0) {
    return "New business: no completed engagements yet. Escrow still protects you — the money is charged when the engagement starts and held until they approve the delivery.";
  }
  return `Has paid out ${record.paidEngagements} engagement${record.paidEngagements === 1 ? "" : "s"} through escrow${record.firstPaidAt === "" ? "" : ` since ${record.firstPaidAt.slice(0, 7)}`}.`;
}
