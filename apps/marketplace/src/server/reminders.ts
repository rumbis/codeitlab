import { formatCents } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { queryAll, queryOne } from "./db.ts";
import { notify } from "./notifications.ts";

/** A delivery older than this is "waiting on the business" rather than fresh. */
export const DELIVERY_REMINDER_AFTER_MS = 3 * 24 * 60 * 60 * 1000;
/** Never send the same reminder more than once per this window. */
export const DELIVERY_REMINDER_DEDUPE_MS = 48 * 60 * 60 * 1000;

interface WaitingDeliveryRow {
  readonly id: string;
  readonly businessId: string;
  readonly amountCents: number;
  readonly currency: string;
}

/**
 * Nudge businesses whose coder already delivered and who have not reviewed it
 * yet. The coder did the work and is waiting for money; the business is the one
 * who lost track. This only writes notifications — it never approves, pays or
 * changes an engagement, and the 48h dedupe keeps it from nagging.
 */
export function runDeliveryReminders(ctx: AppContext): { readonly reminded: number } {
  const now = ctx.now();
  const deliveredBefore = new Date(now.getTime() - DELIVERY_REMINDER_AFTER_MS).toISOString();
  const dedupeAfter = new Date(now.getTime() - DELIVERY_REMINDER_DEDUPE_MS).toISOString();
  const waiting = queryAll<WaitingDeliveryRow>(
    ctx.db,
    `SELECT e.id, e.business_id AS businessId, e.amount_cents AS amountCents, e.currency
     FROM engagements e
     WHERE e.status = 'delivered'
       AND e.updated_at <= ?
       AND NOT EXISTS (
         SELECT 1 FROM notifications n
         WHERE n.engagement_id = e.id
           AND n.kind = 'delivery'
           AND n.created_at > ?
       )
     ORDER BY e.updated_at ASC`,
    [deliveredBefore, dedupeAfter],
  );
  for (const engagement of waiting) {
    notify(ctx, {
      accountId: engagement.businessId,
      kind: "delivery",
      message: `A delivery has been waiting for your review for over 3 days (${formatCents(engagement.amountCents, engagement.currency)} in escrow). Approving pays the coder; asking for changes is one click.`,
      href: `/dashboard#engagement-${engagement.id}`,
      engagementId: engagement.id,
    });
  }
  return { reminded: waiting.length };
}

/** How many deliveries are currently older than the reminder threshold. */
export function waitingDeliveryCount(ctx: AppContext): number {
  const deliveredBefore = new Date(ctx.now().getTime() - DELIVERY_REMINDER_AFTER_MS).toISOString();
  return (
    queryOne<{ count: number }>(
      ctx.db,
      "SELECT COUNT(*) AS count FROM engagements WHERE status = 'delivered' AND updated_at <= ?",
      [deliveredBefore],
    )?.count ?? 0
  );
}
