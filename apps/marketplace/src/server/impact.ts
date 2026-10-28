import type { AppContext } from "./context.ts";
import { queryAll, queryOne } from "./db.ts";

/**
 * Public numbers, computed from the ledger that actually moved the money. There
 * is no analytics table and no rounding up: every figure is a SUM over rows the
 * escrow wrote, which is also why it can be audited and reconciled.
 */
export interface ImpactNumbers {
  readonly paidToCodersCents: number;
  readonly platformFeesCents: number;
  readonly refundedCents: number;
  /** Money currently sitting in escrow (charged minus refunded, fees and payouts). */
  readonly heldCents: number;
  readonly completedEngagements: number;
  readonly activeEngagements: number;
  readonly codersPaid: number;
  readonly businessesServed: number;
  /** Average hours from engagement start to payout; null when nothing paid yet. */
  readonly averagePayoutHours: number | null;
  readonly disputesResolved: number;
  readonly refundedEngagements: number;
  readonly reportsResolved: number;
  readonly currency: string;
}

function count(ctx: AppContext, sql: string, params: (string | number)[] = []): number {
  return Number(queryOne<{ count: number }>(ctx.db, sql, params)?.count ?? 0);
}

export function impactNumbers(ctx: AppContext): ImpactNumbers {
  const sums = queryAll<{ kind: string; total: number }>(
    ctx.db,
    "SELECT kind, SUM(amount_cents) AS total FROM ledger_entries GROUP BY kind",
  );
  const byKind = new Map<string, number>();
  for (const row of sums) byKind.set(row.kind, Number(row.total));
  const chargedCents = byKind.get("charge") ?? 0;
  const platformFeesCents = byKind.get("platform_fee") ?? 0;
  const paidToCodersCents = byKind.get("payout") ?? 0;
  const refundedCents = Math.abs(byKind.get("refund") ?? 0);

  const currencies = queryAll<{ currency: string }>(
    ctx.db,
    "SELECT DISTINCT currency FROM ledger_entries",
  );
  const currency =
    currencies.length === 0
      ? "EUR"
      : currencies.length === 1
        ? (currencies[0]?.currency ?? "EUR")
        : "MIXED";

  const averagePayoutHours = queryOne<{ hours: number | null }>(
    ctx.db,
    `SELECT AVG((julianday(updated_at) - julianday(created_at)) * 24) AS hours
     FROM engagements WHERE status = 'paid_out'`,
  );

  return {
    paidToCodersCents,
    platformFeesCents,
    refundedCents,
    heldCents: chargedCents - refundedCents - platformFeesCents - paidToCodersCents,
    completedEngagements: count(
      ctx,
      "SELECT COUNT(*) AS count FROM engagements WHERE status = 'paid_out'",
    ),
    activeEngagements: count(
      ctx,
      `SELECT COUNT(*) AS count FROM engagements
       WHERE status IN ('requested', 'accepted', 'in_progress', 'delivered', 'approved', 'disputed')`,
    ),
    codersPaid: count(
      ctx,
      "SELECT COUNT(DISTINCT coder_id) AS count FROM engagements WHERE status = 'paid_out'",
    ),
    businessesServed: count(
      ctx,
      "SELECT COUNT(DISTINCT business_id) AS count FROM engagements WHERE status = 'paid_out'",
    ),
    averagePayoutHours:
      averagePayoutHours?.hours === null || averagePayoutHours?.hours === undefined
        ? null
        : Math.round(Number(averagePayoutHours.hours) * 10) / 10,
    disputesResolved: count(
      ctx,
      "SELECT COUNT(*) AS count FROM engagements WHERE resolution_outcome != ''",
    ),
    refundedEngagements: count(
      ctx,
      "SELECT COUNT(*) AS count FROM engagements WHERE resolution_outcome = 'refunded'",
    ),
    reportsResolved: count(ctx, "SELECT COUNT(*) AS count FROM reports WHERE status = 'resolved'"),
    currency,
  };
}
