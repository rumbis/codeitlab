import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  parseWebhookEvent,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from "../src/server/webhook.ts";
import { createTestApp, START_TIME, type TestApp } from "./helpers.ts";

const SECRET = "whsec_test_secret";
const NOW_SECONDS = Math.floor(START_TIME.getTime() / 1000);
const EVENT = { id: "evt_123", type: "payment_intent.succeeded", data: { object: {} } };
const RAW = JSON.stringify(EVENT);

let apps: TestApp[] = [];

afterEach(() => {
  for (const app of apps) app.close();
  apps = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp(overrides);
  apps.push(app);
  return app;
}

describe("webhook signature", () => {
  it("accepts a correctly signed payload", () => {
    const header = signWebhookPayload(RAW, SECRET, NOW_SECONDS);
    expect(
      verifyWebhookSignature({
        payload: RAW,
        header,
        secret: SECRET,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(true);
  });

  it("rejects a tampered payload, a wrong secret and a missing header", () => {
    const header = signWebhookPayload(RAW, SECRET, NOW_SECONDS);
    expect(
      verifyWebhookSignature({
        payload: RAW.replace("evt_123", "evt_999"),
        header,
        secret: SECRET,
        nowSeconds: NOW_SECONDS,
      }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ payload: RAW, header, secret: "wrong", nowSeconds: NOW_SECONDS }),
    ).toBe(false);
    expect(
      verifyWebhookSignature({ payload: RAW, header: "", secret: SECRET, nowSeconds: NOW_SECONDS }),
    ).toBe(false);
  });

  it("rejects a replay outside the tolerance window", () => {
    const header = signWebhookPayload(RAW, SECRET, NOW_SECONDS);
    const tooLate = NOW_SECONDS + WEBHOOK_TOLERANCE_SECONDS + 1;
    expect(
      verifyWebhookSignature({
        payload: RAW,
        header,
        secret: SECRET,
        nowSeconds: tooLate,
      }),
    ).toBe(false);
  });

  it("parses only events with an id and a type", () => {
    expect(parseWebhookEvent(RAW)).toEqual({ id: "evt_123", type: "payment_intent.succeeded" });
    expect(() => parseWebhookEvent("not json")).toThrow();
    expect(() => parseWebhookEvent(JSON.stringify({ id: "x" }))).toThrow();
  });
});

describe("webhook route", () => {
  it("stores a verified event once and reports the replay as a duplicate", async () => {
    const app = newApp({ webhookSecret: SECRET });
    const header = signWebhookPayload(RAW, SECRET, NOW_SECONDS);

    const first = await app.json<{ received: boolean; duplicate: boolean; eventId: string }>(
      "/api/payments/webhook",
      { method: "POST", body: EVENT, headers: { "stripe-signature": header } },
    );
    expect(first.response.status).toBe(200);
    expect(first.body).toEqual({ received: true, duplicate: false, eventId: "evt_123" });

    const replay = await app.json<{ duplicate: boolean }>("/api/payments/webhook", {
      method: "POST",
      body: EVENT,
      headers: { "stripe-signature": header },
    });
    expect(replay.response.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  it("rejects an unsigned or tampered webhook before storing anything", async () => {
    const app = newApp({ webhookSecret: SECRET });
    const header = signWebhookPayload(RAW, SECRET, NOW_SECONDS);

    const unsigned = await app.request("/api/payments/webhook", {
      method: "POST",
      body: EVENT,
    });
    expect(unsigned.status).toBe(400);

    const tampered = await app.request("/api/payments/webhook", {
      method: "POST",
      body: { ...EVENT, type: "payment_intent.canceled" },
      headers: { "stripe-signature": header },
    });
    expect(tampered.status).toBe(400);
  });

  it("is disabled until a signing secret is configured", async () => {
    const app = newApp();
    const response = await app.request("/api/payments/webhook", { method: "POST", body: EVENT });
    expect(response.status).toBe(503);
  });

  it("does not accept GET", async () => {
    const app = newApp({ webhookSecret: SECRET });
    const response = await app.request("/api/payments/webhook");
    expect(response.status).toBe(405);
  });
});
