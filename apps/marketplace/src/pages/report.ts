import type { AppContext } from "../server/context.ts";
import { getJobRow } from "../server/jobs.ts";
import { findCoderRowById } from "../server/profiles.ts";
import { REPORT_REASONS } from "../server/reports.ts";
import type { AccountRow } from "../server/types.ts";
import { escapeHtml } from "./escape.ts";
import { flashFrom, layout, pageUrl } from "./layout.ts";

/**
 * The report form is deliberately plain: one reason, one optional paragraph, and
 * a promise about what happens next. It never says "we will ban them" — it says
 * an operator reads it, the reported party is not told who reported, and the
 * reporter hears back.
 */
export function renderReport(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const flash = flashFrom(url);
  const kind = url.searchParams.get("kind") ?? "";
  const id = url.searchParams.get("id") ?? "";
  const target =
    kind === "job"
      ? (() => {
          const job = getJobRow(ctx, id);
          return job === undefined
            ? null
            : { label: job.title, href: `/jobs/${job.id}`, owner: job.businessId };
        })()
      : kind === "coder"
        ? (() => {
            const coder = findCoderRowById(ctx, id);
            return coder === undefined || !coder.approved
              ? null
              : { label: coder.displayName, href: `/coders/${coder.id}`, owner: coder.accountId };
          })()
        : null;

  const header = `<section class="stack narrow">
    <p class="eyebrow"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/"))}">Home</a> / report</p>
    <h1>Report a problem</h1>`;

  if (account === null) {
    const content = `${header}
      <p class="lead">Reports are reviewed by a person. Log in so we can tell you what happened with it.</p>
      <p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, `/login?redirectTo=${encodeURIComponent(`/report?kind=${kind}&id=${id}`)}`))}">Log in</a></p>
    </section>`;
    return layout({
      basePath: ctx.basePath,
      baseUrl: ctx.baseUrl,
      canonicalPath: "/report",
      title: "Report a problem",
      account,
      content,
      notice: flash.notice,
      error: flash.error,
    });
  }

  if (target === null) {
    const content = `${header}
      <p class="lead">This job or profile is not available, so there is nothing to report.</p>
      <p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Browse jobs</a></p>
    </section>`;
    return layout({
      basePath: ctx.basePath,
      baseUrl: ctx.baseUrl,
      canonicalPath: "/report",
      title: "Report a problem",
      account,
      content,
      notice: flash.notice,
      error: flash.error,
    });
  }

  if (target.owner === account.id) {
    const content = `${header}
      <p class="lead">This is your own post, so there is nothing to report. If you want to change it, edit it from your dashboard.</p>
      <p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Go to dashboard</a></p>
    </section>`;
    return layout({
      basePath: ctx.basePath,
      baseUrl: ctx.baseUrl,
      canonicalPath: "/report",
      title: "Report a problem",
      account,
      content,
      notice: flash.notice,
      error: flash.error,
    });
  }

  const options = Object.entries(REPORT_REASONS)
    .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
    .join("");

  const content = `${header}
    <p class="lead">You are reporting: <strong>${escapeHtml(target.label)}</strong> (${escapeHtml(kind === "job" ? "job" : "coder profile")}).</p>
    <form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/reports"))}">
      <input type="hidden" name="targetKind" value="${escapeHtml(kind)}">
      <input type="hidden" name="targetId" value="${escapeHtml(id)}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(target.href)}">
      <div class="field">
        <label for="report-reason">What is wrong?</label>
        <select id="report-reason" name="reason" required>${options}</select>
      </div>
      <div class="field">
        <label for="report-detail">Anything an operator should know (optional)</label>
        <textarea id="report-detail" name="detail" rows="5" maxlength="1000" placeholder="Links, dates, what happened."></textarea>
        <span class="hint">Keep it factual. Up to 1,000 characters.</span>
      </div>
      <button class="button" type="submit">Send report</button>
    </form>
    <section class="card">
      <h2>What happens next</h2>
      <ul class="plain-list">
        <li>A person reads it, not a model. Reports go to the operator queue with your email on them.</li>
        <li>The job or coder you reported is <strong>not told who reported them</strong> — retaliation is not a feature.</li>
        <li>If the report holds up, the job is removed or the profile is taken down for review. Either way, you get a notification when it is resolved.</li>
        <li>False reports are themselves a reason to lose your account, so report what you can point at.</li>
      </ul>
    </section>
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/report",
    title: "Report a problem",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
