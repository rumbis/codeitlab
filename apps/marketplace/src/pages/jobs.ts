import type { AppContext } from "../server/context.ts";
import { JOB_CATEGORIES, JOB_CATEGORY_LABELS, type JobCategory } from "../shared/contracts.ts";
import { countOpenJobs, listOpenJobs } from "../server/jobs.ts";
import type { AccountRow } from "../server/types.ts";
import { emptyState, jobCard } from "./components.ts";
import { escapeHtml } from "./escape.ts";

const JOBS_PER_PAGE = 20;
import { flashFrom, layout, pageUrl } from "./layout.ts";

function parseMinBudgetCents(url: URL): number {
  const raw = url.searchParams.get("minBudget") ?? "";
  const euros = Number(raw);
  if (!Number.isFinite(euros) || euros < 0) return 0;
  return Math.round(euros * 100);
}

export function renderJobs(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const query = (url.searchParams.get("q") ?? "").trim();
  const rawCategory = url.searchParams.get("category") ?? "";
  const category = (JOB_CATEGORIES as readonly string[]).includes(rawCategory)
    ? (rawCategory as JobCategory)
    : "";
  const minBudgetCents = parseMinBudgetCents(url);
  const total = countOpenJobs(ctx, { query, category, minBudgetCents });
  const pageCount = Math.max(1, Math.ceil(total / JOBS_PER_PAGE));
  const rawPage = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? Math.min(rawPage, pageCount) : 1;
  const jobs = listOpenJobs(ctx, JOBS_PER_PAGE, {
    query,
    category,
    minBudgetCents,
    offset: (page - 1) * JOBS_PER_PAGE,
  });
  const filtered = query !== "" || category !== "" || minBudgetCents > 0;
  const queryString = url.searchParams.toString();
  const currentHref = `${pageUrl(ctx.basePath, "/jobs")}${queryString === "" ? "" : `?${queryString}`}`;
  const flash = flashFrom(url);
  const pageHref = (target: number): string => {
    const params = new URLSearchParams(url.searchParams);
    if (target <= 1) params.delete("page");
    else params.set("page", String(target));
    const search = params.toString();
    return `${pageUrl(ctx.basePath, "/jobs")}${search === "" ? "" : `?${search}`}`;
  };
  const pagination =
    pageCount <= 1
      ? ""
      : `<nav class="pager" aria-label="Pages">
          <p class="meta">Page ${escapeHtml(String(page))} of ${escapeHtml(String(pageCount))} · ${escapeHtml(String(total))} open job${total === 1 ? "" : "s"}</p>
          ${page > 1 ? `<a class="button button-secondary" href="${escapeHtml(pageHref(page - 1))}" rel="prev">Previous</a>` : ""}
          ${page < pageCount ? `<a class="button button-secondary" href="${escapeHtml(pageHref(page + 1))}" rel="next">Next</a>` : ""}
        </nav>`;

  const list =
    jobs.length === 0
      ? emptyState(
          "No open jobs right now",
          "Check back soon, or sign up as a business and post the first brief.",
        )
      : `<div class="grid cols-2">${jobs.map((job) => jobCard(ctx.basePath, job)).join("")}</div>${pagination}`;

  const content = `<section class="stack">
    <p class="eyebrow">Open work</p>
    <h1>Jobs</h1>
    <p class="lead">Every job is posted by a business account with a budget and a timeline. Applying takes one message.</p>
    <div class="actions">
      ${account?.role === "business" ? `<a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Post a job</a>` : `<a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=business"))}">Post a job</a>`}
      ${account?.role === "coder" ? "" : `<a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=coder"))}">Join as a coder</a>`}
    </div>
    <form class="form filters" method="get" action="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">
      <div class="field">
        <label for="job-q">Search</label>
        <input id="job-q" name="q" type="search" value="${escapeHtml(query)}" placeholder="video, SQLite, landing page…">
      </div>
      <div class="field">
        <label for="job-category">Field</label>
        <select id="job-category" name="category">
          <option value="">Any field</option>
          ${JOB_CATEGORIES.map(
            (value) =>
              `<option value="${escapeHtml(value)}"${value === category ? " selected" : ""}>${escapeHtml(JOB_CATEGORY_LABELS[value])}</option>`,
          ).join("")}
        </select>
      </div>
      <div class="field">
        <label for="job-budget">Budget at least (€)</label>
        <input id="job-budget" name="minBudget" type="number" min="0" step="1" value="${minBudgetCents === 0 ? "" : escapeHtml(String(minBudgetCents / 100))}">
      </div>
      <button class="button" type="submit">Filter</button>
      ${filtered ? `<a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Clear</a>` : ""}
    </form>
    ${
      filtered
        ? account?.role === "coder"
          ? `<form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/saved-searches"))}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(currentHref)}">
      <input type="hidden" name="q" value="${escapeHtml(query)}">
      <input type="hidden" name="category" value="${escapeHtml(category)}">
      <input type="hidden" name="minBudget" value="${minBudgetCents === 0 ? "" : escapeHtml(String(minBudgetCents / 100))}">
      <button class="button button-secondary" type="submit">Save this search</button>
      <span class="meta">We tell you when new jobs match it. No email, just the feed and push.</span>
    </form>`
          : `<p class="meta"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=coder"))}">Join as a coder</a> to save this search and be told about new matches.</p>`
        : ""
    }
    <p class="meta">${escapeHtml(String(jobs.length))} open job${jobs.length === 1 ? "" : "s"}${filtered ? " matching your filters" : ""}</p>
    ${list}
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/jobs",
    title: "Open jobs",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
