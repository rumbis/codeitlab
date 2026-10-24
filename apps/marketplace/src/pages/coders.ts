import { AVAILABILITY_LABELS } from "../shared/contracts.ts";
import type { AppContext } from "../server/context.ts";
import { listApprovedCoders } from "../server/profiles.ts";
import { loadRatingSummaries } from "../server/ratings.ts";
import { loadReputationSummaries, reputationFrom } from "../server/reputation.ts";
import type { AccountRow } from "../server/types.ts";
import { coderCard, emptyState, money, selectField } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { flashFrom, layout, pageUrl } from "./layout.ts";

const LEVEL_RANK = { new: 0, proven: 1, trusted: 2, expert: 3 } as const;

function parseList(url: URL, name: string): string[] {
  return (url.searchParams.get(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value !== "");
}

export function renderCoders(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const skills = parseList(url, "skills");
  const interests = parseList(url, "interest");
  const sort = url.searchParams.get("sort") === "reputation" ? "reputation" : "newest";
  const rawAvailability = url.searchParams.get("availability") ?? "";
  const availability =
    rawAvailability !== "" && rawAvailability in AVAILABILITY_LABELS ? rawAvailability : "";
  const rawMaxRate = Number(url.searchParams.get("maxRate") ?? "");
  const maxRateCents =
    Number.isFinite(rawMaxRate) && rawMaxRate > 0 ? Math.round(rawMaxRate * 100) : undefined;
  const coders = listApprovedCoders(ctx, {
    skills,
    interests,
    ...(availability === "" ? {} : { availability }),
    ...(maxRateCents === undefined ? {} : { maxRateCents }),
    limit: 100,
  });
  const reputations = loadReputationSummaries(
    ctx,
    coders.map((coder) => coder.id),
  );
  const ratings = loadRatingSummaries(
    ctx,
    coders.map((coder) => coder.id),
  );
  const reputationOf = (coder: (typeof coders)[number]) => {
    const summary = reputations.get(coder.id);
    return summary === undefined ? undefined : reputationFrom(summary, coder.currency);
  };
  // Sorting by reputation is opt-in: "newest" stays the default so new coders
  // are not buried, and the reputation order is derived from paid work only.
  const ordered =
    sort === "reputation"
      ? [...coders].sort((left, right) => {
          const leftReputation = reputationOf(left);
          const rightReputation = reputationOf(right);
          const levelDelta =
            LEVEL_RANK[rightReputation?.level ?? "new"] -
            LEVEL_RANK[leftReputation?.level ?? "new"];
          if (levelDelta !== 0) return levelDelta;
          const deliveriesDelta =
            (rightReputation?.completedEngagements ?? 0) -
            (leftReputation?.completedEngagements ?? 0);
          if (deliveriesDelta !== 0) return deliveriesDelta;
          return left.createdAt < right.createdAt ? -1 : left.createdAt > right.createdAt ? 1 : 0;
        })
      : coders;
  const flash = flashFrom(url);
  const filtered =
    skills.length > 0 ||
    interests.length > 0 ||
    availability !== "" ||
    maxRateCents !== undefined ||
    sort !== "newest";

  const results =
    coders.length === 0
      ? emptyState(
          "No coders match that filter",
          filtered
            ? "Try fewer filters, or browse all coders."
            : "Approved coder profiles will appear here as they are reviewed.",
        )
      : `<div class="grid cols-2">${ordered
          .map((coder) =>
            coderCard(ctx.basePath, coder, reputationOf(coder), ratings.get(coder.id)),
          )
          .join("")}</div>`;

  const content = `<section class="stack">
    <p class="eyebrow">Coder directory</p>
    <h1>Approved coders</h1>
    <p class="lead">Every profile below has been reviewed. Rates are the coder's own range; the engagement amount is agreed per job.</p>
    <form class="filter-form" method="get" action="${escapeHtml(pageUrl(ctx.basePath, "/coders"))}">
      <p class="field">
        <label for="skills-filter">Filter by skills</label>
        <input id="skills-filter" name="skills" type="text" value="${escapeHtml(skills.join(", "))}" placeholder="React, Node.js">
        <span class="hint">Comma separated. A coder must have every skill you list.</span>
      </p>
      <p class="field">
        <label for="interest-filter">Filter by declared interest</label>
        <input id="interest-filter" name="interest" type="text" value="${escapeHtml(interests.join(", "))}" placeholder="video, web, ai">
        <span class="hint">The domain a coder says they want to work in. Any match counts — a coder who declared “video” appears for “video, animation”.</span>
      </p>
      ${selectField({
        name: "availability",
        label: "Availability",
        value: availability,
        choices: [
          { value: "", label: "Any availability" },
          ...Object.entries(AVAILABILITY_LABELS).map(([value, label]) => ({ value, label })),
        ],
        hint: "Self-declared. “Not available” coders are still listed here, but they are ranked last in job matches.",
      })}
      <p class="field">
        <label for="max-rate-filter">Maximum starting rate (EUR)</label>
        <input id="max-rate-filter" name="maxRate" type="number" min="1" step="1" value="${maxRateCents === undefined ? "" : escapeHtml(String(maxRateCents / 100))}" placeholder="100" inputmode="numeric">
        <span class="hint">Filters on the coder's own minimum rate, not on the agreed amount.</span>
      </p>
      ${selectField({
        name: "sort",
        label: "Order",
        value: sort,
        choices: [
          { value: "newest", label: "Newest profiles first" },
          { value: "reputation", label: "Proven work first (derived reputation)" },
        ],
        hint: "Proven work first sorts by the reputation derived from paid deliveries; new coders are not hidden, just later.",
      })}
      <button class="button" type="submit">Filter</button>
      ${filtered ? `<a class="button button-ghost" href="${escapeHtml(pageUrl(ctx.basePath, "/coders"))}">Clear</a>` : ""}
    </form>
    <p class="meta">${escapeHtml(ordered.length)} coder${ordered.length === 1 ? "" : "s"} shown${sort === "reputation" ? " · proven work first" : ""}${availability === "" ? "" : ` · ${escapeHtml(AVAILABILITY_LABELS[availability as keyof typeof AVAILABILITY_LABELS])}`}${maxRateCents === undefined ? "" : ` · starting under ${escapeHtml(money(maxRateCents, "EUR"))}`}</p>
    ${results}
    ${account === null ? `<p><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=business"))}">Post a job</a> to hire one of them.</p>` : ""}
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/coders",
    title: "Approved coders",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
