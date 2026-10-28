import type { Engagement, DisputeResolution } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { queryAll, queryOne } from "./db.ts";
import {
  getEngagement,
  getEngagementRow,
  refundEscrow,
  releaseEscrow,
  toEngagement,
} from "./engagements.ts";
import { recordAdminAction } from "./admin.ts";
import { notify } from "./notifications.ts";
import { conflict, notFound } from "./errors.ts";
import type { EngagementRow } from "./types.ts";
import { badRequest } from "./errors.ts";

export const DISPUTE_OUTCOMES = ["refunded", "released"] as const;

/** Every dispute still waiting for an operator decision, oldest first. */
export function listDisputedEngagements(ctx: AppContext): Engagement[] {
  const rows = queryAll<EngagementRow>(
    ctx.db,
    `SELECT id, job_id AS jobId, coder_id AS coderId, business_id AS businessId,
            amount_cents AS amountCents, fee_bps AS feeBps, fee_cents AS feeCents,
            payout_cents AS payoutCents, currency, status, payment_ref AS paymentRef,
            delivery_note AS deliveryNote, delivery_evidence AS deliveryEvidence,
            resolution_outcome AS resolutionOutcome, resolution_note AS resolutionNote,
            created_at AS createdAt, updated_at AS updatedAt
     FROM engagements WHERE status = 'disputed' ORDER BY created_at ASC`,
  );
  return rows.map(toEngagement);
}

/** Why the operator decided this way; required so the audit trail is readable. */
export function parseResolutionNote(raw: unknown): string {
  if (typeof raw !== "string") {
    throw badRequest("A resolution note is required.", "invalid_resolution_note");
  }
  const note = raw.trim();
  if (note.length < 10) {
    throw badRequest(
      "The resolution note must be at least 10 characters.",
      "invalid_resolution_note",
    );
  }
  if (note.length > 1_000) {
    throw badRequest(
      "The resolution note can be at most 1000 characters.",
      "invalid_resolution_note",
    );
  }
  return note;
}

function parseOutcome(raw: unknown): Exclude<DisputeResolution, ""> {
  if (raw !== "refunded" && raw !== "released") {
    throw badRequest(
      "Outcome must be refunded (money back to the business) or released (paid to the coder).",
      "invalid_outcome",
    );
  }
  return raw;
}

/**
 * Close a disputed engagement. The money movement is the same escrow release or
 * refund as the normal paths, so reconcile stays exact; the operator's decision
 * and reason are stored on the row as the audit record. A second call loses the
 * compare-and-set and returns 409 instead of paying twice.
 */
export async function resolveDispute(
  ctx: AppContext,
  engagementId: string,
  outcomeInput: unknown,
  noteInput: unknown,
): Promise<Engagement> {
  const outcome = parseOutcome(outcomeInput);
  const note = parseResolutionNote(noteInput);
  const row = getEngagementRow(ctx, engagementId);
  if (row === undefined) throw notFound("Engagement not found.", "engagement_not_found");
  if (row.status !== "disputed") {
    throw conflict("Only a disputed engagement can be resolved.", "illegal_transition");
  }

  if (outcome === "refunded") {
    refundEscrow(ctx, row, { outcome, note });
  } else {
    await releaseEscrow(ctx, row, { outcome, note });
  }
  recordAdminAction(ctx, {
    action: "dispute.resolve",
    targetId: engagementId,
    detail: `${outcome}: ${note}`,
  });

  // Both parties learn the outcome and the reason at the same time.
  const coderAccount = queryOne<{ accountId: string }>(
    ctx.db,
    "SELECT account_id AS accountId FROM coder_profiles WHERE id = ?",
    [row.coderId],
  )?.accountId;
  const message =
    outcome === "refunded"
      ? "Dispute resolved: the escrow was refunded to the business."
      : "Dispute resolved: the escrow was released to the coder.";
  for (const accountId of [row.businessId, coderAccount]) {
    if (accountId !== undefined) {
      notify(ctx, {
        accountId,
        kind: "resolved",
        message: `${message} Reason: ${note}`,
        href: `/dashboard#engagement-${engagementId}`,
        engagementId,
      });
    }
  }

  const updated = getEngagement(ctx, engagementId);
  if (updated === null) throw notFound("Engagement not found.", "engagement_not_found");
  return updated;
}
