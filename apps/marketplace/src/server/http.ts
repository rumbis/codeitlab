import { HttpError, badRequest } from "./errors.ts";

export const MAX_BODY_BYTES = 64 * 1024;

export interface ParsedBody {
  readonly data: Record<string, unknown>;
  readonly isForm: boolean;
}

export async function readBody(request: Request): Promise<ParsedBody> {
  const method = request.method.toUpperCase();
  const contentType = request.headers.get("content-type") ?? "";
  const isForm = contentType.includes("application/x-www-form-urlencoded");

  if (method === "GET" || method === "HEAD") return { data: {}, isForm };

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, "payload_too_large", "Request body is too large.");
  }
  if (text.trim() === "") return { data: {}, isForm };

  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw badRequest("Invalid JSON body.", "invalid_json");
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw badRequest("JSON body must be an object.", "invalid_json");
    }
    return { data: parsed as Record<string, unknown>, isForm: false };
  }

  if (isForm) {
    const params = new URLSearchParams(text);
    const data: Record<string, unknown> = {};
    for (const [key, value] of params) {
      const existing = data[key];
      if (existing === undefined) {
        data[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        data[key] = [existing, value];
      }
    }
    return { data, isForm: true };
  }

  throw new HttpError(415, "unsupported_media_type", "Send JSON or form-encoded data.");
}

export function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function htmlResponse(
  markup: string,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(markup, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
      ...headers,
    },
  });
}

export function redirectResponse(location: string, headers: Record<string, string> = {}): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store", ...headers },
  });
}

export function parseCookies(header: string | null): Record<string, string> {
  if (header === null || header === "") return {};
  const cookies: Record<string, string> = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name === "") continue;
    cookies[name] = part.slice(separator + 1).trim();
  }
  return cookies;
}

export function normalizeBasePath(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  if (value === "" || value === "/") return "";
  if (!value.startsWith("/")) return `/${value.replace(/\/+$/u, "")}`;
  return value.replace(/\/+$/u, "");
}

/** Prefix an app-internal path ("/jobs") with the mount path. */
export function withBasePath(basePath: string, path: string): string {
  if (basePath === "") return path;
  if (path === basePath || path.startsWith(`${basePath}/`)) return path;
  return path === "/" ? `${basePath}/` : `${basePath}${path}`;
}

/**
 * Reverse proxies may forward `/market/jobs` either stripped or intact; accept
 * both by stripping the mount path when it is present.
 */
export function stripBasePath(pathname: string, basePath: string): string {
  if (basePath === "") return pathname;
  if (pathname === basePath) return "/";
  if (pathname.startsWith(`${basePath}/`)) {
    const rest = pathname.slice(basePath.length);
    return rest === "" ? "/" : rest;
  }
  return pathname;
}

export function cookiePath(basePath: string): string {
  return basePath === "" ? "/" : basePath;
}

/**
 * Resolve a form's `redirectTo` (or the Referer) to an internal, mounted
 * location. Anything absolute or cross-origin falls back to the route default.
 */
export function toInternalLocation(
  basePath: string,
  requestUrl: string,
  candidate: string | null,
  fallback: string,
): string {
  const defaultLocation = withBasePath(basePath, fallback);
  if (candidate === null || candidate.trim() === "") return defaultLocation;

  let parsed: URL;
  try {
    parsed = new URL(candidate, requestUrl);
  } catch {
    return defaultLocation;
  }
  if (parsed.origin !== new URL(requestUrl).origin) return defaultLocation;
  if (parsed.pathname.startsWith("//")) return defaultLocation;

  const path = stripBasePath(parsed.pathname, basePath);
  return `${withBasePath(basePath, path)}${parsed.search}`;
}

export function withNotice(location: string, notice: string | undefined): string {
  if (notice === undefined || notice === "") return location;
  const url = new URL(location, "http://marketplace.invalid");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected error.";
}
