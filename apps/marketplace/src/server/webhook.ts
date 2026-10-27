import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, queryOne } from "./db.ts";
import { badRequest } from "./errors.ts";

/**
 * Stripe-style webhook signature: `t=<unix seconds>,v1=<hex hmac>[,v1=...]`.
 * The signed payload is `${t}.${rawBody}` with HMAC-SHA256. We reject a stale
 * timestamp so a captured request cannot be replayed later, and compare in
 * constant time so a wrong signature cannot be brute-forced by timing.
 */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface SignatureInput {
  readonly payload: string;
  readonly header: string;
  readonly secret: string;
  readonly nowSeconds?: number;
  readonly toleranceSeconds?: number;
}

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = Number.NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = Number(value);
    if (key === "v1" && value !== "") signatures.push(value);
  }
  return { timestamp, signatures };
}

export function verifyWebhookSignature(input: SignatureInput): boolean {
  if (input.secret === "" || input.header === "") return false;
  const { timestamp, signatures } = parseSignatureHeader(input.header);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = NodeCrypto.createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.payload}`)
    .digest();
  return signatures.some((signature) => {
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, "hex");
    } catch {
      return false;
    }
    return provided.length === expected.length && NodeCrypto.timingSafeEqual(provided, expected);
  });
}

export function signWebhookPayload(payload: string, secret: string, timestamp: number): string {
  const signature = NodeCrypto.createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

export interface WebhookEvent {
  readonly id: string;
  readonly type: string;
}

/**
 * Parse the minimum a payment provider guarantees: an event id and a type. The
 * raw payload is stored, so a later handler can re-read fields without the
 * marketplace having to mirror the provider's schema.
 */
export function parseWebhookEvent(raw: string): WebhookEvent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw badRequest("Webhook body must be JSON.", "invalid_webhook");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("Webhook body must be a JSON object.", "invalid_webhook");
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const type = typeof record.type === "string" ? record.type.trim() : "";
  if (id === "" || id.length > 200 || type === "" || type.length > 120) {
    throw badRequest("Webhook needs an id and a type.", "invalid_webhook");
  }
  return { id, type };
}

/** Store a verified event once. Replays return `duplicate: true` and change nothing. */
export function recordWebhookEvent(
  ctx: AppContext,
  input: { provider: string; event: WebhookEvent; payload: string },
): { duplicate: boolean } {
  const existing = queryOne<{ id: string }>(
    ctx.db,
    "SELECT id FROM payment_events WHERE provider = ? AND event_id = ?",
    [input.provider, input.event.id],
  );
  if (existing !== undefined) return { duplicate: true };

  execute(
    ctx.db,
    `INSERT INTO payment_events (id, provider, event_id, kind, payload, received_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      NodeCrypto.randomUUID(),
      input.provider,
      input.event.id,
      input.event.type,
      input.payload,
      ctx.now().toISOString(),
    ],
  );
  return { duplicate: false };
}
