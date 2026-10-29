import { withBasePath } from "../server/http.ts";
import type { AccountRow } from "../server/types.ts";
import { escapeHtml } from "./escape.ts";

export interface LayoutOptions {
  readonly basePath: string;
  readonly baseUrl?: string;
  readonly title: string;
  readonly description?: string;
  readonly account: AccountRow | null;
  readonly content: string;
  readonly notice?: string;
  readonly error?: string;
  readonly canonicalPath?: string;
}

// Where "Get the app" sends people. The marketplace has no build of its own to
// hand out, so this is the public download page, overridable for a local run.
// Exported because every page that finishes a task here should hand the user
// the app next: the work continues there, not in the browser.
export const appDownloadUrl = process.env.MARKETPLACE_APP_URL ?? "https://codeitlab.com/download";

/** The only way pages build an app-internal URL. */
export function pageUrl(basePath: string, path: string): string {
  return withBasePath(basePath, path);
}

function navLink(basePath: string, path: string, label: string, currentPath: string): string {
  const active = currentPath === path || (path !== "/" && currentPath.startsWith(`${path}/`));
  const classes = active ? "nav-link nav-link-active" : "nav-link";
  const aria = active ? ' aria-current="page"' : "";
  return `<a class="${classes}" href="${escapeHtml(pageUrl(basePath, path))}"${aria}>${escapeHtml(label)}</a>`;
}

export function layout(options: LayoutOptions & { readonly currentPath?: string }): string {
  const { basePath, title, account, content } = options;
  const currentPath = options.currentPath ?? "/";
  const description =
    options.description ??
    "CodeItLab Marketplace: hire vetted vibe coders, or get paid for work you already know how to do.";
  const canonical =
    options.baseUrl !== undefined && options.canonicalPath !== undefined
      ? `<link rel="canonical" href="${escapeHtml(`${options.baseUrl}${options.canonicalPath}`)}">`
      : "";

  // The app is the unit of movement: it is the only primary call to action, and
  // every marketplace page sends an anonymous visitor there before asking them
  // to join. Signed-in links stay hidden until there is an account to show.
  const accountNav =
    account === null
      ? `<a class="nav-cta" href="${escapeHtml(appDownloadUrl)}">Get the app</a>
         ${navLink(basePath, "/login", "Log in", currentPath)}`
      : `${navLink(basePath, "/dashboard", "Dashboard", currentPath)}
         <span class="nav-account">${escapeHtml(account.email)}</span>
         <form class="inline-form" method="post" action="${escapeHtml(pageUrl(basePath, "/api/auth/logout"))}">
           <button class="nav-link" type="submit">Sign out</button>
         </form>`;

  const flash =
    (options.error !== undefined && options.error !== ""
      ? `<p class="flash flash-error" role="alert">${escapeHtml(options.error)}</p>`
      : "") +
    (options.notice !== undefined && options.notice !== ""
      ? `<p class="flash flash-notice" role="status">${escapeHtml(options.notice)}</p>`
      : "");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · CodeItLab Marketplace</title>
  <meta name="description" content="${escapeHtml(description)}">
  ${canonical}
  <link rel="stylesheet" href="${escapeHtml(pageUrl(basePath, "/styles.css"))}">
  <link rel="manifest" href="${escapeHtml(pageUrl(basePath, "/manifest.webmanifest"))}">
  <link rel="icon" href="${escapeHtml(pageUrl(basePath, "/icon.svg"))}" type="image/svg+xml">
  <meta name="theme-color" content="#0b0d12">
  <script src="${escapeHtml(pageUrl(basePath, "/app.js"))}" defer></script>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="container header-inner">
      <a class="brand" href="${escapeHtml(pageUrl(basePath, "/"))}">
        <span class="brand-mark" aria-hidden="true">C</span>
        <span>CodeItLab <span class="brand-sub">Marketplace</span></span>
      </a>
      <nav class="site-nav" aria-label="Main">
        ${navLink(basePath, "/coders", "Coders", currentPath)}
        ${navLink(basePath, "/jobs", "Jobs", currentPath)}
        ${navLink(basePath, "/how-it-works", "How it works", currentPath)}
        ${accountNav}
      </nav>
    </div>
  </header>
  <main id="main" class="container main">
    ${flash}
    ${content}
  </main>
  <footer class="site-footer">
    <div class="container">
      <p>CodeItLab Marketplace · Money is held in escrow until the work is approved.</p>
      <p class="muted">Built with Node's built-in HTTP server and SQLite. No tracking, no client-side framework.</p>
      <p class="muted"><a href="${escapeHtml(pageUrl(basePath, "/numbers"))}">Public numbers</a> · <a href="https://app.codeitlab.com">Get the CodeItLab app</a> · <a href="https://codeitlab.com">codeitlab.com</a></p>
    </div>
  </footer>
</body>
</html>`;
}

export function flashFrom(url: URL): { notice?: string; error?: string } {
  const notice = url.searchParams.get("notice");
  const error = url.searchParams.get("error");
  return {
    notice: notice === null || notice === "" ? undefined : notice,
    error: error === null || error === "" ? undefined : error,
  };
}

export function errorPage(options: {
  readonly basePath: string;
  readonly account: AccountRow | null;
  readonly status: number;
  readonly title: string;
  readonly message: string;
}): string {
  return layout({
    basePath: options.basePath,
    title: options.title,
    account: options.account,
    content: `<section class="stack">
      <p class="eyebrow">Error ${escapeHtml(options.status)}</p>
      <h1>${escapeHtml(options.title)}</h1>
      <p class="lead">${escapeHtml(options.message)}</p>
      <p><a class="button button-secondary" href="${escapeHtml(pageUrl(options.basePath, "/"))}">Back to the marketplace</a></p>
    </section>`,
  });
}
