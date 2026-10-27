import type { AppContext } from "../server/context.ts";
import type { AccountRow } from "../server/types.ts";
import { field, selectField } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { flashFrom, layout, pageUrl } from "./layout.ts";

export function renderJoin(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const requestedRole = url.searchParams.get("role");
  const role = requestedRole === "business" ? "business" : "coder";
  const flash = flashFrom(url);

  const content = `<section class="stack narrow">
    <p class="eyebrow">Join the marketplace</p>
    <h1>${account === null ? "Two ways in" : "You are already signed in"}</h1>
    ${
      account === null
        ? `<p class="lead">One email, one role, no password. We send a six-digit code that is valid for 15 minutes.</p>
          <form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/auth/request-code"))}">
            <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/login"))}">
            ${field({ name: "email", label: "Email", type: "email", required: true, autocomplete: "email", placeholder: "you@example.com" })}
            ${selectField({
              name: "role",
              label: "I am a",
              value: role,
              choices: [
                { value: "coder", label: "Coder — I want paid work" },
                { value: "business", label: "Business — I want to hire" },
              ],
            })}
            <button class="button" type="submit">Email me a login code</button>
          </form>
          <p class="meta">Already have an account? <a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/login"))}">Log in</a>.</p>`
        : `<p class="lead">Signed in as ${escapeHtml(account.email)} (${escapeHtml(account.role)}).</p>
          <p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Open your dashboard</a></p>`
    }
    <section class="card">
      <h2>What happens next</h2>
      <ul class="checklist">
        <li><strong>Coders:</strong> create a profile with skills, availability and a rate range. New profiles are reviewed before they appear in the directory or in matches.</li>
        <li><strong>Businesses:</strong> add a company profile, post a job, and compare ranked coders with the reasons behind each score.</li>
        <li><strong>Everyone:</strong> an engagement is funded into escrow before work starts. Approval releases the payout.</li>
      </ul>
    </section>
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/join",
    title: "Join",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
