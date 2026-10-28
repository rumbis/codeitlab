import { ASSISTED_FEE_BPS, type Engagement } from "../shared/contracts.ts";
import { recordAdminAction } from "./admin.ts";
import type { AppContext } from "./context.ts";
import { queryAll, queryOne } from "./db.ts";
import { parseResolutionNote } from "./disputes.ts";
import { toEngagement } from "./engagements.ts";
import { conflict, notFound } from "./errors.ts";
import { notify } from "./notifications.ts";
import type { EngagementRow } from "./types.ts";

const COLUMNS = `id, job_id AS jobId, coder_id AS coderId, business_id AS businessId,
  amount_cents AS amountCents, fee_bps AS feeBps, fee_cents AS feeCents,
  payout_cents AS payoutCents, currency, status, payment_ref AS paymentRef,
  delivery_note AS deliveryNote, delivery_evidence AS deliveryEvidence,
  resolution_outcome AS resolutionOutcome, resolution_note AS resolutionNote,
  created_at AS createdAt, updated_at AS updatedAt`;

/**
 * What the assisted tier (20%) buys: an operator reads the delivery evidence
 * before the business approves, so the buyer is not the only reviewer of work
 * they had no time to inspect. The review is advisory and recorded — it never
 * moves money, because escrow still releases only on approval or dispute.
 */
export function listAssistedDeliveries(ctx: AppContext): Engagement[] {
  const rows = queryAll<EngagementRow>(
    ctx.db,
    `SELECT ${COLUMNS} FROM engagements
     WHERE status = 'delivered' AND fee_bps >= ?
     ORDER BY updated_at ASC`,
    [ASSISTED_FEE_BPS],
  );
  return rows.map(toEngagement);
}

export function reviewAssistedDelivery(
  ctx: AppContext,
  engagementId: string,
  noteInput: unknown,
): Engagement {
  const note = parseResolutionNote(noteInput);
  const row = queryOne<EngagementRow>(ctx.db, `SELECT ${COLUMNS} FROM engagements WHERE id = ?`, [
    engagementId,
  ]);
  if (row === undefined) throw notFound("Engagement not found.", "engagement_not_found");
  if (row.feeBps < ASSISTED_FEE_BPS) {
    throw conflict(
      "This engagement is on the standard tier; assisted review applies to the 20% tier.",
      "not_assisted",
    );
  }
  if (row.status !== "delivered") {
    throw conflict(
      "Only a delivered engagement can be reviewed; approval has already released the money.",
      "not_delivered",
    );
  }

  recordAdminAction(ctx, {
    action: "assisted.review",
    targetId: engagementId,
    detail: note,
  });

  const engagement = toEngagement(row);
  const message = `An operator reviewed the delivery evidence: ${note}`;
  for (const accountId of [engagement.businessId, coderAccountId(ctx, engagement.coderId)]) {
    if (accountId !== undefined) {
      notify(ctx, {
        accountId,
        kind: "review",
        message,
        href: "/dashboard",
        engagementId,
      });
    }
  }
  return engagement;
}

function coderAccountId(ctx: AppContext, coderId: string): string | undefined {
  return queryOne<{ accountId: string }>(
    ctx.db,
    "SELECT account_id AS accountId FROM coder_profiles WHERE id = ?",
    [coderId],
  )?.accountId;
}
