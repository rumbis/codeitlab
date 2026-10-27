import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type TestApp,
} from "./helpers.ts";

interface RecordedRequest {
  headers: NodeHttp.IncomingHttpHeaders;
  body: string;
}

interface FakeReceiver {
  url: string;
  requests: RecordedRequest[];
  setStatus(status: number): void;
  close(): Promise<void>;
}

async function startReceiver(): Promise<FakeReceiver> {
  let status = 200;
  const requests: RecordedRequest[] = [];
  const server = NodeHttp.createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      requests.push({ headers: incoming.headers, body: Buffer.concat(chunks).toString("utf8") });
      outgoing.statusCode = status;
      outgoing.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("receiver did not bind");
  return {
    url: `http://127.0.0.1:${address.port}/hook`,
    requests,
    setStatus: (next) => {
      status = next;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

interface OutboxPayload {
  pending: number;
  delivered: number;
  failed: number;
  recent: { attempts: number; lastError: string; payload: string }[];
}

let apps: TestApp[] = [];
let receivers: FakeReceiver[] = [];

afterEach(async () => {
  for (const app of apps) app.close();
  apps = [];
  for (const receiver of receivers) await receiver.close();
  receivers = [];
});

async function newAppWithReceiver() {
  const receiver = await startReceiver();
  receivers.push(receiver);
  const app = createTestApp({
    autoApprove: true,
    notifyWebhook: receiver.url,
    notifySecret: "whsec_outbox_test",
  });
  apps.push(app);
  return { app, receiver };
}

/** Produce exactly one notification: a coder applies to a business's job. */
async function produceApplication(app: TestApp): Promise<void> {
  const business = await app.signIn("owner@outbox.test", "business");
  const coder = await app.signIn("coder@outbox.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Ada",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, { skills: "TypeScript" });
  const applied = await app.request(`/api/jobs/${job.id}/interests`, {
    method: "POST",
    cookie: coder.cookie,
    body: { message: "I can ship this." },
  });
  expect(applied.status).toBe(201);
}

async function status(app: TestApp): Promise<OutboxPayload> {
  const response = await app.json<OutboxPayload>("/api/admin/outbox", { headers: ADMIN });
  expect(response.response.status).toBe(200);
  return response.body;
}

async function drain(app: TestApp) {
  return app.json<{ delivered: number; failed: number; pending: number }>(
    "/api/admin/outbox/drain",
    { method: "POST", headers: ADMIN },
  );
}

describe("notification outbox", () => {
  it("queues a signed push and delivers it once", async () => {
    const { app, receiver } = await newAppWithReceiver();
    await produceApplication(app);

    expect((await status(app)).pending).toBe(1);
    expect((await drain(app)).body).toEqual({ delivered: 1, failed: 0, pending: 0 });

    expect(receiver.requests).toHaveLength(1);
    const request = receiver.requests[0];
    if (request === undefined) throw new Error("no request received");
    expect(request.headers["x-codeitlab-event"]).toBe("notification.application");
    const body = JSON.parse(request.body) as { message: string; engagementId: string };
    expect(body.message).toContain("applied");

    // The receiver can verify the payload the same way payment webhooks are.
    const header = String(request.headers["x-codeitlab-signature"] ?? "");
    const timestamp = Number(header.split(",")[0]?.split("=")[1]);
    const expected = NodeCrypto.createHmac("sha256", "whsec_outbox_test")
      .update(`${timestamp}.${request.body}`)
      .digest("hex");
    expect(header).toBe(`t=${timestamp},v1=${expected}`);

    // Nothing due means nothing is sent twice.
    expect((await drain(app)).body).toEqual({ delivered: 0, failed: 0, pending: 0 });
    expect(receiver.requests).toHaveLength(1);
  });

  it("keeps a failed push pending and retries with backoff", async () => {
    const { app, receiver } = await newAppWithReceiver();
    await produceApplication(app);
    receiver.setStatus(500);

    expect((await drain(app)).body).toEqual({ delivered: 0, failed: 1, pending: 1 });
    const failed = await status(app);
    expect(failed.failed).toBe(1);
    expect(failed.recent[0]?.attempts).toBe(1);
    expect(failed.recent[0]?.lastError).toBe("HTTP 500");

    // Immediately due again would hammer the receiver; backoff keeps it out.
    expect((await drain(app)).body).toEqual({ delivered: 0, failed: 0, pending: 1 });

    receiver.setStatus(200);
    app.advance(120_000);
    expect((await drain(app)).body).toEqual({ delivered: 1, failed: 0, pending: 0 });
    expect(receiver.requests).toHaveLength(2);
  });

  it("stays empty when no webhook is configured", async () => {
    const app = createTestApp({ autoApprove: true });
    apps.push(app);
    await produceApplication(app);
    expect((await status(app)).pending).toBe(0);
  });

  it("requires the admin token", async () => {
    const { app } = await newAppWithReceiver();
    expect((await app.request("/api/admin/outbox")).status).toBe(401);
    expect((await app.request("/api/admin/outbox/drain", { method: "POST" })).status).toBe(401);
  });
});
