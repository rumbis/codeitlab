import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { forbidden } from "./errors.ts";
import { parseCookies } from "./http.ts";

/**
 * The marketplace moves money and renders user-written text, so every response
 * carries the same defensive headers:
 *
 * - `default-src 'self'` — the pages load one stylesheet and no third-party
 *   script; anything injected has nowhere to send data.
 * - `frame-ancestors 'none'` / `x-frame-options: DENY` — approving a delivery
 *   must never be clickable inside someone else's frame.
 * - `form-action 'self'` — a form can only post back here.
 * - HSTS only when the service is actually served over HTTPS.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function securityHeaders(ctx: AppContext): Record<string, string> {
  const headers: Record<string, string> = {
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin",
  };
  if (ctx.cookieSecure) {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

function expectedOrigin(ctx: AppContext): string {
  return new URL(ctx.baseUrl).origin;
}

/**
 * The local website runs on its own origin, so a browser fetch from it is
 * cross-origin and needs an explicit allowlist — the public marketplace is
 * same-origin behind the site proxy and never needs one. With no list
 * configured this sends nothing, so a deployed marketplace behaves exactly as
 * before. The list is checked rather than reflected blindly because the
 * responses carry session cookies.
 */
export function corsHeaders(ctx: AppContext, request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (origin === null || origin === "" || !ctx.trustedOrigins.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    vary: "origin",
  };
}

/**
 * CSRF defence for state-changing requests. A browser always sends `Origin` on
 * a cross-site form post; if it disagrees with our public origin the request is
 * rejected before it reaches a handler. `Referer` covers the older browsers
 * that omit `Origin`, and requests with neither header are non-browser clients
 * (the JSON API), which cannot ride a victim's cookie anyway.
 */
export function assertSameOrigin(ctx: AppContext, request: Request): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const expected = expectedOrigin(ctx);
  const origin = request.headers.get("origin");
  // A trusted cross-origin caller (the local website) posts with its own Origin,
  // which the allowlist accepted above; only the allowlist may widen this check.
  if (origin !== null && origin !== "" && ctx.trustedOrigins.includes(origin)) return;

  if (origin !== null && origin !== "") {
    if (origin !== expected) {
      throw forbidden("Cross-origin request rejected.", "cross_origin");
    }
    return;
  }

  const referer = request.headers.get("referer");
  if (referer === null || referer === "") return;
  let refererOrigin: string;
  try {
    refererOrigin = new URL(referer).origin;
  } catch {
    throw forbidden("Cross-origin request rejected.", "cross_origin");
  }
  if (refererOrigin !== expected) {
    throw forbidden("Cross-origin request rejected.", "cross_origin");
  }
}

/**
 * The server-rendered admin page is a no-JS surface, so the token used to open
 * it would otherwise have to be repeated in every form action. Instead the page
 * trades the token for a short-lived signed cookie: the secret stays in the
 * address bar once, never in the HTML, and the cookie is HttpOnly so a script
 * cannot read it and SameSite=Strict so no other site can drive the panel.
 */
export const ADMIN_COOKIE = "codeitlab_admin";
const ADMIN_COOKIE_TTL_SECONDS = 8 * 60 * 60;

function adminCookieValue(ctx: AppContext): string {
  return NodeCrypto.createHmac("sha256", ctx.adminToken)
    .update("codeitlab-admin-cookie-v1")
    .digest("hex");
}

export function isAdminCookieValid(ctx: AppContext, value: string): boolean {
  if (ctx.adminToken === "" || value === "") return false;
  const expected = Buffer.from(adminCookieValue(ctx));
  const provided = Buffer.from(value);
  return provided.length === expected.length && NodeCrypto.timingSafeEqual(provided, expected);
}

export function adminCookieHeader(ctx: AppContext): string {
  const path = ctx.basePath === "" ? "/" : `${ctx.basePath}/`;
  return [
    `${ADMIN_COOKIE}=${adminCookieValue(ctx)}`,
    `Path=${path}`,
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${String(ADMIN_COOKIE_TTL_SECONDS)}`,
    ...(ctx.cookieSecure ? ["Secure"] : []),
  ].join("; ");
}

/** True when the request carries a valid admin cookie. */
export function hasAdminCookie(ctx: AppContext, request: Request): boolean {
  return isAdminCookieValid(ctx, parseCookies(request.headers.get("cookie"))[ADMIN_COOKIE] ?? "");
}
