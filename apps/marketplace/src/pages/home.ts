import type { AppContext } from "../server/context.ts";
import { listOpenJobs } from "../server/jobs.ts";
import type { AccountRow } from "../server/types.ts";
import { emptyState, jobCard } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { appDownloadUrl, flashFrom, layout, pageUrl } from "./layout.ts";

export function renderHome(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const jobs = listOpenJobs(ctx, 3);
  const flash = flashFrom(url);

  const jobsSection =
    jobs.length === 0
      ? emptyState(
          "No open jobs yet",
          "Businesses are still writing the first briefs. Post one and coders will find it.",
        )
      : `<div class="grid cols-2">${jobs.map((job) => jobCard(ctx.basePath, job)).join("")}</div>`;

  const content = `<section class="hero">
    <p class="eyebrow">The CodeItLab marketplace</p>
    <h1>Get paid for the work you already ship.</h1>
    <p class="lead">CodeItLab users say they want paid work. Businesses describe the job, the marketplace ranks coders by real fit, and the money sits in escrow until the work is approved. Browse and join here; the work itself lives in the app.</p>
    <div class="actions">
      <a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=coder"))}">Find paid work</a>
      <a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=business"))}">Hire a coder</a>
    </div>
    <p class="hero-note">Interests, jobs and project conversations live in the app, so you can follow work without keeping a browser tab open. <a href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Browse jobs</a> or read <a href="${escapeHtml(pageUrl(ctx.basePath, "/how-it-works"))}">how it works</a> first, then <a href="${escapeHtml(appDownloadUrl)}">get the app</a> to pick the work up.</p>
  </section>

  <section class="stack">
    <h2>How it works</h2>
    <ol class="steps">
      <li><strong>Sign in with a code.</strong> No passwords. Tell us whether you are a coder or a business.</li>
      <li><strong>Post or apply.</strong> Businesses publish a brief and budget; coders publish skills, availability and a rate range.</li>
      <li><strong>Match, agree, deliver.</strong> The marketplace ranks coders per job with reasons. The business funds escrow, the coder delivers, approval releases the payout to the coder — the agreed amount minus the 15% platform fee (20% when CodeItLab helps run the project).</li>
    </ol>
  </section>

  <section class="stack">
    <div class="section-head">
      <h2>Latest open jobs</h2>
      <a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">See all jobs</a>
    </div>
    ${jobsSection}
  </section>

  <section class="cta-band">
    <h2>Coders are reviewed before they are listed.</h2>
    <p>Profiles start unapproved. An admin reviews them so businesses see real people with real skills, not a directory of placeholders.</p>
    <p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/coders"))}">Browse coders</a></p>
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/",
    title: "Hire vibe coders, or get paid to build",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
