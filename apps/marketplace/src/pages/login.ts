import type { AppContext } from "../server/context.ts";
import type { AccountRow } from "../server/types.ts";
import { field, selectField } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { toInternalLocation } from "../server/http.ts";
import { flashFrom, layout, pageUrl } from "./layout.ts";

export function renderLogin(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const email = url.searchParams.get("email") ?? "";
  const role = url.searchParams.get("role") === "business" ? "business" : "coder";
  const flash = flashFrom(url);
  // A page that needs an account sends people here with where they were going,
  // so signing in resumes that instead of dumping everyone on the dashboard.
  // toInternalLocation is the same same-origin guard the form posts go through,
  // which keeps an attacker-supplied redirect from leaving the site.
  const from = toInternalLocation(
    ctx.basePath,
    url.href,
    url.searchParams.get("redirectTo"),
    "/dashboard",
  );

  const content = `<section class="stack narrow">
    <p class="eyebrow">Passwordless login</p>
    <h1>Log in</h1>
    ${
      account === null
        ? `<p class="lead">Enter your email and we will send a six-digit code. It expires after 15 minutes and works five times at most.</p>
          <form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/auth/request-code"))}">
            <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/login"))}">
            ${field({ name: "email", label: "Email", type: "email", required: true, value: email, autocomplete: "email" })}
            ${selectField({
              name: "role",
              label: "Role",
              value: role,
              choices: [
                { value: "coder", label: "Coder" },
                { value: "business", label: "Business" },
              ],
              hint: "Use the role you signed up with.",
            })}
            <button class="button" type="submit">Send code</button>
          </form>
          <form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/auth/verify"))}">
            <input type="hidden" name="redirectTo" value="${escapeHtml(from)}">
            ${field({ name: "email", label: "Email", type: "email", required: true, value: email, autocomplete: "email" })}
            ${field({ name: "code", label: "Six-digit code", required: true, placeholder: "123456", autocomplete: "one-time-code" })}
            <button class="button" type="submit">Log in</button>
          </form>
          <p class="meta">New here? <a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/join"))}">Join the marketplace</a>.</p>`
        : `<p class="lead">Signed in as ${escapeHtml(account.email)} (${escapeHtml(account.role)}).</p>
          <p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Open your dashboard</a></p>
          <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/auth/logout"))}">
            <button class="button button-secondary" type="submit">Sign out</button>
          </form>`
    }
    <p class="hint">In local development the code is printed to the server console (MARKETPLACE_DEV_EMAIL=1). It is never returned by the API.</p>
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/login",
    title: "Log in",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
