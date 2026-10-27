/**
 * The marketplace is a separate service the app links out to. Self-hosters run
 * it under their own domain, so the URL comes from the build environment
 * (`VITE_CODEITLAB_MARKETPLACE_URL`) and falls back to the public one. Only
 * http(s) URLs are accepted: this value ends up in an anchor href, and a
 * `javascript:` URL from a stray env var would be a script injection.
 */
export const DEFAULT_MARKETPLACE_URL = "https://codeitlab.com/market";

export function resolveMarketplaceUrl(raw: string | undefined): string {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return DEFAULT_MARKETPLACE_URL;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return DEFAULT_MARKETPLACE_URL;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return DEFAULT_MARKETPLACE_URL;
  }
  // The marketplace is mounted at a base path, so keep the path and drop only
  // the query/hash an operator may have pasted by mistake.
  const path = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${path}`;
}
