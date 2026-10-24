import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { createApp } from "./app.ts";
import { normalizeBasePath } from "./http.ts";
import { maintenanceMinutesFromEnv, startMaintenance } from "./maintenance.ts";
import { collectBody, SERVER_TIMEOUTS } from "./transport.ts";

const appDir = NodePath.resolve(NodeURL.fileURLToPath(new URL("../../", import.meta.url)));

const port = Number(process.env.PORT ?? "4174");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT="${process.env.PORT}" is not a valid port.`);
}
const host = process.env.HOST ?? "127.0.0.1";
const dbPath = process.env.MARKETPLACE_DB ?? NodePath.join(appDir, ".data", "marketplace.sqlite");

if (dbPath !== ":memory:") {
  NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(dbPath)), { recursive: true });
}

const app = createApp({ dbPath });

const server = NodeHttp.createServer(
  {
    requestTimeout: SERVER_TIMEOUTS.requestTimeoutMs,
    headersTimeout: SERVER_TIMEOUTS.headersTimeoutMs,
    keepAliveTimeout: SERVER_TIMEOUTS.keepAliveTimeoutMs,
  },
  (request, response) => {
    void handle(request, response);
  },
);

async function handle(
  incoming: NodeHttp.IncomingMessage,
  outgoing: NodeHttp.ServerResponse,
): Promise<void> {
  const method = (incoming.method ?? "GET").toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  try {
    let body: ArrayBuffer | undefined;
    if (hasBody) {
      const collected = await collectBody(incoming);
      if (!collected.ok) {
        // Stop reading and answer before the body is buffered any further.
        outgoing.statusCode = 413;
        outgoing.setHeader("content-type", "application/json; charset=utf-8");
        outgoing.setHeader("cache-control", "no-store");
        outgoing.setHeader("connection", "close");
        outgoing.end(
          JSON.stringify({ error: "payload_too_large", message: "Request body is too large." }),
        );
        incoming.destroy();
        return;
      }
      body = collected.body.length > 0 ? new Uint8Array(collected.body).buffer : undefined;
    }

    const requestHeaders = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) {
        for (const item of value) requestHeaders.append(key, item);
      } else {
        requestHeaders.set(key, value);
      }
    }

    const requestUrl = new URL(
      incoming.url ?? "/",
      `http://${incoming.headers.host ?? `${host}:${port}`}`,
    );
    // Overwrite any client-supplied value: the socket address is the only
    // identity the rate limiter can trust without a declared proxy.
    requestHeaders.set("x-marketplace-peer", incoming.socket.remoteAddress ?? "local");
    const request = new Request(requestUrl, { method, headers: requestHeaders, body });
    const result = await app(request);

    outgoing.statusCode = result.status;
    for (const [key, value] of result.headers) {
      if (key.toLowerCase() === "set-cookie") continue;
      outgoing.setHeader(key, value);
    }
    const cookies = readSetCookies(result.headers);
    if (cookies.length > 0) outgoing.setHeader("set-cookie", cookies);

    const payload = Buffer.from(await result.arrayBuffer());
    if (method === "HEAD" || result.status === 204 || result.status === 304) {
      outgoing.end();
    } else {
      outgoing.setHeader("content-length", String(payload.byteLength));
      outgoing.end(payload);
    }

    // Query strings can carry the admin token, so log only the pathname.
    console.log(`${method} ${requestUrl.pathname} ${result.status}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error(`[marketplace] request failed: ${message}`);
    if (!outgoing.headersSent) {
      outgoing.statusCode = 500;
      outgoing.setHeader("content-type", "application/json; charset=utf-8");
    }
    outgoing.end(JSON.stringify({ error: "internal_error", message: "Something went wrong." }));
  }
}

function readSetCookies(headers: Headers): string[] {
  const withCookies = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withCookies.getSetCookie === "function") return withCookies.getSetCookie();
  const single = headers.get("set-cookie");
  return single === null ? [] : [single];
}

const basePath = normalizeBasePath(process.env.MARKETPLACE_BASE_PATH);

const maintenanceMinutes = maintenanceMinutesFromEnv();
const maintenance =
  maintenanceMinutes > 0
    ? startMaintenance(app, {
        minutes: maintenanceMinutes,
        onError: (error) => {
          console.error(
            `[marketplace] maintenance sweep failed: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        },
      })
    : null;

server.listen(port, host, () => {
  console.log(`[marketplace] listening on http://${host}:${port}${basePath}`);
  console.log(`[marketplace] database ${dbPath}`);
  if (basePath !== "") console.log(`[marketplace] mount path ${basePath}`);
  if (maintenance !== null) {
    console.log(
      `[marketplace] maintenance sweep every ${maintenanceMinutes} minute${maintenanceMinutes === 1 ? "" : "s"}`,
    );
  }
});

server.on("error", (error) => {
  console.error(`[marketplace] server error: ${error.message}`);
  app.close();
  process.exitCode = 1;
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[marketplace] ${signal} received, shutting down`);
  maintenance?.stop();
  server.close(() => {
    app.close();
    process.exit(0);
  });
  setTimeout(() => {
    app.close();
    process.exit(1);
  }, 5_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
