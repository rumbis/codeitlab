import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, executeChanges, queryAll, queryOne } from "./db.ts";
import { signWebhookPayload } from "./webhook.ts";

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

export const MAIL_SEND_TIMEOUT_MS = 5_000;

/** Development transport: the code is printed, never returned or logged in prod. */
export function createLogMailTransport(
  log: (message: string) => void = (message) => console.log(message),
): MailTransport {
  return {
    name: "log",
    send(message) {
      log(`[marketplace] mail to ${message.to}: ${message.subject}\n${message.text}`);
      return Promise.resolve();
    },
  };
}

/**
 * Provider-agnostic delivery: POST the message as JSON to a gateway the operator
 * already runs (Resend/Postmark/SES relay). Signed with the same Stripe-style
 * scheme as webhooks when a secret is configured, so the receiver can reject
 * forged mail instead of trusting the network.
 */
export function createWebhookMailTransport(options: {
  readonly url: string;
  readonly secret?: string;
  readonly fetchImpl?: typeof fetch;
}): MailTransport {
  return {
    name: "webhook",
    async send(message) {
      const body = JSON.stringify({
        event: "mail.send",
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (options.secret !== undefined && options.secret !== "") {
        headers["x-codeitlab-signature"] = signWebhookPayload(
          body,
          options.secret,
          Math.floor(Date.now() / 1000),
        );
      }
      const fetchImpl = options.fetchImpl ?? fetch;
      const response = await fetchImpl(options.url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(MAIL_SEND_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`mail gateway returned HTTP ${response.status}`);
    },
  };
}

/**
 * What a deployment gets without an explicit transport: in dev the console hook
 * already prints the code, so mail is a no-op there; in production the operator
 * must name a transport (the app refuses to start otherwise, because otherwise
 * nobody could ever log in).
 */
export function createDefaultMailTransport(devEmail: boolean): MailTransport {
  if (devEmail) {
    return {
      name: "dev-console",
      send() {
        return Promise.resolve();
      },
    };
  }
  const kind = process.env.MARKETPLACE_MAIL_TRANSPORT ?? "";
  if (kind === "webhook") {
    const url = process.env.MARKETPLACE_MAIL_WEBHOOK ?? "";
    if (url === "") {
      throw new Error("MARKETPLACE_MAIL_TRANSPORT=webhook requires MARKETPLACE_MAIL_WEBHOOK.");
    }
    return createWebhookMailTransport({
      url,
      secret: process.env.MARKETPLACE_MAIL_SECRET ?? "",
    });
  }
  if (kind === "log") return createLogMailTransport();
  return nullMailTransport;
}

/** No transport configured: sends fail and fall back to the durable outbox. */
export const nullMailTransport: MailTransport = {
  name: "none",
  send() {
    return Promise.reject(new Error("No mail transport is configured."));
  },
};

export interface MailOutboxRow {
  readonly id: string;
  readonly toEmail: string;
  readonly subject: string;
  readonly body: string;
  readonly attempts: number;
  readonly nextAttemptAt: string;
  readonly deliveredAt: string | null;
  readonly lastError: string;
}

const OUTBOX_COLUMNS = `id, to_email AS toEmail, subject, body, attempts,
  next_attempt_at AS nextAttemptAt, delivered_at AS deliveredAt, last_error AS lastError`;

function backoffMs(attempts: number): number {
  return Math.min(30 * attempts * attempts, 3_600) * 1_000;
}

export function enqueueMail(ctx: AppContext, message: MailMessage): void {
  const now = ctx.now().toISOString();
  execute(
    ctx.db,
    `INSERT INTO email_outbox
      (id, to_email, subject, body, attempts, next_attempt_at, delivered_at, last_error, created_at)
     VALUES (?, ?, ?, ?, 0, ?, NULL, '', ?)`,
    [`mail_${NodeCrypto.randomUUID()}`, message.to, message.subject, message.text, now, now],
  );
}

export interface MailDrainResult {
  readonly delivered: number;
  readonly failed: number;
  readonly pending: number;
}

/**
 * Deliver queued mail. Called by an operator/cron, never by the request that
 * needs it, so a slow gateway cannot stall a login or a payment. Failures keep
 * the row pending with an attempt count and a backoff capped at one hour.
 */
export async function drainMail(
  ctx: AppContext,
  options: { readonly limit?: number } = {},
): Promise<MailDrainResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const due = queryAll<MailOutboxRow>(
    ctx.db,
    `SELECT ${OUTBOX_COLUMNS} FROM email_outbox
     WHERE delivered_at IS NULL AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC, rowid ASC LIMIT ?`,
    [ctx.now().toISOString(), limit],
  );

  let delivered = 0;
  let failed = 0;
  for (const row of due) {
    try {
      await ctx.mail.send({ to: row.toEmail, subject: row.subject, text: row.body });
      executeChanges(
        ctx.db,
        "UPDATE email_outbox SET delivered_at = ?, last_error = '' WHERE id = ? AND delivered_at IS NULL",
        [ctx.now().toISOString(), row.id],
      );
      delivered += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const message = error instanceof Error ? error.message : "send failed";
      execute(
        ctx.db,
        `UPDATE email_outbox SET attempts = ?, next_attempt_at = ?, last_error = ?
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
    "SELECT COUNT(*) AS count FROM email_outbox WHERE delivered_at IS NULL",
  );
  return { delivered, failed, pending: Number(pending?.count ?? 0) };
}

export function mailOutboxStatus(ctx: AppContext): {
  pending: number;
  delivered: number;
  failed: number;
  recent: readonly MailOutboxRow[];
} {
  const pending = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM email_outbox WHERE delivered_at IS NULL",
  );
  const delivered = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM email_outbox WHERE delivered_at IS NOT NULL",
  );
  const failed = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM email_outbox WHERE delivered_at IS NULL AND attempts > 0",
  );
  const recent = queryAll<MailOutboxRow>(
    ctx.db,
    `SELECT ${OUTBOX_COLUMNS} FROM email_outbox ORDER BY created_at DESC, rowid DESC LIMIT 20`,
  );
  return {
    pending: Number(pending?.count ?? 0),
    delivered: Number(delivered?.count ?? 0),
    failed: Number(failed?.count ?? 0),
    recent,
  };
}

/**
 * Send one login code. Delivery is attempted immediately (a login that waits
 * for a cron feels broken); if the gateway is slow or down the message goes to
 * the durable outbox instead of failing the request, so the code still arrives.
 */
export async function sendLoginCode(
  ctx: AppContext,
  input: { readonly to: string; readonly code: string; readonly minutes: number },
): Promise<void> {
  const message: MailMessage = {
    to: input.to,
    subject: "Your CodeitLab Marketplace login code",
    text: `Your login code is ${input.code}. It expires in ${input.minutes} minutes.\n\nIf you did not request this, ignore this email; the code cannot be used without it.`,
  };
  try {
    await ctx.mail.send(message);
  } catch {
    // Never surface delivery failure to the caller: that would leak which
    // addresses are registered. The outbox retries with backoff.
    enqueueMail(ctx, message);
  }
}
