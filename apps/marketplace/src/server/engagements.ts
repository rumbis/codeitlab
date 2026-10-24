import * as NodeCrypto from "node:crypto";

import {
  FEE_TIERS,
  FEE_TIER_BPS,
  formatCents,
  platformFeeCents,
  payoutCents,
  type Engagement,
  type EngagementStatus,
  type FeeTier,
  type LedgerEntry,
  type LedgerKind,
} from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { execute, executeChanges, queryAll, queryOne, transaction } from "./db.ts";
import { HttpError, badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { getJobOrThrow, setJobStatus } from "./jobs.ts";
import { notify } from "./notifications.ts";
import { consumeRateLimit } from "./ratelimit.ts";
import { PaymentProviderError } from "./payments.ts";
import type { AccountRow, EngagementRow, LedgerRow } from "./types.ts";
import {
  parseDeliveryNote,
  parseEvidence,
  requireEnum,
  requireId,
  requireInteger,
  type Body,
} from "./validate.ts";

const ENGAGEMENT_COLUMNS = `
  id, job_id AS jobId, coder_id AS coderId, business_id AS businessId,
  amount_cents AS amountCents, fee_bps AS feeBps, fee_cents AS feeCents, payout_cents AS payoutCents,
  currency, status, payment_ref AS paymentRef, delivery_note AS deliveryNote,
  delivery_evidence AS deliveryEvidence, resolution_outcome AS resolutionOutcome,
  resolution_note AS resolutionNote, created_at AS createdAt, updated_at AS updatedAt
`;

const LEDGER_COLUMNS = `
  id, engagement_id AS engagementId, kind, amount_cents AS amountCents,
  currency, note, created_at AS createdAt
`;

export type EngagementAction = "accept" | "start" | "deliver" | "approve" | "cancel" | "dispute";

/** Which statuses each transition may start from. Anything else is a 409. */
const ALLOWED_FROM: Record<EngagementAction, readonly EngagementStatus[]> = {
  accept: ["requested"],
  start: ["accepted"],
  deliver: ["in_progress"],
  approve: ["delivered"],
  cancel: ["requested", "accepted", "in_progress"],
  dispute: ["accepted", "in_progress", "delivered"],
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

const ACTION_LABELS: Record<EngagementAction, string> = {
  accept: "accept",
  start: "start",
  deliver: "deliver",
  approve: "approve",
  cancel: "cancel",
  dispute: "dispute",
};

/** Stored evidence is JSON; a corrupt value must not break the engagement page. */
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

export function toEngagement(row: EngagementRow): Engagement {
  return {
    id: row.id,
    jobId: row.jobId,
    coderId: row.coderId,
    businessId: row.businessId,
    amountCents: Number(row.amountCents),
    feeBps: Number(row.feeBps),
    feeCents: Number(row.feeCents),
    payoutCents: Number(row.payoutCents),
    currency: row.currency,
    status: row.status,
    paymentRef: row.paymentRef,
    deliveryNote: row.deliveryNote,
    deliveryEvidence: parseStoredEvidence(row.deliveryEvidence),
    resolutionOutcome: row.resolutionOutcome,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toLedgerEntry(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    engagementId: row.engagementId,
    kind: row.kind,
    amountCents: Number(row.amountCents),
    currency: row.currency,
    note: row.note,
    createdAt: row.createdAt,
  };
}

export function getEngagementRow(ctx: AppContext, id: string): EngagementRow | undefined {
  return queryOne<EngagementRow>(
    ctx.db,
    `SELECT ${ENGAGEMENT_COLUMNS} FROM engagements WHERE id = ?`,
    [id],
  );
}

export function getEngagement(ctx: AppContext, id: string): Engagement | null {
  const row = getEngagementRow(ctx, id);
  return row === undefined ? null : toEngagement(row);
}

function getEngagementOrThrow(ctx: AppContext, id: string): EngagementRow {
  const row = getEngagementRow(ctx, id);
  if (row === undefined) throw notFound("Engagement not found.", "engagement_not_found");
  return row;
}

function insertLedgerEntry(
  ctx: AppContext,
  input: {
    readonly engagementId: string;
    readonly kind: LedgerKind;
    readonly amountCents: number;
    readonly currency: string;
    readonly note: string;
  },
): void {
  execute(
    ctx.db,
    `INSERT INTO ledger_entries (id, engagement_id, kind, amount_cents, currency, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      NodeCrypto.randomUUID(),
      input.engagementId,
      input.kind,
      input.amountCents,
      input.currency,
      input.note,
      ctx.now().toISOString(),
    ],
  );
}

function coderAccountId(ctx: AppContext, coderId: string): string | undefined {
  const row = queryOne<{ accountId: string }>(
    ctx.db,
    "SELECT account_id AS accountId FROM coder_profiles WHERE id = ?",
    [coderId],
  );
  return row?.accountId;
}

/**
 * Start an engagement: charge the business into escrow, record the charge, and
 * mark the job matched. The provider call happens before the transaction
 * because `transaction` is synchronous; the mock provider settles instantly.
 */
export async function createEngagement(
  ctx: AppContext,
  account: AccountRow,
  body: Body,
): Promise<Engagement> {
  if (account.role !== "business") {
    throw forbidden("Only business accounts can start an engagement.", "wrong_role");
  }

  const jobId = requireId(body, "jobId", "Job");
  const coderId = requireId(body, "coderId", "Coder");
  const amountCents = requireInteger(body, "amountCents", "Amount", 1, 100_000_000);
  const rawFeeTier = body.feeTier;
  const feeTier: FeeTier =
    rawFeeTier === undefined || rawFeeTier === null || rawFeeTier === ""
      ? "standard"
      : requireEnum<FeeTier>(body, "feeTier", "Fee tier", FEE_TIERS);

  const job = getJobOrThrow(ctx, jobId);
  if (job.businessId !== account.id) {
    throw forbidden(
      "Only the business that posted this job can start an engagement.",
      "wrong_role",
    );
  }
  if (job.status === "closed") {
    throw conflict("This job is already closed.", "job_closed");
  }

  const coder = queryOne<{ id: string; approved: number }>(
    ctx.db,
    "SELECT id, approved FROM coder_profiles WHERE id = ?",
    [coderId],
  );
  if (coder === undefined) throw notFound("Coder profile not found.", "coder_not_found");
  if (Number(coder.approved) !== 1) {
    throw conflict("This coder is not approved for work yet.", "coder_not_available");
  }
  if (amountCents > job.budgetMaxCents) {
    throw badRequest("Amount cannot exceed the job's maximum budget.", "amount_above_budget");
  }
  if (job.assisted && feeTier !== "assisted") {
    throw badRequest(
      "This job asked CodeitLab for help, so it uses the assisted tier (20%). The operator scopes the job, shortlists coders and reviews the delivery evidence.",
      "assisted_tier_required",
    );
  }

  // A charge costs a provider call and a real card attempt; guard it before
  // any money work happens, so a stolen session cannot grind the provider.
  consumeRateLimit(
    ctx,
    `charge:${account.id}`,
    ctx.rateLimits.chargePerHour,
    "Too many escrow charges started in the last hour. Wait before trying again.",
  );

  const active = queryOne<{ id: string }>(
    ctx.db,
    "SELECT id FROM engagements WHERE job_id = ? AND status != 'cancelled'",
    [jobId],
  );
  if (active !== undefined) {
    throw conflict(
      "This job already has an engagement. Cancel it before starting another.",
      "job_engaged",
    );
  }

  const feeBps = FEE_TIER_BPS[feeTier];
  const feeCents = platformFeeCents(amountCents, feeBps);
  const payout = payoutCents(amountCents, feeBps);
  const id = NodeCrypto.randomUUID();
  const now = ctx.now().toISOString();

  // Reserve the job slot before charging. The partial unique index on
  // engagements(job_id) WHERE status <> 'cancelled' turns a concurrent
  // double-submit into a constraint violation instead of a second charge.
  try {
    transaction(ctx.db, () => {
      execute(
        ctx.db,
        `INSERT INTO engagements
          (id, job_id, coder_id, business_id, amount_cents, fee_bps, fee_cents, payout_cents,
           currency, status, payment_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested', '', ?, ?)`,
        [
          id,
          jobId,
          coderId,
          account.id,
          amountCents,
          feeBps,
          feeCents,
          payout,
          job.currency,
          now,
          now,
        ],
      );
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        "This job already has an engagement. Cancel it before starting another.",
        "job_engaged",
      );
    }
    throw error;
  }

  const releaseReservation = (): void => {
    execute(
      ctx.db,
      "DELETE FROM engagements WHERE id = ? AND status = 'requested' AND payment_ref = ''",
      [id],
    );
  };

  let charge: { paymentRef: string; settled: boolean };
  try {
    charge = await ctx.payments.charge({
      amountCents,
      currency: job.currency,
      description: `Escrow for "${job.title}"`,
      reference: jobId,
      idempotencyKey: `engagement:${id}:charge`,
    });
  } catch (error) {
    releaseReservation();
    if (error instanceof PaymentProviderError) {
      throw new HttpError(402, error.providerCode, error.message);
    }
    throw error;
  }
  if (!charge.settled) {
    releaseReservation();
    throw new HttpError(402, "payment_failed", "The payment provider did not settle the charge.");
  }

  transaction(ctx.db, () => {
    execute(ctx.db, "UPDATE engagements SET payment_ref = ? WHERE id = ?", [charge.paymentRef, id]);
    insertLedgerEntry(ctx, {
      engagementId: id,
      kind: "charge",
      amountCents,
      currency: job.currency,
      note: `Escrow charge for "${job.title}"`,
    });
    setJobStatus(ctx, jobId, "matched");
  });

  const created = getEngagement(ctx, id);
  if (created === null) throw notFound("Engagement was not saved.", "engagement_not_found");
  const coderAccount = coderAccountId(ctx, created.coderId);
  if (coderAccount !== undefined) {
    notify(ctx, {
      accountId: coderAccount,
      kind: "engagement",
      message: `Escrow funded for "${job.title}" (${formatCents(created.amountCents, created.currency)}). Accept it to start work.`,
      href: `/dashboard#engagement-${created.id}`,
      engagementId: created.id,
    });
  }
  return created;
}

/** How an operator closed a dispute, recorded on the engagement for audit. */
export interface EscrowResolution {
  readonly outcome: "refunded" | "released";
  readonly note: string;
}

/**
 * Release the escrow to the coder. Used by the normal approve transition and by
 * an operator resolving a dispute in the coder's favour, so both paths pay out
 * exactly the same way and reconcile to the same ledger shape.
 *
 * The compare-and-set on `fromStatus` is what makes a double approve or a
 * double resolution impossible: the loser never reaches the provider.
 */
export async function releaseEscrow(
  ctx: AppContext,
  row: EngagementRow,
  resolution?: EscrowResolution,
): Promise<void> {
  const fromStatus = row.status;
  const now = ctx.now().toISOString();
  const claimed = executeChanges(
    ctx.db,
    "UPDATE engagements SET status = 'approved', updated_at = ? WHERE id = ? AND status = ?",
    [now, row.id, fromStatus],
  );
  if (claimed !== 1) {
    throw conflict("This engagement is no longer waiting for approval.", "illegal_transition");
  }

  let payout: { paymentRef: string; settled: boolean };
  try {
    payout = await ctx.payments.payout({
      amountCents: Number(row.payoutCents),
      currency: row.currency,
      reference: row.id,
      idempotencyKey: `engagement:${row.id}:payout`,
    });
  } catch (error) {
    // Put it back so the decision can be retried; nothing was paid out.
    execute(
      ctx.db,
      "UPDATE engagements SET status = ?, updated_at = ? WHERE id = ? AND status = 'approved'",
      [fromStatus, now, row.id],
    );
    if (error instanceof PaymentProviderError) {
      throw new HttpError(402, error.providerCode, error.message);
    }
    throw error;
  }
  if (!payout.settled) {
    execute(
      ctx.db,
      "UPDATE engagements SET status = ?, updated_at = ? WHERE id = ? AND status = 'approved'",
      [fromStatus, now, row.id],
    );
    throw new HttpError(402, "payment_failed", "The payment provider did not settle the payout.");
  }

  transaction(ctx.db, () => {
    execute(
      ctx.db,
      `UPDATE engagements SET status = 'paid_out', resolution_outcome = ?, resolution_note = ?,
         updated_at = ? WHERE id = ? AND status = 'approved'`,
      [resolution?.outcome ?? "", resolution?.note ?? "", now, row.id],
    );
    insertLedgerEntry(ctx, {
      engagementId: row.id,
      kind: "platform_fee",
      amountCents: Number(row.feeCents),
      currency: row.currency,
      note: `Platform fee (${Number(row.feeBps) / 100}%)`,
    });
    insertLedgerEntry(ctx, {
      engagementId: row.id,
      kind: "payout",
      amountCents: Number(row.payoutCents),
      currency: row.currency,
      note: "Payout to coder",
    });
    setJobStatus(ctx, row.jobId, "closed");
  });
}

/**
 * Return the escrow to the business. Cancelling and refunding are the same money
 * movement; the dispute path only adds the resolution audit fields.
 */
export function refundEscrow(
  ctx: AppContext,
  row: EngagementRow,
  resolution?: EscrowResolution,
): void {
  const fromStatus = row.status;
  const now = ctx.now().toISOString();
  transaction(ctx.db, () => {
    const claimed = executeChanges(
      ctx.db,
      `UPDATE engagements SET status = 'cancelled', resolution_outcome = ?, resolution_note = ?,
         updated_at = ? WHERE id = ? AND status = ?`,
      [resolution?.outcome ?? "", resolution?.note ?? "", now, row.id, fromStatus],
    );
    if (claimed !== 1) {
      throw conflict("This engagement can no longer be cancelled.", "illegal_transition");
    }
    // A reservation whose charge never settled has no money to refund.
    if (row.paymentRef !== "") {
      insertLedgerEntry(ctx, {
        engagementId: row.id,
        kind: "refund",
        amountCents: -Number(row.amountCents),
        currency: row.currency,
        note:
          resolution === undefined
            ? "Refund (engagement cancelled)"
            : `Refund (dispute resolved: ${resolution.note})`,
      });
    }
    setJobStatus(ctx, row.jobId, "open");
  });
}

function assertActor(
  ctx: AppContext,
  row: EngagementRow,
  account: AccountRow,
  action: EngagementAction,
): void {
  if (action === "accept" || action === "start" || action === "deliver") {
    const owner = coderAccountId(ctx, row.coderId);
    if (account.role !== "coder" || owner !== account.id) {
      throw forbidden("Only the coder on this engagement can do that.", "wrong_role");
    }
    return;
  }
  if (action === "approve") {
    if (account.role !== "business" || row.businessId !== account.id) {
      throw forbidden("Only the business that funded this engagement can do that.", "wrong_role");
    }
    return;
  }
  if (row.businessId !== account.id && coderAccountId(ctx, row.coderId) !== account.id) {
    throw forbidden("Only the parties on this engagement can do that.", "wrong_role");
  }
}

/**
 * Move an engagement through the state machine. Role and ordering are checked
 * before anything is written, so a rejected transition leaves no ledger entry.
 */
export async function transitionEngagement(
  ctx: AppContext,
  account: AccountRow,
  engagementId: string,
  action: EngagementAction,
  delivery?: { readonly note: unknown; readonly evidence: unknown },
): Promise<Engagement> {
  const row = getEngagementOrThrow(ctx, engagementId);
  assertActor(ctx, row, account, action);

  const allowed = ALLOWED_FROM[action];
  if (!allowed.includes(row.status)) {
    throw conflict(
      `Cannot ${ACTION_LABELS[action]} an engagement that is ${row.status.replace(/_/gu, " ")}.`,
      "illegal_transition",
    );
  }

  consumeRateLimit(
    ctx,
    `transition:${account.id}`,
    ctx.rateLimits.transitionPerHour,
    "Too many engagement actions in the last hour. Wait before trying again.",
  );

  const now = ctx.now().toISOString();

  if (action === "approve") {
    await releaseEscrow(ctx, row);
  } else if (action === "cancel") {
    refundEscrow(ctx, row);
  } else if (action === "deliver") {
    // Validate before writing: a rejected delivery leaves the engagement in
    // progress, so the coder can fix the links and try again.
    const note = parseDeliveryNote(delivery?.note);
    const evidence = parseEvidence(delivery?.evidence, "Delivery evidence");
    execute(
      ctx.db,
      "UPDATE engagements SET status = 'delivered', delivery_note = ?, delivery_evidence = ?, updated_at = ? WHERE id = ?",
      [note, JSON.stringify(evidence), now, row.id],
    );
  } else if (action === "dispute") {
    execute(ctx.db, "UPDATE engagements SET status = 'disputed', updated_at = ? WHERE id = ?", [
      now,
      row.id,
    ]);
  } else {
    const nextStatus: EngagementStatus =
      action === "accept" ? "accepted" : action === "start" ? "in_progress" : "delivered";
    execute(ctx.db, "UPDATE engagements SET status = ?, updated_at = ? WHERE id = ?", [
      nextStatus,
      now,
      row.id,
    ]);
  }

  const updated = getEngagement(ctx, row.id);
  if (updated === null) throw notFound("Engagement not found.", "engagement_not_found");

  // The other party is the one who has to act next, so every transition that
  // changes whose turn it is writes exactly one activity row.
  const coderAccount = coderAccountId(ctx, updated.coderId);
  const amount = formatCents(updated.amountCents, updated.currency);
  if (action === "deliver") {
    notify(ctx, {
      accountId: updated.businessId,
      kind: "delivery",
      message: `Delivery ready to review for ${amount} in escrow. Check the evidence, then approve.`,
      href: `/dashboard#engagement-${updated.id}`,
      engagementId: updated.id,
    });
  } else if (action === "approve" && coderAccount !== undefined) {
    notify(ctx, {
      accountId: coderAccount,
      kind: "approved",
      message: `Approved. ${formatCents(updated.payoutCents, updated.currency)} is on its way to you.`,
      href: `/dashboard#engagement-${updated.id}`,
      engagementId: updated.id,
    });
  } else if (action === "cancel") {
    const recipient = account.role === "business" ? coderAccount : updated.businessId;
    if (recipient !== undefined) {
      notify(ctx, {
        accountId: recipient,
        kind: "cancelled",
        message: `The ${amount} engagement was cancelled and the escrow refunded.`,
        href: `/dashboard#engagement-${updated.id}`,
        engagementId: updated.id,
      });
    }
  } else if (action === "dispute") {
    const recipient = account.role === "business" ? coderAccount : updated.businessId;
    if (recipient !== undefined) {
      notify(ctx, {
        accountId: recipient,
        kind: "disputed",
        message: `A dispute was raised on a ${amount} engagement. The money stays in escrow until an operator decides.`,
        href: `/dashboard#engagement-${updated.id}`,
        engagementId: updated.id,
      });
    }
  }
  return updated;
}

export function listEngagements(ctx: AppContext, account: AccountRow): Engagement[] {
  const rows =
    account.role === "coder"
      ? queryAll<EngagementRow>(
          ctx.db,
          `SELECT ${ENGAGEMENT_COLUMNS} FROM engagements e
           WHERE coder_id IN (SELECT id FROM coder_profiles WHERE account_id = ?)
           ORDER BY created_at DESC`,
          [account.id],
        )
      : queryAll<EngagementRow>(
          ctx.db,
          `SELECT ${ENGAGEMENT_COLUMNS} FROM engagements WHERE business_id = ? ORDER BY created_at DESC`,
          [account.id],
        );
  return rows.map(toEngagement);
}

/** The most recent engagement for a job, if any (cancelled ones included). */
export function getEngagementForJob(ctx: AppContext, jobId: string): Engagement | null {
  const row = queryOne<EngagementRow>(
    ctx.db,
    `SELECT ${ENGAGEMENT_COLUMNS} FROM engagements WHERE job_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    [jobId],
  );
  return row === undefined ? null : toEngagement(row);
}

export function ledgerForEngagement(ctx: AppContext, engagementId: string): LedgerEntry[] {
  return queryAll<LedgerRow>(
    ctx.db,
    `SELECT ${LEDGER_COLUMNS} FROM ledger_entries WHERE engagement_id = ? ORDER BY created_at ASC, rowid ASC`,
    [engagementId],
  ).map(toLedgerEntry);
}

export interface LedgerTotals {
  readonly chargedCents: number;
  readonly feeCents: number;
  readonly payoutCents: number;
  readonly refundedCents: number;
  readonly heldCents: number;
  readonly entryCount: number;
  readonly currency: string;
}

export interface LedgerReport {
  readonly totals: LedgerTotals;
  readonly entries: LedgerEntry[];
}

export function ledgerReport(ctx: AppContext): LedgerReport {
  const sums = queryAll<{ kind: LedgerKind; total: number; count: number }>(
    ctx.db,
    "SELECT kind, SUM(amount_cents) AS total, COUNT(*) AS count FROM ledger_entries GROUP BY kind",
  );
  const byKind = new Map<LedgerKind, number>();
  let entryCount = 0;
  for (const row of sums) {
    byKind.set(row.kind, Number(row.total));
    entryCount += Number(row.count);
  }

  const chargedCents = byKind.get("charge") ?? 0;
  const feeCents = byKind.get("platform_fee") ?? 0;
  const payoutCents = byKind.get("payout") ?? 0;
  const refundedCents = Math.abs(byKind.get("refund") ?? 0);

  const currencies = queryAll<{ currency: string }>(
    ctx.db,
    "SELECT DISTINCT currency FROM ledger_entries",
  );
  const currency =
    currencies.length === 1
      ? (currencies[0]?.currency ?? "EUR")
      : currencies.length === 0
        ? "EUR"
        : "MIXED";

  const entries = queryAll<LedgerRow>(
    ctx.db,
    `SELECT ${LEDGER_COLUMNS} FROM ledger_entries ORDER BY created_at DESC, rowid DESC LIMIT 200`,
  ).map(toLedgerEntry);

  return {
    totals: {
      chargedCents,
      feeCents,
      payoutCents,
      refundedCents,
      heldCents: chargedCents - refundedCents - feeCents - payoutCents,
      entryCount,
      currency,
    },
    entries,
  };
}
