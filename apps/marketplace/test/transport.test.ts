import { describe, expect, it } from "vite-plus/test";

import { collectBody, MAX_BODY_BYTES, SERVER_TIMEOUTS } from "../src/server/transport.ts";

async function* chunks(...sizes: number[]): AsyncIterable<Uint8Array> {
  for (const size of sizes) yield new Uint8Array(size).fill(65);
}

describe("transport limits", () => {
  it("collects a body under the limit", async () => {
    const result = await collectBody(chunks(10, 20, 30));
    expect(result.ok).toBe(true);
    expect(result.body.length).toBe(60);
  });

  it("stops as soon as the body passes the limit", async () => {
    let consumed = 0;
    async function* counted(): AsyncIterable<Uint8Array> {
      for (let index = 0; index < 10; index += 1) {
        consumed += 1;
        yield new Uint8Array(MAX_BODY_BYTES);
      }
    }
    const result = await collectBody(counted());
    expect(result.ok).toBe(false);
    expect(result.body.length).toBe(0);
    // Two chunks are enough to prove it stopped reading: 64 KiB + 64 KiB.
    expect(consumed).toBeLessThanOrEqual(2);
  });

  it("accepts an empty body", async () => {
    const result = await collectBody(chunks());
    expect(result.ok).toBe(true);
    expect(result.body.length).toBe(0);
  });

  it("keeps timeouts in a sane order", () => {
    expect(SERVER_TIMEOUTS.headersTimeoutMs).toBeLessThan(SERVER_TIMEOUTS.requestTimeoutMs);
    expect(SERVER_TIMEOUTS.keepAliveTimeoutMs).toBeGreaterThan(0);
    expect(SERVER_TIMEOUTS.requestTimeoutMs).toBeLessThanOrEqual(60_000);
  });
});
