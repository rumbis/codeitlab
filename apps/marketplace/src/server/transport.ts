/**
 * Transport-level limits for the Node HTTP server. The app checks the body size
 * again when it parses, but by then `request.text()` has already buffered
 * everything — so the socket has to stop reading early, or a client can make the
 * process hold an arbitrarily large body in memory before the check runs.
 */
export const MAX_BODY_BYTES = 64 * 1024;

export interface CollectResult {
  readonly ok: boolean;
  readonly body: Buffer;
}

/** Read an incoming body, stopping as soon as it exceeds `limit` bytes. */
export async function collectBody(
  chunks: AsyncIterable<Uint8Array>,
  limit = MAX_BODY_BYTES,
): Promise<CollectResult> {
  const parts: Buffer[] = [];
  let total = 0;
  for await (const chunk of chunks) {
    total += chunk.byteLength;
    if (total > limit) return { ok: false, body: Buffer.alloc(0) };
    parts.push(Buffer.from(chunk));
  }
  return { ok: true, body: Buffer.concat(parts) };
}

/**
 * Timeouts that stop a stalled or slow-writing client from holding a socket
 * forever (slowloris). `requestTimeout` covers the whole request, including the
 * body; `headersTimeout` covers just the headers; `keepAliveTimeout` frees idle
 * connections quickly behind a proxy.
 */
export const SERVER_TIMEOUTS = {
  requestTimeoutMs: 30_000,
  headersTimeoutMs: 15_000,
  keepAliveTimeoutMs: 5_000,
} as const;
