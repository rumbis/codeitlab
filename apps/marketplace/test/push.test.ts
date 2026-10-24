import * as NodeHttp from "node:http";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { encryptWebPush, generatePushKeys, type PushKeys } from "../src/server/push.ts";
import type { Engagement } from "../src/shared/contracts.ts";
import {
  TEST_ADMIN_TOKEN,
  approveCoder,
  createCoderProfile,
  createJob,
  createTestApp,
  type SignedIn,
  type TestApp,
} from "./helpers.ts";

const ADMIN = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };

interface FakePushService {
  url: string;
  requests: { headers: Record<string, string | string[] | undefined>; body: Buffer }[];
  status: number;
  close(): Promise<void>;
}

async function startFakePushService(): Promise<FakePushService> {
  const service: FakePushService = {
    url: "",
    requests: [],
    status: 201,
    close: async () => {},
  };
  const server: NodeHttp.Server = NodeHttp.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      service.requests.push({ headers: request.headers, body: Buffer.concat(chunks) });
      response.statusCode = service.status;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no fake push address");
  service.url = `http://127.0.0.1:${address.port}/push`;
  service.close = () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  return service;
}

interface UserAgentKeys {
  publicKey: string;
  privateKey: CryptoKey;
  auth: string;
  p256dh: string;
}

async function userAgentKeys(): Promise<UserAgentKeys> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    publicKey: Buffer.from(publicRaw).toString("base64url"),
    privateKey: pair.privateKey,
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url"),
    p256dh: Buffer.from(publicRaw).toString("base64url"),
  };
}

function src(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  bits: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", src(ikm), "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: src(salt), info: src(info) },
      key,
      bits,
    ),
  );
}

/** Receiver side of RFC 8291, written from the spec to check the server. */
async function decryptPush(
  body: Uint8Array,
  keys: UserAgentKeys,
): Promise<{ payload: string; salt: string }> {
  const salt = body.slice(0, 16);
  const idLength = body[20] ?? 0;
  const serverPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const serverKey = await crypto.subtle.importKey(
    "raw",
    src(serverPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: serverKey }, keys.privateKey, 256),
  );
  const uaPublic = new Uint8Array(Buffer.from(keys.p256dh, "base64url"));
  const authSecret = new Uint8Array(Buffer.from(keys.auth, "base64url"));
  const authInfo = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info"),
    0,
    ...uaPublic,
    ...serverPublic,
  ]);
  const ikm = await hkdf(ecdhSecret, authSecret, authInfo, 256);
  const cek = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 128);
  const nonce = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: nonce\0"), 96);
  const aesKey = await crypto.subtle.importKey("raw", src(cek), "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: src(nonce) }, aesKey, src(ciphertext)),
  );
  const payload = plaintext.slice(0, plaintext.length - 1);
  return {
    payload: new TextDecoder().decode(payload),
    salt: Buffer.from(salt).toString("base64url"),
  };
}

async function verifyVapid(
  authorization: string,
  keys: PushKeys,
  endpoint: string,
  nowSeconds: number,
): Promise<{ aud: string; exp: number; sub: string }> {
  expect(authorization.startsWith("vapid t=")).toBe(true);
  const token = authorization.slice("vapid t=".length).split(", k=")[0] ?? "";
  expect(authorization).toContain(`k=${keys.publicKey}`);
  const [header, claims, signature] = token.split(".");
  expect(header).toBeDefined();
  expect(claims).toBeDefined();
  expect(signature).toBeDefined();
  const publicKey = await crypto.subtle.importKey(
    "raw",
    src(new Uint8Array(Buffer.from(keys.publicKey, "base64url"))),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    src(new Uint8Array(Buffer.from(signature ?? "", "base64url"))),
    src(new TextEncoder().encode(`${header}.${claims}`)),
  );
  expect(valid).toBe(true);
  const parsed = JSON.parse(Buffer.from(claims ?? "", "base64url").toString("utf8")) as {
    aud: string;
    exp: number;
    sub: string;
  };
  expect(parsed.aud).toBe(new URL(endpoint).origin);
  expect(parsed.exp).toBeGreaterThan(nowSeconds);
  return parsed;
}

let apps: TestApp[] = [];
const servers: FakePushService[] = [];

afterEach(async () => {
  for (const app of apps) app.close();
  apps = [];
  for (const server of servers) await server.close();
  servers.length = 0;
});

function newApp(overrides: Parameters<typeof createTestApp>[0] = {}): TestApp {
  const app = createTestApp({ autoApprove: true, ...overrides });
  apps.push(app);
  return app;
}

async function world(app: TestApp) {
  const business: SignedIn = await app.signIn("owner@push.test", "business");
  const coder: SignedIn = await app.signIn("coder@push.test", "coder");
  const profile = await createCoderProfile(app, coder.cookie, {
    displayName: "Push Coder",
    skills: "TypeScript",
    rateMinCents: 5000,
    rateMaxCents: 15_000,
  });
  await approveCoder(app, profile.id);
  const job = await createJob(app, business.cookie, {
    skills: "TypeScript",
    budgetMinCents: 5000,
    budgetMaxCents: 15_000,
  });
  return { business, coder, profile, job };
}

async function subscribe(
  app: TestApp,
  cookie: string,
  endpoint: string,
  keys: UserAgentKeys,
): Promise<Response> {
  return app.request("/api/push/subscribe", {
    method: "POST",
    cookie,
    body: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
  });
}

describe("web push", () => {
  it("reports whether push is configured", async () => {
    const disabled = newApp({ push: null });
    const off = await disabled.json<{ enabled: boolean; publicKey: string }>("/api/push/key");
    expect(off.body).toEqual({ enabled: false, publicKey: "" });

    const keys = await generatePushKeys();
    const enabled = newApp({ push: keys });
    const on = await enabled.json<{ enabled: boolean; publicKey: string }>("/api/push/key");
    expect(on.body.enabled).toBe(true);
    expect(on.body.publicKey).toBe(keys.publicKey);
  });

  it("stores and removes a subscription for the signed-in account only", async () => {
    const keys = await generatePushKeys();
    const app = newApp({ push: keys });
    const { coder, business } = await world(app);
    const service = await startFakePushService();
    servers.push(service);
    const ua = await userAgentKeys();

    expect((await subscribe(app, "", service.url, ua)).status).toBe(401);
    expect(
      (
        await app.request("/api/push/subscribe", {
          method: "POST",
          cookie: coder.cookie,
          body: { endpoint: service.url, keys: { p256dh: "short", auth: ua.auth } },
        })
      ).status,
    ).toBe(400);
    expect((await subscribe(app, coder.cookie, service.url, ua)).status).toBe(201);

    const status = await app.json<{ subscriptions: number; enabled: boolean }>("/api/admin/push", {
      headers: ADMIN,
    });
    expect(status.body.enabled).toBe(true);
    expect(status.body.subscriptions).toBe(1);

    // Another account cannot delete it.
    const other = await app.request("/api/push/unsubscribe", {
      method: "POST",
      cookie: business.cookie,
      body: { endpoint: service.url },
    });
    expect(((await other.json()) as { removed: boolean }).removed).toBe(false);
    expect(
      (await app.json<{ subscriptions: number }>("/api/admin/push", { headers: ADMIN })).body
        .subscriptions,
    ).toBe(1);

    const removed = await app.request("/api/push/unsubscribe", {
      method: "POST",
      cookie: coder.cookie,
      body: { endpoint: service.url },
    });
    expect(((await removed.json()) as { removed: boolean }).removed).toBe(true);
  });

  it("encrypts a payload the receiver can decrypt", async () => {
    const ua = await userAgentKeys();
    const encrypted = await encryptWebPush({
      payload: JSON.stringify({ title: "CodeitLab", body: "A delivery is waiting." }),
      p256dh: ua.p256dh,
      auth: ua.auth,
    });
    const decrypted = await decryptPush(encrypted.body, ua);
    expect(JSON.parse(decrypted.payload)).toEqual({
      title: "CodeitLab",
      body: "A delivery is waiting.",
    });
    // The push service sees ciphertext, not the notification text.
    expect(Buffer.from(encrypted.body).toString("utf8")).not.toContain("delivery is waiting");
  });

  it("delivers queued notifications with a signed VAPID request and removes gone subscriptions", async () => {
    const keys = await generatePushKeys();
    const app = newApp({ push: keys });
    const { business, coder, profile, job } = await world(app);
    const service = await startFakePushService();
    servers.push(service);
    const ua = await userAgentKeys();
    expect((await subscribe(app, coder.cookie, service.url, ua)).status).toBe(201);

    // Hiring the coder creates a notification, which queues a push.
    const created = await app.json<{ engagement: Engagement }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: job.id, coderId: profile.id, amountCents: 10_000 },
    });
    expect(created.response.status).toBe(201);

    const pending = await app.json<{ pending: number }>("/api/admin/push", { headers: ADMIN });
    expect(pending.body.pending).toBe(1);

    const drained = await app.json<{ delivered: number; sent: number; pending: number }>(
      "/api/admin/push/drain",
      { method: "POST", headers: ADMIN },
    );
    expect(drained.body).toMatchObject({ delivered: 1, sent: 1, pending: 0 });
    expect(service.requests).toHaveLength(1);

    const request = service.requests[0];
    expect(request).toBeDefined();
    const headers = request?.headers ?? {};
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers["ttl"]).toBe("86400");
    const authorization = String(headers["authorization"] ?? "");
    const claims = await verifyVapid(
      authorization,
      keys,
      service.url,
      Math.floor(app.now().getTime() / 1000),
    );
    expect(claims.sub).toBe("mailto:security@codeitlab.com");

    const decrypted = await decryptPush(new Uint8Array(request?.body ?? []), ua);
    const payload = JSON.parse(decrypted.payload) as { title: string; body: string; href: string };
    expect(payload.title).toBe("CodeitLab");
    expect(payload.body).toContain("Escrow funded");
    expect(payload.href).toBe(`/dashboard#engagement-${created.body.engagement.id}`);

    // A 410 Gone means the browser dropped the subscription: remove it.
    service.status = 410;
    const second = await createJob(app, business.cookie, { skills: "TypeScript" });
    const hireAgain = await app.json<{ engagement: Engagement }>("/api/engagements", {
      method: "POST",
      cookie: business.cookie,
      body: { jobId: second.id, coderId: profile.id, amountCents: 10_000 },
    });
    expect(hireAgain.response.status).toBe(201);
    const goneDrain = await app.json<{ delivered: number; sent: number }>("/api/admin/push/drain", {
      method: "POST",
      headers: ADMIN,
    });
    expect(goneDrain.body.delivered).toBe(1);
    expect(goneDrain.body.sent).toBe(0);
    const after = await app.json<{ subscriptions: number }>("/api/admin/push", { headers: ADMIN });
    expect(after.body.subscriptions).toBe(0);
  });

  it("ships a service worker push handler and a dashboard opt-in", async () => {
    const keys = await generatePushKeys();
    const app = newApp({ push: keys });
    const { coder } = await world(app);

    const worker = await (await app.request("/sw.js")).text();
    expect(worker).toContain('addEventListener("push"');
    expect(worker).toContain("showNotification");
    expect(worker).toContain('addEventListener("notificationclick"');
    expect(worker).toContain("self.clients.openWindow");

    const script = await (await app.request("/app.js")).text();
    expect(script).toContain("pushManager.subscribe");
    expect(script).toContain('"/api/push/key"');
    expect(script).toContain('"/api/push/subscribe"');
    expect(script).toContain("Notification.requestPermission");

    const dashboard = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(dashboard).toContain('id="enable-push"');
    expect(dashboard).toContain("No marketing, ever.");
  });

  it("explains when push is not configured instead of showing a dead button", async () => {
    const app = newApp({ push: null });
    const { coder } = await world(app);
    const dashboard = await (await app.request("/dashboard", { cookie: coder.cookie })).text();
    expect(dashboard).toContain("Push is not configured on this server.");
    expect(dashboard).not.toContain('id="enable-push"');
  });

  it("requires the admin token for the push queue", async () => {
    const app = newApp();
    expect((await app.request("/api/admin/push")).status).toBe(401);
    expect((await app.request("/api/admin/push/drain", { method: "POST" })).status).toBe(401);
  });
});
