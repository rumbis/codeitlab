import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, executeChanges, queryAll, queryOne } from "./db.ts";
import { signWebhookPayload } from "./webhook.ts";

const MAX_ATTEMPTS_BEFORE_HOUR = 12;

export interface OutboxRow {
  readonly id: string;
  readonly notificationId: string;
  readonly url: string;
  readonly payload: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly deliveredAt: string | null;
  readonly lastError: string;
  readonly createdAt: string;
}

export interface OutboxDrainResult {
  readonly delivered: number;
  readonly failed: number;
  readonly pending: number;
}

export interface OutboxStatus {
  readonly pending: number;
  readonly delivered: number;
  readonly failed: number;
  readonly recent: readonly OutboxRow[];
}

function backoffMs(attempts: number): number {
  const seconds = Math.min(30 * attempts * attempts, 3_600);
  return seconds * 1_000;
}

/**
 * Queue one notification for the external channel. The row is written in the
 * same transaction as the notification itself, so an outbox push can never be
 * lost by a crash between the two.
 */
export function enqueueNotificationPush(
  ctx: AppContext,
  notification: {
    readonly id: string;
    readonly kind: string;
    readonly message: string;
    readonly href: string;
    readonly engagementId: string;
    readonly createdAt: string;
  },
): void {
  if (ctx.notifyWebhook === "") return;
  const payload = JSON.stringify({
    event: `notification.${notification.kind}`,
    id: notification.id,
    message: notification.message,
    href: notification.href,
    engagementId: notification.engagementId,
    createdAt: notification.createdAt,
  });
  execute(
    ctx.db,
    `INSERT INTO notification_outbox
      (id, notification_id, url, payload, attempts, next_attempt_at, delivered_at, last_error, created_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, '', ?)`,
    [
      `out_${NodeCrypto.randomUUID()}`,
      notification.id,
      ctx.notifyWebhook,
      payload,
      notification.createdAt,
      notification.createdAt,
    ],
  );
}

/**
 * Deliver due outbox rows. Called by an operator or cron, not by the request
 * that created them: a slow or failing receiver must never delay escrow or a
 * payout. Retries back off up to an hour; the attempt count and the last error
 * stay on the row for inspection.
 */
export async function drainOutbox(
  ctx: AppContext,
  options: { readonly limit?: number; readonly fetchImpl?: typeof fetch } = {},
): Promise<OutboxDrainResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const now = ctx.now().toISOString();
  const due = queryAll<OutboxRow>(
    ctx.db,
    `SELECT id, notification_id AS notificationId, url, payload, attempts,
            next_attempt_at AS nextAttemptAt, delivered_at AS deliveredAt,
            last_error AS lastError, created_at AS createdAt
     FROM notification_outbox
     WHERE delivered_at IS NULL AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC, rowid ASC LIMIT ?`,
    [now, limit],
  );

  let delivered = 0;
  let failed = 0;
  for (const row of due) {
    const timestamp = Math.floor(ctx.now().getTime() / 1000);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-codeitlab-event": JSON.parse(row.payload).event as string,
    };
    if (ctx.notifySecret !== "") {
      headers["x-codeitlab-signature"] = signWebhookPayload(
        row.payload,
        ctx.notifySecret,
        timestamp,
      );
    }

    try {
      const response = await fetchImpl(row.url, {
        method: "POST",
        headers,
        body: row.payload,
      });
      if (response.ok) {
        executeChanges(
          ctx.db,
          "UPDATE notification_outbox SET delivered_at = ?, last_error = '' WHERE id = ? AND delivered_at IS NULL",
          [ctx.now().toISOString(), row.id],
        );
        delivered += 1;
      } else {
        const attempts = row.attempts + 1;
        execute(
          ctx.db,
          `UPDATE notification_outbox SET attempts = ?, next_attempt_at = ?, last_error = ?
           WHERE id = ? AND delivered_at IS NULL`,
          [
            attempts,
            new Date(ctx.now().getTime() + backoffMs(attempts)).toISOString(),
            `HTTP ${response.status}`,
            row.id,
          ],
        );
        failed += 1;
      }
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = error instanceof Error ? error.message : "request failed";
      execute(
        ctx.db,
        `UPDATE notification_outbox SET attempts = ?, next_attempt_at = ?, last_error = ?
         WHERE id = ? AND delivered_at IS NULL`,
        [
          attempts,
          new Date(ctx.now().getTime() + backoffMs(attempts)).toISOString(),
          message.slice(0, 500),
          row.id,
        ],
      );
      failed += 1;
    }
  }

  const pending = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM notification_outbox WHERE delivered_at IS NULL",
  );
  return { delivered, failed, pending: Number(pending?.count ?? 0) };
}

export function outboxStatus(ctx: AppContext): OutboxStatus {
  const pending = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM notification_outbox WHERE delivered_at IS NULL",
  );
  const delivered = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM notification_outbox WHERE delivered_at IS NOT NULL",
  );
  const failed = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM notification_outbox WHERE delivered_at IS NULL AND attempts > 0",
  );
  const recent = queryAll<OutboxRow>(
    ctx.db,
    `SELECT id, notification_id AS notificationId, url, payload, attempts,
            next_attempt_at AS nextAttemptAt, delivered_at AS deliveredAt,
            last_error AS lastError, created_at AS createdAt
     FROM notification_outbox ORDER BY created_at DESC, rowid DESC LIMIT 20`,
  );
  return {
    pending: Number(pending?.count ?? 0),
    delivered: Number(delivered?.count ?? 0),
    failed: Number(failed?.count ?? 0),
    recent,
  };
}

export const OUTBOX_MAX_ATTEMPTS_BEFORE_HOUR = MAX_ATTEMPTS_BEFORE_HOUR;
