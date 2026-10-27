import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  createLogMailTransport,
  createWebhookMailTransport,
  type MailMessage,
  type MailTransport,
} from "../src/server/mail.ts";
import { TEST_ADMIN_TOKEN, createTestApp, type TestApp } from "./helpers.ts";

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

interface RecordedRequest {
  headers: NodeHttp.IncomingHttpHeaders;
  body: string;
}

interface FakeGateway {
  url: string;
  requests: RecordedRequest[];
  setStatus(status: number): void;
  close(): Promise<void>;
}

async function startGateway(): Promise<FakeGateway> {
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
  if (address === null || typeof address === "string") throw new Error("gateway did not bind");
  return {
    url: `http://127.0.0.1:${address.port}/mail`,
    requests,
    setStatus: (next) => {
      status = next;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let apps: TestApp[] = [];
let gateways: FakeGateway[] = [];

afterEach(async () => {
  for (const app of apps) app.close();
  apps = [];
  for (const gateway of gateways) await gateway.close();
  gateways = [];
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp({ devEmail: false, ...overrides });
  apps.push(app);
  return app;
}

async function status(app: TestApp) {
  const response = await app.json<{
    pending: number;
    delivered: number;
    failed: number;
    recent: { attempts: number; lastError: string }[];
  }>("/api/admin/mail", { headers: ADMIN });
  expect(response.response.status).toBe(200);
  return response.body;
}

describe("login mail delivery", () => {
  it("mails a code through the webhook gateway and that code logs in", async () => {
    const gateway = await startGateway();
    gateways.push(gateway);
    const app = newApp({
      mailTransport: createWebhookMailTransport({
        url: gateway.url,
        secret: "whsec_mail_test",
      }),
    });

    const requested = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "ada@mail.test", role: "coder" },
    });
    expect(requested.status).toBe(200);

    expect(gateway.requests).toHaveLength(1);
    const request = gateway.requests[0];
    if (request === undefined) throw new Error("no mail received");
    const payload = JSON.parse(request.body) as { to: string; subject: string; text: string };
    expect(payload.to).toBe("ada@mail.test");
    expect(payload.subject).toContain("login code");

    // The receiver can verify the message like any other webhook.
    const signature = String(request.headers["x-codeitlab-signature"] ?? "");
    const timestamp = Number(signature.split(",")[0]?.split("=")[1]);
    const expected = NodeCrypto.createHmac("sha256", "whsec_mail_test")
      .update(`${timestamp}.${request.body}`)
      .digest("hex");
    expect(signature).toBe(`t=${timestamp},v1=${expected}`);

    const code = /(\d{6})/u.exec(payload.text)?.[1];
    expect(code).toBeDefined();
    const verified = await app.request("/api/auth/verify", {
      method: "POST",
      body: { email: "ada@mail.test", code },
    });
    expect(verified.status).toBe(200);
  });

  it("queues the code when the gateway is down, then drains it", async () => {
    const gateway = await startGateway();
    gateways.push(gateway);
    gateway.setStatus(500);
    const app = newApp({ mailTransport: createWebhookMailTransport({ url: gateway.url }) });

    expect(
      (
        await app.request("/api/auth/request-code", {
          method: "POST",
          body: { email: "queued@mail.test", role: "business" },
        })
      ).status,
    ).toBe(200);

    const queued = await status(app);
    expect(queued.pending).toBe(1);
    expect(queued.failed).toBe(0); // it has not been retried yet

    // Drain hits the gateway once and records the failure with backoff.
    const drained = await app.json<{ delivered: number; failed: number; pending: number }>(
      "/api/admin/mail/drain",
      { method: "POST", headers: ADMIN },
    );
    expect(drained.body).toEqual({ delivered: 0, failed: 1, pending: 1 });
    const failed = await status(app);
    expect(failed.failed).toBe(1);
    expect(failed.recent[0]?.lastError).toContain("HTTP 500");

    gateway.setStatus(200);
    app.advance(120_000);
    const retried = await app.json<{ delivered: number; failed: number; pending: number }>(
      "/api/admin/mail/drain",
      { method: "POST", headers: ADMIN },
    );
    expect(retried.body).toEqual({ delivered: 1, failed: 0, pending: 0 });
    // The first attempt failed inline, the drain failed once, the retry landed.
    expect(gateway.requests).toHaveLength(3);
    // The retried message is the login code, not a placeholder.
    const payload = JSON.parse(gateway.requests[2]?.body ?? "{}") as { text: string };
    expect(payload.text).toMatch(/\d{6}/u);
  });

  it("logs in dev without touching the outbox", async () => {
    const delivered: MailMessage[] = [];
    const capture: MailTransport = {
      name: "capture",
      send(message) {
        delivered.push(message);
        return Promise.resolve();
      },
    };
    const app = newApp({ mailTransport: capture });
    await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "dev@mail.test", role: "coder" },
    });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.text).toMatch(/\d{6}/u);
    expect((await status(app)).pending).toBe(0);
  });

  it("keeps the code out of the HTTP response", async () => {
    const logs: string[] = [];
    const app = newApp({ mailTransport: createLogMailTransport((line) => logs.push(line)) });
    const response = await app.request("/api/auth/request-code", {
      method: "POST",
      body: { email: "silent@mail.test", role: "coder" },
    });
    const text = await response.text();
    expect(text).not.toMatch(/\d{6}/u);
    expect(logs).toHaveLength(1);
  });

  it("requires the admin token for the mail outbox", async () => {
    const app = newApp();
    expect((await app.request("/api/admin/mail")).status).toBe(401);
    expect((await app.request("/api/admin/mail/drain", { method: "POST" })).status).toBe(401);
  });
});
