import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { enqueueMail } from "./mail.ts";
import { enqueuePush } from "./push.ts";
import { execute, executeChanges, queryAll, queryOne } from "./db.ts";
import { enqueueNotificationPush } from "./outbox.ts";

export type NotificationKind =
  | "application"
  | "engagement"
  | "delivery"
  | "approved"
  | "cancelled"
  | "disputed"
  | "resolved"
  | "review"
  | "invite"
  | "scope"
  | "shortlist"
  | "job_alert"
  | "coder_alert";

/**
 * The events worth an email: someone is waiting on the recipient, or money
 * moved. A dispute freezes escrow until a human acts, so it belongs here.
 * Everything else stays in the feed. Opt-in per account, never marketing.
 */
export const EMAIL_NOTIFICATION_KINDS: ReadonlySet<NotificationKind> = new Set([
  "application",
  "engagement",
  "invite",
  "delivery",
  "approved",
  "resolved",
  "disputed",
]);

export interface Notification {
  readonly id: string;
  readonly kind: NotificationKind;
  /** Where the recipient has to go to act on it. */
  readonly href: string;
  readonly message: string;
  readonly engagementId: string;
  readonly createdAt: string;
  readonly read: boolean;
}

interface NotificationRow {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly href: string;
  readonly message: string;
  readonly engagementId: string;
  readonly createdAt: string;
  readonly readAt: string | null;
}

const COLUMNS = `
  id, kind, href, message, engagement_id AS engagementId, created_at AS createdAt, read_at AS readAt
`;

function toNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    kind: row.kind,
    href: row.href,
    message: row.message,
    engagementId: row.engagementId,
    createdAt: row.createdAt,
    read: row.readAt !== null,
  };
}

/**
 * In-app activity feed. Each row is one event the recipient has to know about —
 * a delivery waiting for approval, an approval that released money — so the
 * dashboard answers "what needs me?" without polling email. Rows are written in
 * the same transaction as the state change that caused them.
 */
export function notify(
  ctx: AppContext,
  input: {
    readonly accountId: string;
    readonly kind: NotificationKind;
    readonly message: string;
    readonly href: string;
    readonly engagementId?: string;
  },
): void {
  const id = `ntf_${NodeCrypto.randomUUID()}`;
  const createdAt = ctx.now().toISOString();
  execute(
    ctx.db,
    `INSERT INTO notifications (id, account_id, kind, message, href, engagement_id, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
    [
      id,
      input.accountId,
      input.kind,
      input.message,
      input.href,
      input.engagementId ?? "",
      createdAt,
    ],
  );
  enqueueNotificationPush(ctx, {
    id,
    kind: input.kind,
    message: input.message,
    href: input.href,
    engagementId: input.engagementId ?? "",
    createdAt,
  });
  enqueuePush(ctx, {
    accountId: input.accountId,
    title: "CodeItLab",
    body: input.message,
    href: input.href,
  });
  if (EMAIL_NOTIFICATION_KINDS.has(input.kind)) {
    const recipient = queryOne<{ email: string; emailNotifications: number }>(
      ctx.db,
      "SELECT email, email_notifications AS emailNotifications FROM accounts WHERE id = ?",
      [input.accountId],
    );
    if (recipient !== undefined && Number(recipient.emailNotifications) === 1) {
      enqueueMail(ctx, {
        to: recipient.email,
        subject: `CodeItLab — ${EMAIL_SUBJECTS[input.kind]}`,
        text: `${input.message}\n\nOpen it: ${ctx.baseUrl}${input.href}\n\nYou get these emails because you turned on email notifications in your dashboard. Sign in and turn them off any time at ${ctx.baseUrl}/dashboard#notifications.`,
      });
    }
  }
}

const EMAIL_SUBJECTS: Partial<Record<NotificationKind, string>> = {
  application: "a coder applied to your job",
  engagement: "an engagement started",
  invite: "you are invited to apply",
  delivery: "a delivery is waiting for review",
  approved: "your delivery was approved",
  resolved: "an update on your report",
};

export function getEmailNotificationPreference(ctx: AppContext, accountId: string): boolean {
  return (
    Number(
      queryOne<{ enabled: number }>(
        ctx.db,
        "SELECT email_notifications AS enabled FROM accounts WHERE id = ?",
        [accountId],
      )?.enabled ?? 0,
    ) === 1
  );
}

export function setEmailNotificationPreference(
  ctx: AppContext,
  accountId: string,
  enabled: boolean,
): boolean {
  execute(ctx.db, "UPDATE accounts SET email_notifications = ? WHERE id = ?", [
    enabled ? 1 : 0,
    accountId,
  ]);
  return enabled;
}

export function listNotifications(ctx: AppContext, accountId: string, limit = 20): Notification[] {
  const bounded = Math.min(Math.max(limit, 1), 100);
  return queryAll<NotificationRow>(
    ctx.db,
    `SELECT ${COLUMNS} FROM notifications WHERE account_id = ?
     ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    [accountId, bounded],
  ).map(toNotification);
}

export function unreadNotificationCount(ctx: AppContext, accountId: string): number {
  const row = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM notifications WHERE account_id = ? AND read_at IS NULL",
    [accountId],
  );
  return Number(row?.count ?? 0);
}

export function markNotificationsRead(ctx: AppContext, accountId: string): number {
  return executeChanges(
    ctx.db,
    "UPDATE notifications SET read_at = ? WHERE account_id = ? AND read_at IS NULL",
    [ctx.now().toISOString(), accountId],
  );
}
