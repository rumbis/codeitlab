import type { AppContext } from "./context.ts";
import { queryAll } from "./db.ts";
import type { EngagementRow, LedgerRow } from "./types.ts";

export interface LedgerProblem {
  readonly engagementId: string;
  readonly detail: string;
}

export interface ReconcileReport {
  readonly ok: boolean;
  readonly engagements: number;
  readonly entries: number;
  readonly problems: readonly LedgerProblem[];
  readonly totals: {
    readonly chargedCents: number;
    readonly feeCents: number;
    readonly payoutCents: number;
    readonly refundedCents: number;
    /** Charges still held for engagements that have not settled. */
    readonly heldCents: number;
  };
}

/**
 * Expected ledger entries for one engagement, derived from its state. This is
 * the invariant the escrow state machine promises: a charge for the full
 * amount, then either fee+payout when paid out, or a refund when cancelled, and
 * nothing in between. A row that disagrees is money the platform cannot
 * explain, so the report names it instead of silently summing.
 */
function expectedEntries(
  row: EngagementRow,
): Record<"charge" | "platform_fee" | "payout" | "refund", number> {
  const amount = Number(row.amountCents);
  const charged = row.paymentRef !== "";
  const expected = {
    charge: charged ? amount : 0,
    platform_fee: 0,
    payout: 0,
    refund: 0,
  };
  if (row.status === "paid_out") {
    expected.platform_fee = Number(row.feeCents);
    expected.payout = Number(row.payoutCents);
  }
  if (row.status === "cancelled") {
    expected.refund = charged ? -amount : 0;
  }
  return expected;
}

function sumsByKind(rows: readonly LedgerRow[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const row of rows) {
    sums[row.kind] = (sums[row.kind] ?? 0) + Number(row.amountCents);
  }
  return sums;
}

/**
 * Compare every engagement's ledger against the state machine's expectation and
 * return the mismatches. Run by an operator (or a nightly job) before payouts;
 * it never mutates anything, so it is safe to run against production.
 */
export function reconcileLedger(ctx: AppContext): ReconcileReport {
  const engagements = queryAll<EngagementRow>(
    ctx.db,
    `SELECT id, job_id AS jobId, coder_id AS coderId, business_id AS businessId,
            amount_cents AS amountCents, fee_bps AS feeBps, fee_cents AS feeCents,
            payout_cents AS payoutCents, currency, status, payment_ref AS paymentRef,
            created_at AS createdAt, updated_at AS updatedAt
     FROM engagements`,
  );
  const entries = queryAll<LedgerRow>(
    ctx.db,
    `SELECT id, engagement_id AS engagementId, kind, amount_cents AS amountCents,
            currency, note, created_at AS createdAt
     FROM ledger_entries`,
  );

  const byEngagement = new Map<string, LedgerRow[]>();
  for (const entry of entries) {
    const list = byEngagement.get(entry.engagementId);
    if (list === undefined) byEngagement.set(entry.engagementId, [entry]);
    else list.push(entry);
  }

  const problems: LedgerProblem[] = [];
  const totals = {
    chargedCents: 0,
    feeCents: 0,
    payoutCents: 0,
    refundedCents: 0,
    heldCents: 0,
  };

  for (const row of engagements) {
    const actual = sumsByKind(byEngagement.get(row.id) ?? []);
    const expected = expectedEntries(row);

    for (const kind of ["charge", "platform_fee", "payout", "refund"] as const) {
      const got = actual[kind] ?? 0;
      if (got !== expected[kind]) {
        problems.push({
          engagementId: row.id,
          detail: `${kind}: expected ${expected[kind]} cents, ledger has ${got}`,
        });
      }
    }
    const unknownKinds = Object.keys(actual).filter(
      (kind) => !["charge", "platform_fee", "payout", "refund"].includes(kind),
    );
    for (const kind of unknownKinds) {
      problems.push({ engagementId: row.id, detail: `unknown ledger kind "${kind}"` });
    }

    if (row.status !== "requested" && row.status !== "cancelled" && row.paymentRef === "") {
      problems.push({
        engagementId: row.id,
        detail: `status "${row.status}" without a payment reference`,
      });
    }

    totals.chargedCents += actual.charge ?? 0;
    totals.feeCents += actual.platform_fee ?? 0;
    totals.payoutCents += actual.payout ?? 0;
    totals.refundedCents += actual.refund ?? 0;
    if (row.status !== "paid_out" && row.status !== "cancelled") {
      totals.heldCents += actual.charge ?? 0;
    }
  }

  // Ledger rows that point at no engagement are money with no owner.
  for (const [engagementId] of byEngagement) {
    if (!engagements.some((row) => row.id === engagementId)) {
      problems.push({ engagementId, detail: "ledger entries for an unknown engagement" });
    }
  }

  return {
    ok: problems.length === 0,
    engagements: engagements.length,
    entries: entries.length,
    problems,
    totals,
  };
}
