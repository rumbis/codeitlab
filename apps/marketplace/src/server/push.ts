import type { AppContext } from "./context.ts";
import { execute, executeChanges, queryAll, queryOne } from "./db.ts";

/**
 * Web Push without a dependency: VAPID (RFC 8292) for the Authorization header
 * and aes128gcm (RFC 8291) for the payload, both built on WebCrypto. The payload
 * is encrypted to the browser's subscription keys, so the push service only
 * sees ciphertext — the notification text never leaves our server in the clear.
 */

export interface PushKeys {
  /** Raw P-256 public key, base64url (65 bytes, uncompressed). */
  readonly publicKey: string;
  /** PKCS#8 private key, base64url. */
  readonly privateKey: string;
  /** mailto: or https: contact for the VAPID `sub` claim. */
  readonly subject: string;
}

export interface PushSubscription {
  readonly id: string;
  readonly accountId: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
  readonly createdAt: string;
  readonly lastSuccessAt: string | null;
  readonly lastError: string;
}

export interface PushMessage {
  readonly title: string;
  readonly body: string;
  readonly href: string;
}

export const PUSH_TTL_SECONDS = 60 * 60 * 24;
export const PUSH_SEND_TIMEOUT_MS = 5_000;

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromB64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** WebCrypto's BufferSource wants ArrayBuffer-backed views; copies to be explicit. */
function source(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

export function pushKeysFromEnv(
  env: Record<string, string | undefined> = process.env,
): PushKeys | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  if (publicKey === "" && privateKey === "") return null;
  if (publicKey === "" || privateKey === "") {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together.");
  }
  return {
    publicKey,
    privateKey,
    subject: (env.VAPID_SUBJECT ?? "mailto:security@codeitlab.com").trim(),
  };
}

/** One-shot key generation for operators; prints env lines (see scripts/push-keys.ts). */
export async function generatePushKeys(
  subject = "mailto:security@codeitlab.com",
): Promise<PushKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const privatePkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { publicKey: b64(publicRaw), privateKey: b64(privatePkcs8), subject };
}

function originOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

async function vapidAuthorization(
  keys: PushKeys,
  endpoint: string,
  nowMs: number,
): Promise<string> {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    source(fromB64(keys.privateKey)),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const header = b64(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64(
    utf8(
      JSON.stringify({
        aud: originOf(endpoint),
        exp: Math.floor(nowMs / 1000) + 12 * 60 * 60,
        sub: keys.subject,
      }),
    ),
  );
  const unsigned = `${header}.${claims}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      source(utf8(unsigned)),
    ),
  );
  return `vapid t=${unsigned}.${b64(signature)}, k=${keys.publicKey}`;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", source(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: source(salt), info: source(info) },
      key,
      bits,
    ),
  );
}

export interface EncryptedPush {
  readonly body: Uint8Array;
  /** The ephemeral public key the receiver needs (also embedded in the body). */
  readonly serverPublicKey: Uint8Array;
  readonly salt: Uint8Array;
}

/**
 * RFC 8291 aes128gcm. The receiver is the browser: it derives the same keys from
 * its private key + our ephemeral public key, so the push service cannot read
 * the payload.
 */
export async function encryptWebPush(input: {
  readonly payload: string;
  readonly p256dh: string;
  readonly auth: string;
}): Promise<EncryptedPush> {
  const uaPublic = fromB64(input.p256dh);
  const authSecret = fromB64(input.auth);
  const uaKey = await crypto.subtle.importKey(
    "raw",
    source(uaPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ephemeral = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256),
  );

  const authInfo = new Uint8Array([...utf8("WebPush: info"), 0, ...uaPublic, ...serverPublic]);
  const ikm = await hkdf(ecdhSecret, authSecret, authInfo, 256);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, utf8("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, utf8("Content-Encoding: nonce\0"), 96);

  const aesKey = await crypto.subtle.importKey("raw", source(cek), "AES-GCM", false, ["encrypt"]);
  const plaintext = new Uint8Array([...utf8(input.payload), 0x02]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: source(nonce) }, aesKey, source(plaintext)),
  );

  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const body = new Uint8Array([
    ...salt,
    ...recordSize,
    serverPublic.length,
    ...serverPublic,
    ...ciphertext,
  ]);
  return { body, serverPublicKey: serverPublic, salt };
}

export class PushGoneError extends Error {
  constructor(message = "Push subscription is gone.") {
    super(message);
    this.name = "PushGoneError";
  }
}

export async function sendPush(
  ctx: AppContext,
  subscription: Pick<PushSubscription, "endpoint" | "p256dh" | "auth">,
  message: PushMessage,
): Promise<void> {
  const keys = ctx.push;
  if (keys === null) throw new Error("Push is not configured.");
  const payload = JSON.stringify({
    title: message.title,
    body: message.body,
    href: message.href,
  });
  const encrypted = await encryptWebPush({
    payload,
    p256dh: subscription.p256dh,
    auth: subscription.auth,
  });
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(PUSH_TTL_SECONDS),
      authorization: await vapidAuthorization(keys, subscription.endpoint, ctx.now().getTime()),
    },
    body: source(encrypted.body),
    signal: AbortSignal.timeout(PUSH_SEND_TIMEOUT_MS),
  });
  if (response.status === 404 || response.status === 410) throw new PushGoneError();
  if (!response.ok) throw new Error(`push service returned HTTP ${response.status}`);
}

const SUBSCRIPTION_COLUMNS = `id, account_id AS accountId, endpoint, p256dh, auth,
  created_at AS createdAt, last_success_at AS lastSuccessAt, last_error AS lastError`;

export function listPushSubscriptions(ctx: AppContext, accountId: string): PushSubscription[] {
  return queryAll<PushSubscription>(
    ctx.db,
    `SELECT ${SUBSCRIPTION_COLUMNS} FROM push_subscriptions WHERE account_id = ? ORDER BY created_at DESC`,
    [accountId],
  );
}

export function savePushSubscription(
  ctx: AppContext,
  accountId: string,
  input: { readonly endpoint: string; readonly p256dh: string; readonly auth: string },
): void {
  execute(
    ctx.db,
    `INSERT INTO push_subscriptions (id, account_id, endpoint, p256dh, auth, created_at, last_success_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, NULL, '')
     ON CONFLICT(endpoint) DO UPDATE SET
       account_id = excluded.account_id, p256dh = excluded.p256dh, auth = excluded.auth,
       last_error = ''`,
    [
      `push_${crypto.randomUUID()}`,
      accountId,
      input.endpoint,
      input.p256dh,
      input.auth,
      ctx.now().toISOString(),
    ],
  );
}

export function removePushSubscription(
  ctx: AppContext,
  accountId: string,
  endpoint: string,
): boolean {
  return (
    executeChanges(ctx.db, "DELETE FROM push_subscriptions WHERE account_id = ? AND endpoint = ?", [
      accountId,
      endpoint,
    ]) > 0
  );
}

interface PushOutboxRow {
  readonly id: string;
  readonly accountId: string;
  readonly title: string;
  readonly body: string;
  readonly href: string;
  readonly attempts: number;
}

/** Queue one push per notification; delivery happens on the drain, never inline. */
export function enqueuePush(
  ctx: AppContext,
  input: {
    readonly accountId: string;
    readonly title: string;
    readonly body: string;
    readonly href: string;
  },
): void {
  if (ctx.push === null) return;
  const now = ctx.now().toISOString();
  execute(
    ctx.db,
    `INSERT INTO push_outbox (id, account_id, title, body, href, attempts, next_attempt_at, delivered_at, last_error, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, NULL, '', ?)`,
    [
      `pushmsg_${crypto.randomUUID()}`,
      input.accountId,
      input.title,
      input.body,
      input.href,
      now,
      now,
    ],
  );
}

function backoffMs(attempts: number): number {
  return Math.min(30 * attempts * attempts, 3_600) * 1_000;
}

export interface PushDrainResult {
  readonly delivered: number;
  readonly failed: number;
  readonly pending: number;
  readonly sent: number;
}

export async function drainPush(
  ctx: AppContext,
  options: { readonly limit?: number } = {},
): Promise<PushDrainResult> {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const due = queryAll<PushOutboxRow>(
    ctx.db,
    `SELECT id, account_id AS accountId, title, body, href, attempts
     FROM push_outbox WHERE delivered_at IS NULL AND next_attempt_at <= ?
     ORDER BY next_attempt_at ASC, rowid ASC LIMIT ?`,
    [ctx.now().toISOString(), limit],
  );
  let delivered = 0;
  let failed = 0;
  let sent = 0;
  for (const row of due) {
    const subscriptions = listPushSubscriptions(ctx, row.accountId);
    if (subscriptions.length === 0) {
      executeChanges(
        ctx.db,
        "UPDATE push_outbox SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL",
        [ctx.now().toISOString(), row.id],
      );
      delivered += 1;
      continue;
    }
    let ok = true;
    let lastError = "";
    for (const subscription of subscriptions) {
      try {
        await sendPush(ctx, subscription, { title: row.title, body: row.body, href: row.href });
        sent += 1;
        execute(
          ctx.db,
          "UPDATE push_subscriptions SET last_success_at = ?, last_error = '' WHERE id = ?",
          [ctx.now().toISOString(), subscription.id],
        );
      } catch (error) {
        if (error instanceof PushGoneError) {
          executeChanges(ctx.db, "DELETE FROM push_subscriptions WHERE id = ?", [subscription.id]);
          continue;
        }
        ok = false;
        lastError = error instanceof Error ? error.message : "push failed";
        execute(ctx.db, "UPDATE push_subscriptions SET last_error = ? WHERE id = ?", [
          lastError.slice(0, 500),
          subscription.id,
        ]);
      }
    }
    if (ok) {
      executeChanges(
        ctx.db,
        "UPDATE push_outbox SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL",
        [ctx.now().toISOString(), row.id],
      );
      delivered += 1;
    } else {
      const attempts = row.attempts + 1;
      execute(
        ctx.db,
        `UPDATE push_outbox SET attempts = ?, next_attempt_at = ?, last_error = ?
         WHERE id = ? AND delivered_at IS NULL`,
        [
          attempts,
          new Date(ctx.now().getTime() + backoffMs(attempts)).toISOString(),
          lastError.slice(0, 500),
          row.id,
        ],
      );
      failed += 1;
    }
  }
  const pending = queryOne<{ count: number }>(
    ctx.db,
    "SELECT COUNT(*) AS count FROM push_outbox WHERE delivered_at IS NULL",
  );
  return { delivered, failed, pending: Number(pending?.count ?? 0), sent };
}

export function pushStatus(ctx: AppContext): {
  enabled: boolean;
  subscriptions: number;
  pending: number;
  delivered: number;
  failed: number;
} {
  const count = (sql: string): number =>
    Number(queryOne<{ count: number }>(ctx.db, sql)?.count ?? 0);
  return {
    enabled: ctx.push !== null,
    subscriptions: count("SELECT COUNT(*) AS count FROM push_subscriptions"),
    pending: count("SELECT COUNT(*) AS count FROM push_outbox WHERE delivered_at IS NULL"),
    delivered: count("SELECT COUNT(*) AS count FROM push_outbox WHERE delivered_at IS NOT NULL"),
    failed: count(
      "SELECT COUNT(*) AS count FROM push_outbox WHERE delivered_at IS NULL AND attempts > 0",
    ),
  };
}
