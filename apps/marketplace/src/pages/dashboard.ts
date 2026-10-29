import {
  AVAILABILITY_LABELS,
  JOB_CATEGORIES,
  JOB_CATEGORY_LABELS,
  type Availability,
} from "../shared/contracts.ts";
import type { AppContext } from "../server/context.ts";
import { ledgerForEngagement, listEngagements } from "../server/engagements.ts";
import {
  getJob,
  listInterestsForCoder,
  listJobsForBusiness,
  repeatSourceFor,
  type RepeatSource,
} from "../server/jobs.ts";
import { findCoderRowById, getBusinessProfile, getCoderProfile } from "../server/profiles.ts";
import { listInvitesForCoder } from "../server/invites.ts";
import { recommendedJobsForCoder } from "../server/recommendations.ts";
import { findJobTemplate, JOB_TEMPLATES, type JobTemplate } from "../server/jobTemplates.ts";
import {
  coderAlertHref,
  coderAlertLabel,
  coderAlertMatches,
  listCoderAlerts,
} from "../server/coderAlerts.ts";
import {
  listSavedSearches,
  savedSearchHref,
  savedSearchMatchCount,
  type SavedSearch,
} from "../server/savedSearches.ts";
import { listSessions } from "../server/sessions.ts";
import { getEmailNotificationPreference } from "../server/notifications.ts";
import { listNotifications, unreadNotificationCount } from "../server/notifications.ts";
import {
  listRatingsForCoder,
  loadRatingsForEngagements,
  ratingSummaryForCoder,
} from "../server/ratings.ts";
import { questsFor } from "../server/quests.ts";
import { reputationForCoder } from "../server/reputation.ts";
import type { AccountRow } from "../server/types.ts";
import {
  emptyState,
  engagementStatusLabel,
  field,
  jobStatusBadge,
  money,
  selectField,
  textareaField,
} from "./components.ts";
import { engagementPanel } from "./engagement.ts";
import { escapeHtml } from "./escape.ts";
import { appDownloadUrl, flashFrom, layout, pageUrl } from "./layout.ts";

const AVAILABILITY_CHOICES = (Object.keys(AVAILABILITY_LABELS) as Availability[]).map((value) => ({
  value,
  label: AVAILABILITY_LABELS[value],
}));

function coderProfileSection(ctx: AppContext, account: AccountRow): string {
  const profile = getCoderProfile(ctx, account.id);
  const linksText =
    profile === null
      ? ""
      : Object.entries(profile.links)
          .map(([label, href]) => `${label}=${href}`)
          .join("\n");
  const skillLevelsText =
    profile === null
      ? ""
      : Object.entries(profile.skillLevels)
          .map(([skill, level]) => `${skill}=${level}`)
          .join("\n");
  const evidenceText = profile === null ? "" : profile.evidence.join("\n");

  return `<section class="stack">
    <div class="section-head">
      <h2>Your coder profile</h2>
      ${profile === null ? "" : profile.approved ? `<span class="badge badge-open">Approved</span>` : `<span class="badge badge-requested">Pending review</span>`}
    </div>
    <p class="meta">${
      profile === null
        ? "Create a profile to appear in matches and to apply for jobs."
        : profile.approved
          ? "Your profile is live in the coder directory and in job matches."
          : "An admin reviews new profiles before they are listed or matched. You can apply for jobs meanwhile."
    }</p>
    <form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/coders/profile"))}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
      ${field({ name: "displayName", label: "Display name", required: true, value: profile?.displayName ?? "", autocomplete: "name" })}
      ${field({ name: "headline", label: "Headline", required: true, value: profile?.headline ?? "", placeholder: "Full-stack product engineer" })}
      ${textareaField({ name: "bio", label: "Bio", required: true, value: profile?.bio ?? "", rows: 6, hint: "At least 40 characters earns full completeness credit. Tell businesses what you ship and how you work.", maxlength: 2000 })}
      ${field({ name: "skills", label: "Skills", required: true, value: profile?.skills.join(", ") ?? "", placeholder: "React, TypeScript, Node.js, SQLite", hint: "Comma separated, at most 30." })}
      ${field({ name: "interests", label: "Interests", value: profile?.interests.join(", ") ?? "", placeholder: "web, ai, video", hint: "The fields you want paid work in (web, video, data, ops, design, ai, other). Matching rewards the overlap with a job's field." })}
      ${textareaField({ name: "skillLevels", label: "Skill levels", value: skillLevelsText, rows: 3, placeholder: "React=5\nTypeScript=4\nSQLite=3", hint: "Optional: Skill=1–5, one per line. Matching rewards depth on the skills a job asks for." })}
      ${textareaField({ name: "evidence", label: "Evidence links", value: evidenceText, rows: 3, placeholder: "https://github.com/you/project\nhttps://you.dev/case-study", hint: "Up to 5 http(s) links that prove the work: repos, case studies, deliveries." })}
      ${selectField({ name: "availability", label: "Availability", value: profile?.availability ?? "part_time", choices: AVAILABILITY_CHOICES })}
      ${field({ name: "rateMinCents", label: "Minimum rate in cents (100 = 1 unit)", type: "number", required: true, min: 0, value: profile?.rateMinCents ?? 3000, step: 100 })}
      ${field({ name: "rateMaxCents", label: "Maximum rate in cents", type: "number", required: true, min: 0, value: profile?.rateMaxCents ?? 8000, step: 100 })}
      ${field({ name: "currency", label: "Currency", required: true, value: profile?.currency ?? "EUR", placeholder: "EUR" })}
      ${field({ name: "timezone", label: "Timezone", required: true, value: profile?.timezone ?? "Europe/Berlin", placeholder: "Europe/Berlin" })}
      ${textareaField({ name: "links", label: "Links", value: linksText, rows: 3, placeholder: "GitHub=https://github.com/you\nPortfolio=https://you.dev", hint: "One per line as Label=https://…, at most 5." })}
      <button class="button" type="submit">${profile === null ? "Create profile" : "Save profile"}</button>
    </form>
  </section>`;
}

/**
 * The coder's own reputation, derived from the ledger. It is the same number
 * businesses see, so there is nothing to game: the only way to change it is to
 * deliver paid work and attach evidence.
 */
/**
 * "What needs me?" in one list. The feed is written by the state changes
 * themselves, so it cannot drift from what actually happened.
 */
function activitySection(ctx: AppContext, account: AccountRow): string {
  const notifications = listNotifications(ctx, account.id, 10);
  const unread = unreadNotificationCount(ctx, account.id);
  if (notifications.length === 0) {
    return `<section class="stack"><h2>Activity</h2>${emptyState("Nothing yet", "Applications, deliveries and approvals land here.")}</section>`;
  }
  const items = notifications
    .map(
      (item) => `<li class="card notification ${item.read ? "" : "is-unread"}">
        <div class="card-head">
          <span class="badge ${item.read ? "badge-requested" : "badge-open"}">${item.read ? "Read" : "New"}</span>
          <span class="meta">${escapeHtml(item.createdAt.slice(0, 16).replace("T", " "))}</span>
        </div>
        <p>${escapeHtml(item.message)}</p>
        <p class="meta"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, item.href))}">Open</a></p>
      </li>`,
    )
    .join("");
  return `<section class="stack">
    <div class="section-head">
      <h2>Activity</h2>
      ${unread === 0 ? "" : `<span class="badge badge-open">${escapeHtml(String(unread))} new</span>`}
    </div>
    <ul class="plain-list">${items}</ul>
    ${unread === 0 ? "" : `<form class="inline-form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/notifications/read"))}"><input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}"><button class="button button-secondary" type="submit">Mark all read</button></form>`}
  </section>`;
}

function reputationSection(ctx: AppContext, account: AccountRow): string {
  const profile = getCoderProfile(ctx, account.id);
  if (profile === null) return "";
  const reputation = reputationForCoder(ctx, profile.id, profile.currency);
  const earned =
    reputation.earnedCents === 0
      ? ""
      : ` · ${money(reputation.earnedCents, reputation.currency)} earned`;
  const badges = reputation.badges
    .map(
      (badge) => `<li class="reputation-badge ${badge.earned ? "is-earned" : ""}">
        <span class="badge ${badge.earned ? "badge-open" : "badge-requested"}">${badge.earned ? "Earned" : "Locked"}</span>
        <strong>${escapeHtml(badge.label)}</strong>
        <span class="meta">${escapeHtml(badge.lesson)}</span>
      </li>`,
    )
    .join("");

  return `<section class="stack">
    <div class="section-head">
      <h2>Reputation</h2>
      <span class="badge badge-open">${escapeHtml(reputation.levelLabel)}</span>
    </div>
    <p class="meta">${escapeHtml(String(reputation.completedEngagements))} paid ${reputation.completedEngagements === 1 ? "delivery" : "deliveries"} · ${escapeHtml(String(reputation.evidenceDeliveries))} with evidence · ${escapeHtml(String(reputation.disputes))} dispute${reputation.disputes === 1 ? "" : "s"}${earned}</p>
    <p>${escapeHtml(reputation.levelNote)}</p>
    <p class="meta">${escapeHtml(reputation.nextMilestone)}</p>
    <ul class="plain-list">${badges}</ul>
  </section>`;
}

function coderApplicationsSection(ctx: AppContext, account: AccountRow): string {
  const applications = listInterestsForCoder(ctx, account);
  if (applications.length === 0) {
    return `<section class="stack"><h2>Applications</h2>${emptyState("No applications yet", "Browse open jobs and send one message to the business.")}<p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Browse jobs</a></p></section>`;
  }
  return `<section class="stack">
    <h2>Applications</h2>
    <ul class="plain-list">${applications
      .map(
        (application) => `<li class="card">
          <div class="card-head">
            <h3><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/jobs/${application.jobId}`))}">${escapeHtml(application.jobTitle)}</a></h3>
            <span class="meta">${escapeHtml(application.jobStatus)} · ${escapeHtml(application.createdAt.slice(0, 10))}</span>
          </div>
          ${application.message === "" ? "" : `<blockquote class="quote">${escapeHtml(application.message)}</blockquote>`}
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

function businessProfileSection(ctx: AppContext, account: AccountRow): string {
  const profile = getBusinessProfile(ctx, account.id);
  return `<section class="stack">
    <h2>Your business profile</h2>
    <p class="meta">Shown on every job you post, so coders know who they are talking to.</p>
    <form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/business/profile"))}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
      ${field({ name: "companyName", label: "Company name", required: true, value: profile?.companyName ?? "", autocomplete: "organization" })}
      ${field({ name: "website", label: "Website", type: "url", value: profile?.website ?? "", placeholder: "https://example.com" })}
      ${textareaField({ name: "about", label: "About", value: profile?.about ?? "", rows: 4, maxlength: 2000 })}
      ${selectField({
        name: "industry",
        label: "Field you usually hire for",
        value: profile?.industry ?? "",
        choices: [
          { value: "", label: "No field yet" },
          ...JOB_CATEGORIES.map((category) => ({
            value: category,
            label: JOB_CATEGORY_LABELS[category],
          })),
        ],
        hint: "New job posts start in this field; you can change it per job.",
      })}
      <button class="button" type="submit">${profile === null ? "Create business profile" : "Save business profile"}</button>
    </form>
  </section>`;
}

function skillsText(prefill: { readonly skills: string | readonly string[] }): string {
  return typeof prefill.skills === "string" ? prefill.skills : prefill.skills.join(", ");
}

function postJobSection(
  ctx: AppContext,
  account: AccountRow,
  repeat: RepeatSource | null,
  template: JobTemplate | null,
): string {
  const job = repeat?.job ?? null;
  const prefill = template ?? job;
  const industry = getBusinessProfile(ctx, account.id)?.industry ?? "";
  const templateNote =
    template === null || repeat !== null
      ? ""
      : `<p class="meta">Template: <strong>${escapeHtml(template.label)}</strong> — ${escapeHtml(template.blurb)} Every field is prefilled and editable; nothing is published until you press Publish.</p>`;
  const repeatNote =
    repeat === null
      ? ""
      : `<p class="meta">Prefilled from a settled engagement. This is a new posting with new escrow, and the same coder gets an invitation when you publish.</p>`;
  return `<section class="stack" id="post-job">
    <h2>Post a job</h2>
    ${
      repeat === null
        ? `<p class="meta">Start from a template if you want to see what a complete brief looks like: ${JOB_TEMPLATES.map(
            (item) =>
              `<a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/dashboard?template=${encodeURIComponent(item.id)}`))}#post-job">${escapeHtml(item.label)}</a>`,
          ).join(" · ")}${
            template === null
              ? ""
              : ` · <a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}#post-job">clear</a>`
          }</p>`
        : ""
    }
    ${templateNote}
    ${repeatNote}
    <form class="card form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/jobs"))}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
      ${repeat === null ? "" : `<input type="hidden" name="repeatEngagementId" value="${escapeHtml(repeat.engagementId)}">`}
      ${field({ name: "title", label: "Job title", required: true, placeholder: "Build a booking flow for a yoga studio", value: prefill?.title ?? "" })}
      ${textareaField({ name: "description", label: "Description", required: true, rows: 6, hint: "At least 20 characters: scope, stack, definition of done.", maxlength: 5000, value: prefill?.description ?? "" })}
      ${field({ name: "skills", label: "Required skills", required: true, placeholder: "React, Node.js, SQLite", hint: "Comma separated, at most 30.", value: prefill === null ? "" : skillsText(prefill) })}
      ${selectField({
        name: "category",
        label: "Field",
        value: prefill?.category ?? (industry === "" ? "web" : industry),
        choices: JOB_CATEGORIES.map((category) => ({
          value: category,
          label: JOB_CATEGORY_LABELS[category],
        })),
      })}
      ${field({ name: "budgetMinCents", label: "Minimum budget in cents (100 = 1 unit)", type: "number", required: true, min: 1, value: prefill?.budgetMinCents ?? 50000, step: 100 })}
      ${field({ name: "budgetMaxCents", label: "Maximum budget in cents", type: "number", required: true, min: 1, value: prefill?.budgetMaxCents ?? 150000, step: 100 })}
      ${field({ name: "currency", label: "Currency", required: true, value: job?.currency ?? "EUR", placeholder: "EUR" })}
      ${field({ name: "timeline", label: "Timeline", required: true, value: prefill?.timeline ?? "2–3 weeks", placeholder: "2–3 weeks" })}
      <p class="field">
        <label><input type="checkbox" name="assisted" value="on"${job?.assisted === true ? " checked" : ""}> Ask CodeItLab to help run this project (20% tier)</label>
        <span class="hint">An operator writes a scoping note (what “done” means, what to check), shortlists up to three coders, and reviews the delivery evidence with you. Jobs marked assisted use the 20% fee; standard jobs stay at 15%.</span>
      </p>
      <button class="button" type="submit">Publish job</button>
    </form>
  </section>`;
}

function businessJobsSection(ctx: AppContext, account: AccountRow): string {
  const jobs = listJobsForBusiness(ctx, account.id);
  if (jobs.length === 0) {
    return `<section class="stack"><h2>Your jobs</h2>${emptyState("No jobs yet", "Post your first brief above. It is visible to coders immediately.")}</section>`;
  }
  return `<section class="stack">
    <h2>Your jobs</h2>
    <ul class="plain-list">${jobs
      .map(
        (job) => `<li class="card">
          <div class="card-head">
            <h3><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/jobs/${job.id}`))}">${escapeHtml(job.title)}</a></h3>
            ${jobStatusBadge(job.status)}
          </div>
          <p class="meta">${escapeHtml(money(job.budgetMinCents, job.currency))}–${escapeHtml(money(job.budgetMaxCents, job.currency))} · ${escapeHtml(job.timeline)}</p>
          ${
            job.status === "open"
              ? `<form class="inline-form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/jobs/${job.id}/close`))}">
                  <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
                  <button class="button button-secondary" type="submit">Close job</button>
                </form>
                <p class="hint">Closing stops applications and removes the job from the board. No fee, no escrow — and you can reopen it.</p>`
              : job.status === "closed"
                ? `<form class="inline-form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/jobs/${job.id}/reopen`))}">
                  <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
                  <button class="button button-secondary" type="submit">Reopen job</button>
                </form>`
                : `<p class="hint">Hiring is paused while an engagement on this job is active. Cancel the engagement to reopen applications.</p>`
          }
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

/**
 * The rating form appears only after the payout, so a business can never hint at
 * a score while the money is still held. One form per paid, unrated engagement.
 */
function rateDeliveriesSection(ctx: AppContext, account: AccountRow): string {
  const engagements = listEngagements(ctx, account).filter(
    (engagement) => engagement.status === "paid_out",
  );
  if (engagements.length === 0) return "";
  const ratings = loadRatingsForEngagements(
    ctx,
    engagements.map((engagement) => engagement.id),
  );
  const unrated = engagements.filter((engagement) => !ratings.has(engagement.id));
  if (unrated.length === 0) return "";
  const forms = unrated
    .map((engagement) => {
      const jobTitle = getJob(ctx, engagement.jobId)?.title ?? engagement.jobId;
      const formId = `rating-${engagement.id}`;
      return `<form class="form rating-form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/engagements/${engagement.id}/rating`))}">
        <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
        <h3>${escapeHtml(jobTitle)}</h3>
        <div class="field">
          <label for="${escapeHtml(formId)}-score">How did the delivery go?</label>
          <select id="${escapeHtml(formId)}-score" name="score" required>
            <option value="5">5 — exactly what was needed</option>
            <option value="4">4 — good, small fixes</option>
            <option value="3">3 — acceptable</option>
            <option value="2">2 — needed rework</option>
            <option value="1">1 — not delivered as agreed</option>
          </select>
        </div>
        <div class="field">
          <label for="${escapeHtml(formId)}-comment">One sentence for the next business (optional)</label>
          <input id="${escapeHtml(formId)}-comment" name="comment" type="text" maxlength="500" placeholder="What should someone hiring them know?">
        </div>
        <button class="button" type="submit">Save rating</button>
      </form>`;
    })
    .join("");
  return `<section class="stack">
    <h2>Rate the work you paid for</h2>
    <p class="lead">Ratings are written after the payout, so they can never be used to negotiate money. They appear on the coder's card and in the directory.</p>
    ${forms}
  </section>`;
}

/** What the coder sees: the score that now answers the first question a business asks. */
function receivedRatingsSection(ctx: AppContext, account: AccountRow): string {
  const profile = getCoderProfile(ctx, account.id);
  if (profile === null) return "";
  const summary = ratingSummaryForCoder(ctx, profile.id);
  if (summary.count === 0) return "";
  const recent = listRatingsForCoder(ctx, profile.id, 3);
  return `<section class="stack">
    <div class="section-head">
      <h2>Ratings</h2>
      <span class="badge badge-open">★ ${escapeHtml(summary.average.toFixed(1))} · ${escapeHtml(String(summary.count))}</span>
    </div>
    <p class="meta">Only businesses that paid can rate you, and only after the payout.</p>
    <ul class="plain-list">${recent
      .map(
        (rating) => `<li class="card">
          <div class="card-head"><h3>★ ${escapeHtml(String(rating.score))}/5</h3><span class="meta">${escapeHtml(rating.createdAt.slice(0, 10))}</span></div>
          ${rating.comment === "" ? `<p class="muted">No comment left.</p>` : `<p>“${escapeHtml(rating.comment)}”</p>`}
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

/**
 * Invitations are the business reaching out first. They are shown separately from
 * applications because the decision is still the coder's: nothing is auto-applied.
 */
function invitationsSection(ctx: AppContext, account: AccountRow): string {
  const invites = listInvitesForCoder(ctx, account, 5);
  if (invites.length === 0) return "";
  return `<section class="stack">
    <h2>Invitations</h2>
    <p class="lead">A business put its job in front of you. Applying is still your call — and it is what the business can actually act on.</p>
    <ul class="plain-list">${invites
      .map(
        (invite) => `<li class="card">
          <div class="card-head">
            <h3><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/jobs/${invite.jobId}`))}">${escapeHtml(invite.jobTitle)}</a></h3>
            <span class="badge ${invite.jobStatus === "open" ? "badge-open" : "badge-requested"}">${escapeHtml(invite.jobStatus)}</span>
          </div>
          <p class="meta">${invite.companyName === "" ? "A business" : escapeHtml(invite.companyName)} · ${escapeHtml(money(invite.budgetMinCents, invite.currency))}–${escapeHtml(money(invite.budgetMaxCents, invite.currency))} · invited ${escapeHtml(invite.createdAt.slice(0, 10))}</p>
          ${invite.message === "" ? "" : `<blockquote class="quote">${escapeHtml(invite.message)}</blockquote>`}
          <p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, `/jobs/${invite.jobId}`))}">View job and apply</a></p>
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

/**
 * Recommendations are derived from what the coder declared (skills and fields),
 * not from clicks or a model: a job appears because it overlaps with the
 * declaration, and the reasons are shown next to it.
 */
/**
 * One device-level switch. Push is for things a person must act on (a delivery
 * waiting, an engagement starting), never marketing — and it says so.
 */
function notificationsSection(ctx: AppContext, account: AccountRow): string {
  const emailOn = getEmailNotificationPreference(ctx, account.id);
  return `<section class="card" id="notifications">
    <h2>Notifications on this device</h2>
    <p class="meta">A push when a delivery is waiting or an engagement starts — even with the tab closed. No marketing, ever.</p>
    ${
      ctx.push === null
        ? `<p class="meta">Push is not configured on this server.</p>`
        : `<p><button type="button" class="button button-secondary" id="enable-push">Enable notifications</button> <span class="meta" id="push-status"></span></p>`
    }
    <form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/notifications/preferences"))}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
      <label class="checkbox"><input type="checkbox" name="emailNotifications" value="on"${emailOn ? " checked" : ""}> Also email me about invitations, deliveries, approvals and disputes</label>
      <button class="button button-secondary" type="submit">Save email setting</button>
    </form>
    <p class="meta">Only those events, never marketing. Login codes are always emailed.</p>
  </section>`;
}

/**
 * Security a person can act on: see the devices that hold a session, and end
 * the ones that are not this one.
 */
function sessionsSection(ctx: AppContext, account: AccountRow, currentSessionId: string): string {
  const sessions = listSessions(ctx, account.id, currentSessionId);
  return `<section class="card">
    <h2>Active sessions</h2>
    <p class="meta">Every device with a live login. The session cookie is the only thing that proves it is you — if you see a device you do not recognise, sign it out.</p>
    <ul class="plain-list">${sessions
      .map(
        (session) => `<li class="session-row">
          <span><strong>${escapeHtml(session.device)}</strong>${session.current ? ` <span class="badge badge-open">This device</span>` : ""}</span>
          <span class="meta">signed in ${escapeHtml(session.createdAt.slice(0, 10))} · expires ${escapeHtml(session.expiresAt.slice(0, 10))}</span>
          ${
            session.current
              ? ""
              : `<form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/auth/sessions/${session.id}/revoke`))}">
                  <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
                  <button class="button button-secondary" type="submit">Sign out</button>
                </form>`
          }
        </li>`,
      )
      .join("")}</ul>
    ${
      sessions.length > 1
        ? `<form class="form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/auth/sessions/revoke-others"))}">
            <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
            <button class="button" type="submit">Sign out all other devices</button>
          </form>`
        : ""
    }
  </section>`;
}

function recommendedJobsSection(ctx: AppContext, account: AccountRow): string {
  const recommended = recommendedJobsForCoder(ctx, account, 5);
  if (recommended.length === 0) return "";
  return `<section class="stack">
    <div class="section-head">
      <h2>Jobs for your declared interests</h2>
      <a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Browse all jobs</a>
    </div>
    <p class="lead">Built from your skills and the fields you said you want to work in — not from what you clicked.</p>
    <ul class="plain-list">${recommended
      .map(
        ({ job, matchedSkills, matchedInterests }) => `<li class="card">
          <div class="card-head">
            <h3><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/jobs/${job.id}`))}">${escapeHtml(job.title)}</a></h3>
            <span class="meta">${escapeHtml(money(job.budgetMinCents, job.currency))}–${escapeHtml(money(job.budgetMaxCents, job.currency))}</span>
          </div>
          <p class="meta">${matchedSkills.length === 0 ? "" : `Matches your skills: ${escapeHtml(matchedSkills.join(", "))}`}${matchedSkills.length > 0 && matchedInterests.length > 0 ? " · " : ""}${matchedInterests.length === 0 ? "" : `Field you want: ${escapeHtml(matchedInterests.join(", "))}`}</p>
          <p class="meta">${escapeHtml(job.timeline)} · posted ${escapeHtml(job.createdAt.slice(0, 10))}</p>
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

function engagementsSection(ctx: AppContext, account: AccountRow): string {
  const engagements = listEngagements(ctx, account);
  if (engagements.length === 0) {
    return `<section class="stack"><h2>Engagements</h2>${emptyState("No engagements yet", account.role === "coder" ? "When a business starts an engagement with you it appears here." : "Open one of your jobs and start an engagement with a ranked coder.")}</section>`;
  }
  const viewer = account.role === "coder" ? "coder" : "business";
  const ratings = loadRatingsForEngagements(
    ctx,
    engagements.map((engagement) => engagement.id),
  );
  return `<section class="stack">
    <h2>Engagements</h2>
    ${engagements
      .map((engagement) => {
        const rating = ratings.get(engagement.id);
        const ratingLine =
          rating === undefined
            ? ""
            : `<p class="meta rating-line">${viewer === "business" ? "You rated this delivery" : "The business rated this delivery"} <span class="badge badge-open">★ ${escapeHtml(String(rating.score))}/5</span>${
                rating.comment === "" ? "" : ` — “${escapeHtml(rating.comment)}”`
              }</p>`;
        const coderName =
          viewer === "business"
            ? (findCoderRowById(ctx, engagement.coderId)?.displayName ?? "your coder")
            : "";
        const hireAgain =
          viewer === "business" &&
          (engagement.status === "paid_out" || engagement.status === "approved")
            ? `<p class="meta"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/dashboard?repeat=${engagement.id}`))}#post-job">Hire ${escapeHtml(coderName)} again</a> — same brief, new escrow, one click.</p>`
            : "";
        return (
          engagementPanel({
            basePath: ctx.basePath,
            engagement,
            viewer,
            redirectTo: pageUrl(ctx.basePath, "/dashboard"),
            ledger: ledgerForEngagement(ctx, engagement.id),
            jobTitle: getJob(ctx, engagement.jobId)?.title ?? engagement.jobId,
            autoReleaseDays: ctx.autoReleaseDays,
          }) +
          ratingLine +
          hireAgain
        );
      })
      .join("")}
    <p class="meta">${escapeHtml(engagements.length)} engagement${engagements.length === 1 ? "" : "s"}. Statuses: ${escapeHtml(engagements.map((engagement) => engagementStatusLabel(engagement.status)).join(", "))}.</p>
  </section>`;
}

function savedSearchLabel(search: SavedSearch): string {
  const parts: string[] = [];
  if (search.query !== "") parts.push(`“${search.query}”`);
  if (search.category !== "") parts.push(JOB_CATEGORY_LABELS[search.category]);
  if (search.minBudgetCents > 0) parts.push(`at least ${money(search.minBudgetCents, "EUR")}`);
  return parts.join(" · ");
}

function savedSearchesSection(ctx: AppContext, account: AccountRow): string {
  if (account.role !== "coder") return "";
  const searches = listSavedSearches(ctx, account.id);
  if (searches.length === 0) {
    return `<section class="stack"><h2>Saved searches</h2>${emptyState("No saved searches", "Filter /jobs by text, field or budget, then save the search. New matches show up in your feed.")}<p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Browse jobs</a></p></section>`;
  }
  return `<section class="stack">
    <h2>Saved searches</h2>
    <p class="meta">An alert runs on a schedule; when a new job matches, it lands in your feed and push. Alerts never send email.</p>
    <ul class="plain-list">${searches
      .map(
        (search) => `<li class="card">
          <div class="card-head">
            <h3><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, savedSearchHref(search)))}">${escapeHtml(savedSearchLabel(search))}</a></h3>
            <span class="meta">${escapeHtml(String(savedSearchMatchCount(ctx, search)))} open match${savedSearchMatchCount(ctx, search) === 1 ? "" : "es"}</span>
          </div>
          <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/saved-searches/${search.id}/delete`))}">
            <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">
            <button class="button button-secondary" type="submit">Remove</button>
          </form>
        </li>`,
      )
      .join("")}</ul>
  </section>`;
}

function coderAlertsSection(ctx: AppContext, account: AccountRow): string {
  if (account.role !== "business") return "";
  const alerts = listCoderAlerts(ctx, account.id);
  // The field a business declared in its profile is also the domain it most
  // likely wants to watch, so the alert form starts there.
  const industry = getBusinessProfile(ctx, account.id)?.industry ?? "";
  return `<section class="stack" id="watch-coders">
    <h2>Watch for coders</h2>
    <p class="meta">The mirror of a saved job search, for the side with no time: say which skills, domain or maximum rate you watch, and the sweep tells you when an approved coder who fits appears. Feed and push only, never email, and it never changes the ranking.</p>
    <form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/coder-alerts"))}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}#watch-coders">
      ${field({ name: "skills", label: "Skills (comma separated)", placeholder: "TypeScript, video", value: "" })}
      ${field({ name: "interest", label: "Interest domain", placeholder: "video", value: industry, hint: industry === "" ? "Defaults to the field in your business profile once you set one." : "From your business profile; change it for this alert only." })}
      ${field({ name: "maxRate", label: "Maximum rate (€/h)", type: "number", min: 1, step: 1, value: "" })}
      <button class="button button-secondary" type="submit">Watch for coders</button>
    </form>
    ${
      alerts.length === 0
        ? `<p class="muted">No coder alerts yet. At least one filter is required.</p>`
        : `<ul class="plain-list">${alerts
            .map((alert) => {
              const matches = coderAlertMatches(ctx, alert);
              return `<li class="card">
                <div class="card-head">
                  <h3><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, coderAlertHref(alert)))}">${escapeHtml(coderAlertLabel(alert))}</a></h3>
                  <span class="meta">${escapeHtml(String(matches.length))}${matches.length >= 5 ? "+" : ""} matching now</span>
                </div>
                <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/coder-alerts/${alert.id}/delete`))}">
                  <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}#watch-coders">
                  <button class="button button-secondary" type="submit">Remove</button>
                </form>
              </li>`;
            })
            .join("")}</ul>`
    }
  </section>`;
}

/**
 * Data portability, stated plainly: the file is generated from the same rows the
 * pages read, and it never contains session tokens or another account's work.
 */
function dataExportSection(ctx: AppContext): string {
  return `<section class="stack">
    <h2>Your data</h2>
    <p class="meta">Everything CodeItLab knows about your account — profile, jobs, applications, engagements, ledger entries, ratings, notifications and signed-in devices — in one JSON file. Session tokens are never included. No lock-in.</p>
    <p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/api/me/export"))}" download="codeitlab-account.json">Download my data</a></p>
  </section>`;
}

function deleteAccountSection(ctx: AppContext): string {
  return `<section class="stack" id="delete-account">
    <h2>Delete your account</h2>
    <p class="meta">This removes your personal data: the email is replaced, your profile is hidden and emptied, sessions and push subscriptions are removed, open jobs are closed. Escrow must be settled first. Ledger rows stay as the accounting record and never contained your email, so a deleted account still balances. This cannot be undone — signing in again with the same address creates a new account.</p>
    <form class="form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/me/delete"))}">
      <input type="hidden" name="redirectTo" value="${escapeHtml(pageUrl(ctx.basePath, "/"))}">
      <p class="field">
        <label><input type="checkbox" name="confirm" value="delete" required> I understand this deletes my personal data permanently</label>
      </p>
      <button class="button button-danger" type="submit">Delete my account</button>
    </form>
  </section>`;
}

/**
 * The gamified part of the dashboard: a real checklist derived from what the
 * account has produced. Each row carries its 60-second lesson and the capability
 * it unlocks, so the "game" teaches the product instead of decorating it.
 */
function questsSection(ctx: AppContext, account: AccountRow): string {
  const board = questsFor(ctx, account);
  const rows = board.quests
    .map(
      (quest) => `<li class="card">
        <div class="card-head">
          <h3>${quest.done ? "✓ " : ""}${escapeHtml(quest.title)}</h3>
          <span class="badge ${quest.done ? "badge-open" : "badge-requested"}">${quest.done ? "Done" : "Next"}</span>
        </div>
        <p class="meta">${escapeHtml(quest.detail)}</p>
        ${
          quest.done
            ? `<p class="meta">Unlocked: ${escapeHtml(quest.reward)}</p>`
            : `<details class="lesson"><summary>Why this matters (60s)</summary><p>${escapeHtml(quest.lesson)}</p></details>
               <p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, quest.href))}">Do it</a> <span class="meta">Unlocks: ${escapeHtml(quest.reward)}</span></p>`
        }
      </li>`,
    )
    .join("");
  return `<section class="stack">
    <div class="section-head">
      <h2>Your next steps</h2>
      <span class="meta">${board.done} of ${board.total} done</span>
    </div>
    <p class="lead">Every step unlocks something real. No points, no streaks — just the next thing that moves your work forward.</p>
    <ul class="plain-list">${rows}</ul>
  </section>`;
}

export function renderDashboard(
  ctx: AppContext,
  account: AccountRow | null,
  url: URL,
  currentSessionId = "",
): string {
  const flash = flashFrom(url);

  if (account === null) {
    const content = `<section class="stack narrow">
      <h1>Your dashboard</h1>
      <p class="lead">Log in with your email code to manage your profile, jobs and engagements.</p>
      <p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/login"))}">Log in</a>
      <a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/join"))}">Join</a></p>
    </section>`;
    return layout({
      basePath: ctx.basePath,
      baseUrl: ctx.baseUrl,
      canonicalPath: "/dashboard",
      title: "Dashboard",
      account,
      content,
      notice: flash.notice,
      error: flash.error,
    });
  }

  const content =
    account.role === "coder"
      ? `<section class="stack">
          <p class="eyebrow">Coder dashboard</p>
          <h1>${escapeHtml(account.email)}</h1>
          <p class="lead">Keep your profile current: it drives your match score and what businesses see.</p>
          <p><a class="button" href="${escapeHtml(appDownloadUrl)}">Open the work in the app</a></p>
        </section>
        ${questsSection(ctx, account)}
        ${activitySection(ctx, account)}
        ${notificationsSection(ctx, account)}
        ${sessionsSection(ctx, account, currentSessionId)}
        ${dataExportSection(ctx)}
        ${deleteAccountSection(ctx)}
        ${reputationSection(ctx, account)}
        ${receivedRatingsSection(ctx, account)}
        ${invitationsSection(ctx, account)}
        ${recommendedJobsSection(ctx, account)}
        ${savedSearchesSection(ctx, account)}
        ${coderProfileSection(ctx, account)}
        ${coderApplicationsSection(ctx, account)}
        ${engagementsSection(ctx, account)}`
      : `<section class="stack">
          <p class="eyebrow">Business dashboard</p>
          <h1>${escapeHtml(account.email)}</h1>
          <p class="lead">Post the brief, compare ranked coders, fund escrow, approve the delivery.</p>
          <p><a class="button" href="${escapeHtml(appDownloadUrl)}">Open the work in the app</a></p>
        </section>
        ${questsSection(ctx, account)}
        ${activitySection(ctx, account)}
        ${notificationsSection(ctx, account)}
        ${sessionsSection(ctx, account, currentSessionId)}
        ${dataExportSection(ctx)}
        ${deleteAccountSection(ctx)}
        ${businessProfileSection(ctx, account)}
        ${postJobSection(
          ctx,
          account,
          repeatSourceFor(ctx, account.id, url.searchParams.get("repeat") ?? ""),
          findJobTemplate(url.searchParams.get("template")) ?? null,
        )}
        ${businessJobsSection(ctx, account)}
        ${coderAlertsSection(ctx, account)}
        ${rateDeliveriesSection(ctx, account)}
        ${engagementsSection(ctx, account)}`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/dashboard",
    title: "Dashboard",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
