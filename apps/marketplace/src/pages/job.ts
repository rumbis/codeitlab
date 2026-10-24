import { FEE_TIERS, FEE_TIER_LABELS, type FeeTier, type Job } from "../shared/contracts.ts";
import type { AppContext } from "../server/context.ts";
import { getEngagementForJob, ledgerForEngagement } from "../server/engagements.ts";
import { getAssistedScope, getShortlist, isShortlisted } from "../server/assistedJobs.ts";
import { businessTrackRecord, businessTrackRecordLine } from "../server/businessReputation.ts";
import { getInviteForCoder, listInvitedCoderIds } from "../server/invites.ts";
import { getInterestForCoder, listInterests } from "../server/jobs.ts";
import { rankCoders } from "../server/matching.ts";
import { loadRatingSummaries } from "../server/ratings.ts";
import { getBusinessProfile, getCoderProfile } from "../server/profiles.ts";
import type { AccountRow } from "../server/types.ts";
import {
  emptyState,
  jobStatusBadge,
  matchReasons,
  money,
  selectField,
  skillChips,
} from "./components.ts";
import { engagementPanel } from "./engagement.ts";
import { escapeHtml } from "./escape.ts";
import { flashFrom, layout, pageUrl } from "./layout.ts";

function hireForm(ctx: AppContext, job: Job, coderId: string, redirectTo: string): string {
  return `<form class="hire-form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/engagements"))}">
    <input type="hidden" name="jobId" value="${escapeHtml(job.id)}">
    <input type="hidden" name="coderId" value="${escapeHtml(coderId)}">
    <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}">
    <p class="field">
      <label for="amount-${escapeHtml(coderId)}">Amount in cents (100 = ${escapeHtml(money(100, job.currency))})</label>
      <input id="amount-${escapeHtml(coderId)}" name="amountCents" type="number" required min="1" max="${escapeHtml(job.budgetMaxCents)}" value="${escapeHtml(job.budgetMinCents)}" step="100">
      <span class="hint">Budget ${escapeHtml(money(job.budgetMinCents, job.currency))}–${escapeHtml(money(job.budgetMaxCents, job.currency))}. The platform fee is deducted from this amount at approval.</span>
    </p>
    ${selectField({
      name: "feeTier",
      label: "How much help do you want?",
      value: job.assisted ? "assisted" : "standard",
      choices: FEE_TIERS.map((tier) => ({
        value: tier,
        label: FEE_TIER_LABELS[tier as FeeTier],
      })),
      hint:
        "Standard: you scope, review and approve, and the platform holds the money and keeps the ledger. Assisted: an operator helps scope the job, shortlist coders and read the delivery evidence with you — worth it for a first engagement or when nobody has time to review. The fee is recorded at approval; a refund before delivery carries no fee." +
        (job.assisted ? " This job is marked assisted, so it uses the 20% tier." : ""),
    })}
    <button class="button" type="submit">Start engagement and charge escrow</button>
  </form>`;
}

export function renderJob(ctx: AppContext, account: AccountRow | null, url: URL, job: Job): string {
  const flash = flashFrom(url);
  const redirectTo = pageUrl(ctx.basePath, `/jobs/${job.id}`);
  const business = getBusinessProfile(ctx, job.businessId);
  const trackRecord = businessTrackRecord(ctx, job.businessId);
  const engagement = getEngagementForJob(ctx, job.id);
  const activeEngagement =
    engagement !== null && engagement.status !== "cancelled" ? engagement : null;

  const owner = account !== null && account.id === job.businessId;
  const scope = getAssistedScope(ctx, job.id);
  const shortlist = new Set(getShortlist(ctx, job.id));
  const coderProfile =
    account !== null && account.role === "coder" ? getCoderProfile(ctx, account.id) : null;

  let viewerSection = "";

  if (owner) {
    const matches = rankCoders(ctx, job, 10);
    const matchRatings = loadRatingSummaries(
      ctx,
      matches.map((match) => match.coder.id),
    );
    const interests = listInterests(ctx, account, job.id);
    const invited = listInvitedCoderIds(ctx, job.id);
    const canHire = activeEngagement === null && job.status !== "closed";

    const matchCards =
      matches.length === 0
        ? emptyState(
            "No approved coder matches yet",
            "Matches appear once coder profiles are approved. Profiles are ranked on skills, availability, rate fit and completeness.",
          )
        : `<div class="stack">${matches
            .map(
              (match) => `<article class="card match-card">
                <div class="card-head">
                  <h4><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/coders/${match.coder.id}`))}">${escapeHtml(match.coder.displayName)}</a>${shortlist.has(match.coder.id) ? ` <span class="badge badge-open">Operator pick</span>` : ""}</h4>
                  <span class="score" aria-label="Match score">${escapeHtml(match.score)}/100</span>
                </div>
                <p class="meta"><span class="badge ${match.reputation.level === "new" ? "badge-requested" : "badge-open"}">${escapeHtml(match.reputation.level === "new" ? "New" : match.reputation.level[0]?.toUpperCase() + match.reputation.level.slice(1))}</span> ${escapeHtml(String(match.reputation.completedEngagements))} paid ${match.reputation.completedEngagements === 1 ? "delivery" : "deliveries"}${match.reputation.evidenceDeliveries === 0 ? "" : ` · ${escapeHtml(String(match.reputation.evidenceDeliveries))} with evidence`}${(matchRatings.get(match.coder.id)?.count ?? 0) === 0 ? "" : ` · ★ ${escapeHtml((matchRatings.get(match.coder.id)?.average ?? 0).toFixed(1))} from ${escapeHtml(String(matchRatings.get(match.coder.id)?.count ?? 0))}`}</p>
                <p class="headline">${escapeHtml(match.coder.headline)}</p>
                <p class="meta">${escapeHtml(money(match.coder.rateMinCents, match.coder.currency))}–${escapeHtml(money(match.coder.rateMaxCents, match.coder.currency))} · ${escapeHtml(match.coder.timezone)}</p>
                ${matchReasons(match.reasons)}
                ${
                  invited.has(match.coder.id)
                    ? `<p class="meta"><span class="badge badge-open">Invited ✓</span> They can apply from their dashboard.</p>`
                    : `<form class="inline-form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/jobs/${job.id}/invite`))}">
                        <input type="hidden" name="coderId" value="${escapeHtml(match.coder.id)}">
                        <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}">
                        <input name="message" type="text" maxlength="300" placeholder="Optional note (300 chars)" aria-label="Optional invite note">
                        <button class="button button-secondary" type="submit">Invite to apply</button>
                      </form>`
                }
                ${canHire ? hireForm(ctx, job, match.coder.id, redirectTo) : `<p class="hint">Hiring is closed while this job has an active engagement.</p>`}
              </article>`,
            )
            .join("")}</div>`;

    const interestList =
      interests.length === 0
        ? `<p class="muted">No applications yet. Coders can apply from this page once they have a profile.</p>`
        : `<ul class="plain-list">${interests
            .map(
              (interest) => `<li class="card">
                <div class="card-head">
                  <h4><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/coders/${interest.coderId}`))}">${escapeHtml(interest.coder?.displayName ?? "Coder")}</a></h4>
                  <span class="meta">${escapeHtml(interest.createdAt.slice(0, 10))}</span>
                </div>
                ${interest.coder === null ? "" : `<p class="headline">${escapeHtml(interest.coder.headline)}</p><p class="chips">${skillChips(interest.coder.skills)}</p>`}
                ${interest.message === "" ? "" : `<blockquote class="quote">${escapeHtml(interest.message)}</blockquote>`}
                ${canHire ? hireForm(ctx, job, interest.coderId, redirectTo) : ""}
              </li>`,
            )
            .join("")}</ul>`;

    viewerSection = `<section class="stack">
      <h2>Ranked coders</h2>
      <p class="meta">Score = 40% skills, 15% declared interest, 15% evidence, 10% availability, 10% rate fit, 5% profile completeness, 5% reputation. Ties go to the older profile. Inviting a coder sends a notification; they still choose whether to apply.</p>
      ${matchCards}
      <h2>Applications</h2>
      ${interestList}
    </section>`;
  } else if (account !== null && account.role === "coder") {
    if (coderProfile === null) {
      viewerSection = `<section class="card">
        <h2>Want this job?</h2>
        <p>Create a coder profile first, then apply with one message.</p>
        <p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Create your profile</a></p>
      </section>`;
    } else {
      const applied = getInterestForCoder(ctx, account, job.id);
      const invite = getInviteForCoder(ctx, account, job.id);
      const isMyEngagement = engagement !== null && engagement.coderId === coderProfile.id;
      viewerSection = `<section class="stack">
        ${
          isShortlisted(ctx, job.id, coderProfile.id)
            ? `<div class="card"><h2>Operator pick</h2><p>An operator shortlisted you for this job. The business sees your profile in the shortlist; applying is still your choice.</p></div>`
            : ""
        }
        ${
          invite === null
            ? ""
            : `<div class="card"><h2>You were invited to apply</h2><p>${escapeHtml(business?.companyName ?? "The business")} picked this job for you${invite.message === "" ? "." : ` — “${escapeHtml(invite.message)}”`}</p><p class="meta">Invitations are not applications: applying is still your choice, and your profile is what the business sees.</p></div>`
        }
        ${
          applied !== null
            ? `<div class="card"><h2>Application sent</h2><p>You applied on ${escapeHtml(applied.createdAt.slice(0, 10))}.</p>${applied.message === "" ? "" : `<blockquote class="quote">${escapeHtml(applied.message)}</blockquote>`}</div>`
            : job.status === "open"
              ? `<form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/jobs/${job.id}/interests`))}">
                  <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}">
                  <h2>Apply for this job</h2>
                  <p class="field">
                    <label for="interest-message">Message to the business</label>
                    <textarea id="interest-message" name="message" rows="4" maxlength="1000" placeholder="Why you, and how you would approach this?"></textarea>
                  </p>
                  <button class="button" type="submit">Send application</button>
                </form>`
              : `<p class="muted">This job is no longer accepting applications.</p>`
        }
        ${isMyEngagement ? engagementPanel({ basePath: ctx.basePath, engagement, viewer: "coder", redirectTo, ledger: ledgerForEngagement(ctx, engagement.id), autoReleaseDays: ctx.autoReleaseDays }) : ""}
      </section>`;
    }
  } else {
    viewerSection = `<section class="card">
      <h2>Want this job?</h2>
      <p><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=coder"))}">Join as a coder</a> to apply, or <a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/login"))}">log in</a>.</p>
    </section>`;
  }

  const engagementSection =
    engagement === null
      ? ""
      : engagementPanel({
          basePath: ctx.basePath,
          engagement,
          viewer: owner
            ? "business"
            : coderProfile !== null && engagement.coderId === coderProfile.id
              ? "coder"
              : "observer",
          redirectTo,
          ledger: ledgerForEngagement(ctx, engagement.id),
          autoReleaseDays: ctx.autoReleaseDays,
        });

  const content = `<section class="stack">
    <p class="eyebrow"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Jobs</a> / job detail</p>
    <div class="card-head">
      <h1>${escapeHtml(job.title)}</h1>
      <span>${job.assisted ? `<span class="badge badge-open">Assisted · 20%</span> ` : ""}${jobStatusBadge(job.status)}</span>
    </div>
    <p class="meta">${escapeHtml(money(job.budgetMinCents, job.currency))}–${escapeHtml(money(job.budgetMaxCents, job.currency))} · ${escapeHtml(job.timeline)} · posted ${escapeHtml(job.createdAt.slice(0, 10))}</p>
    <p class="chips">${skillChips(job.skills)}</p>
    <div class="prose">${escapeHtml(job.description)}</div>
    ${business === null ? "" : `<p class="meta">Posted by ${escapeHtml(business.companyName)}${business.website === "" ? "" : ` · <a class="link" href="${escapeHtml(business.website)}" rel="nofollow noopener" target="_blank">website</a>`}</p>`}
    <p class="meta track-record">${escapeHtml(businessTrackRecordLine(trackRecord))}</p>
    ${account !== null && account.id !== job.businessId ? `<p class="meta"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/report?kind=job&id=${job.id}`))}">Report this job</a></p>` : ""}
    ${
      scope === null
        ? job.assisted
          ? `<p class="meta">CodeitLab is helping run this job: an operator scopes it and shortlists coders.</p>`
          : ""
        : owner
          ? `<div class="card"><h2>CodeitLab operator note</h2><p>${escapeHtml(scope.note)}</p><p class="meta">Written by an operator to help you judge the work. It is advisory: the approve button and the money stay yours.</p></div>`
          : ""
    }
    ${engagementSection}
    ${viewerSection}
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: `/jobs/${job.id}`,
    title: job.title,
    description: job.description.slice(0, 160),
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
