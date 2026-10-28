import { AVAILABILITY_LABELS } from "../shared/contracts.ts";
import type { AppContext } from "../server/context.ts";
import { listRatingsForCoder, ratingSummaryForCoder } from "../server/ratings.ts";
import { reputationForCoder } from "../server/reputation.ts";
import type { AccountRow } from "../server/types.ts";
import type { CoderProfile } from "../shared/contracts.ts";
import { money, skillChips } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { flashFrom, layout, pageUrl } from "./layout.ts";

function skillLevelList(profile: CoderProfile): string {
  const entries = Object.entries(profile.skillLevels);
  if (entries.length === 0) return "";
  return `<p class="meta">Depth: ${entries
    .map(([skill, level]) => `${escapeHtml(skill)} ${escapeHtml(String(level))}/5`)
    .join(" · ")}</p>`;
}

/**
 * The public profile a directory card and a match card point at. Everything on it
 * is derived from real engagements — paid deliveries, evidence links and ratings
 * written after payout — so a stranger can judge the work without trusting a
 * bio. It is also the page a coder can send to a client.
 */
export function renderCoderProfile(
  ctx: AppContext,
  account: AccountRow | null,
  url: URL,
  profile: CoderProfile,
): string {
  const flash = flashFrom(url);
  const reputation = reputationForCoder(ctx, profile.id, profile.currency);
  const ratings = ratingSummaryForCoder(ctx, profile.id);
  const recentRatings = listRatingsForCoder(ctx, profile.id, 5);
  const isOwner = account !== null && account.id === profile.accountId;

  const links = Object.entries(profile.links)
    .map(
      ([label, href]) =>
        `<a class="link" href="${escapeHtml(href)}" rel="nofollow ugc noopener" target="_blank">${escapeHtml(label)}</a>`,
    )
    .join(" ");
  const evidence = profile.evidence
    .map(
      (href) =>
        `<li><a class="link" href="${escapeHtml(href)}" rel="nofollow ugc noopener" target="_blank">${escapeHtml(href)}</a></li>`,
    )
    .join("");

  const badges = reputation.badges
    .map(
      (badge) => `<li class="reputation-badge ${badge.earned ? "is-earned" : ""}">
        <span class="badge ${badge.earned ? "badge-open" : "badge-requested"}">${badge.earned ? "Earned" : "Not yet"}</span>
        <strong>${escapeHtml(badge.label)}</strong>
        <span class="meta">${escapeHtml(badge.lesson)}</span>
      </li>`,
    )
    .join("");

  const ratingsList =
    recentRatings.length === 0
      ? `<p class="muted">No ratings yet. Ratings are written by the business only after the payout, so an empty list means no paid delivery has been rated.</p>`
      : `<ul class="plain-list">${recentRatings
          .map(
            (rating) => `<li class="card">
              <div class="card-head"><h3>★ ${escapeHtml(String(rating.score))}/5</h3><span class="meta">${escapeHtml(rating.createdAt.slice(0, 10))}</span></div>
              ${rating.comment === "" ? `<p class="muted">No comment left.</p>` : `<blockquote class="quote">${escapeHtml(rating.comment)}</blockquote>`}
            </li>`,
          )
          .join("")}</ul>`;

  const cta =
    account === null
      ? `<p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=business"))}">Post a job</a> <a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/login"))}">Log in</a></p>`
      : account.role === "business"
        ? `<p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Post a job and invite them</a></p>`
        : isOwner
          ? `<p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Edit your profile</a></p>`
          : "";

  const content = `<section class="stack narrow">
    <p class="eyebrow"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/coders"))}">Coders</a> / profile</p>
    ${profile.approved ? "" : `<p class="meta"><span class="badge badge-requested">Pending review</span> This profile is not listed in the directory yet.</p>`}
    <div class="card-head">
      <h1>${escapeHtml(profile.displayName)}</h1>
      <span class="badge badge-open">${escapeHtml(reputation.levelLabel)}</span>
    </div>
    <p class="headline">${escapeHtml(profile.headline)}</p>
    <p class="meta">${escapeHtml(AVAILABILITY_LABELS[profile.availability])} · ${escapeHtml(profile.timezone)} · ${escapeHtml(money(profile.rateMinCents, profile.currency))}–${escapeHtml(money(profile.rateMaxCents, profile.currency))} · joined ${escapeHtml(profile.createdAt.slice(0, 10))}</p>
    <p class="chips">${skillChips(profile.skills)}</p>
    ${skillLevelList(profile)}
    ${profile.interests.length === 0 ? "" : `<p class="meta">Wants work in: ${escapeHtml(profile.interests.join(", "))}</p>`}
    <div class="prose">${escapeHtml(profile.bio)}</div>
    ${links === "" ? "" : `<p class="links">${links}</p>`}
    ${
      evidence === ""
        ? ""
        : `<section class="card"><h2>Evidence</h2><p class="meta">Proof attached by the coder: repos, case studies, recordings.</p><ul class="evidence-list">${evidence}</ul></section>`
    }

    <section class="card">
      <div class="section-head">
        <h2>Track record</h2>
        <span class="badge badge-open">${escapeHtml(reputation.levelLabel)}</span>
      </div>
      <p class="meta">${escapeHtml(String(reputation.completedEngagements))} paid ${reputation.completedEngagements === 1 ? "delivery" : "deliveries"}${reputation.evidenceDeliveries === 0 ? "" : ` · ${escapeHtml(String(reputation.evidenceDeliveries))} with evidence`}${reputation.repeatClients === 0 ? "" : ` · ${escapeHtml(String(reputation.repeatClients))} repeat ${reputation.repeatClients === 1 ? "client" : "clients"}`}${reputation.earnedCents === 0 ? "" : ` · ${escapeHtml(money(reputation.earnedCents, reputation.currency))} earned`}</p>
      <p class="meta">${escapeHtml(reputation.levelNote)}</p>
      <ul class="plain-list">${badges}</ul>
    </section>

    <section class="card">
      <div class="section-head">
        <h2>Ratings</h2>
        ${
          ratings.count === 0
            ? ""
            : `<span class="badge badge-open">★ ${escapeHtml(ratings.average.toFixed(1))} · ${escapeHtml(String(ratings.count))}</span>`
        }
      </div>
      <p class="meta">Written by the paying business after the payout. A score can never be used to negotiate a refund.</p>
      ${ratingsList}
    </section>

    ${account !== null && !isOwner ? `<p class="meta"><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/report?kind=coder&id=${profile.id}`))}">Report this profile</a></p>` : ""}
    <section class="card">
      <h2>Hire ${escapeHtml(profile.displayName)}</h2>
      <p>Money is held in escrow when the engagement starts and released only when you approve the delivery. Every step is written to a ledger you can read.</p>
      ${cta}
    </section>
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: `/coders/${profile.id}`,
    title: `${profile.displayName} — ${profile.headline}`,
    description: profile.bio.slice(0, 160),
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
