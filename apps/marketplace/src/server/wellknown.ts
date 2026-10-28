import type { AppContext } from "./context.ts";
import { pageUrl } from "../pages/layout.ts";

export const DEFAULT_SECURITY_CONTACT = "security@codeitlab.com";

/**
 * robots.txt keeps crawlers out of the parts that only make sense for a signed-in
 * person: admin pages, the JSON API, dashboards. Everything a stranger should
 * read (job board, coder directory, how it works) stays crawlable — the point of
 * the marketplace is that work and people can be found.
 */
export function renderRobotsTxt(basePath: string, baseUrl: string): string {
  const sitemap = new URL(pageUrl(basePath, "/sitemap.xml"), baseUrl).href;
  return [
    "User-agent: *",
    "Allow: /",
    `Disallow: ${pageUrl(basePath, "/admin")}`,
    `Disallow: ${pageUrl(basePath, "/api/")}`,
    `Disallow: ${pageUrl(basePath, "/dashboard")}`,
    `Disallow: ${pageUrl(basePath, "/login")}`,
    "",
    `Sitemap: ${sitemap}`,
    "",
  ].join("\n");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

/**
 * Only public, indexable pages: the home, the job board, the directory, the
 * explanation pages, and the individual open jobs and approved coder profiles.
 * Signed-in pages, the admin and the API are absent by construction — the list is
 * built from the same queries the public pages use, never from a crawl.
 */
export function renderSitemap(hrefs: readonly string[], baseUrl: string): string {
  const urls = hrefs
    .map((href) => `<url><loc>${escapeXml(new URL(href, baseUrl).href)}</loc></url>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>
`;
}

/**
 * RFC 9116 security.txt: a stranger who finds a vulnerability should not have to
 * guess where to send it. The expiry is one year out so a stale file is obvious;
 * `Canonical` is absolute, because the file is meant to be discovered from the
 * origin, not from a link.
 */
export function renderSecurityTxt(
  ctx: Pick<AppContext, "basePath" | "baseUrl" | "now">,
  options: { readonly contact?: string } = {},
): string {
  const contact = (
    options.contact ??
    process.env.MARKETPLACE_SECURITY_CONTACT ??
    DEFAULT_SECURITY_CONTACT
  )
    .trim()
    .replace(/^mailto:/u, "");
  const expires = new Date(ctx.now().getTime() + 365 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  return [
    `Contact: mailto:${contact}`,
    `Expires: ${expires}`,
    "Preferred-Languages: en, el",
    // baseUrl already contains the base path (e.g. https://codeitlab.com/market).
    `Canonical: ${ctx.baseUrl}/.well-known/security.txt`,
    "",
  ].join("\n");
}

export function renderSecurityPolicy(ctx: Pick<AppContext, "basePath">): string {
  const url = (path: string): string => pageUrl(ctx.basePath, path);
  return `<section class="stack narrow">
    <p class="eyebrow">Security</p>
    <h1>Security policy</h1>
    <h2>Reporting a vulnerability</h2>
    <p>Email <a class="link" href="mailto:${DEFAULT_SECURITY_CONTACT}">${DEFAULT_SECURITY_CONTACT}</a>
    with what you found, how to reproduce it, and what you think the impact is. Do not open a
    public issue and do not test against another person's account or engagement. We will confirm
    receipt, keep you informed, and credit you if you want.</p>
    <h2>In scope</h2>
    <ul>
      <li>the marketplace at <a class="link" href="${url("/")}">${url("/")}</a>, its API and the admin pages</li>
      <li>authentication (login codes), sessions, and CSRF/origin checks</li>
      <li>escrow, payouts, refunds, and the ledger</li>
      <li>the PWA shell and service worker</li>
    </ul>
    <h2>Out of scope</h2>
    <ul>
      <li>denial of service, spam, or social engineering</li>
      <li>reports from automated scanners without a reproducible finding</li>
      <li>issues in third-party services we link to</li>
    </ul>
    <h2>What we do</h2>
    <p>Money-path code is reviewed and tested; every state change is written to an
    append-only ledger, and admin actions are audited. We would rather hear about a problem
    early than read about it later.</p>
  </section>`;
}
