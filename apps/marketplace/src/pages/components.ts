import {
  AVAILABILITY_LABELS,
  JOB_CATEGORY_LABELS,
  formatCents,
  type CoderProfile,
  type EngagementStatus,
  type Job,
  type MatchReason,
} from "../shared/contracts.ts";
import type { Reputation } from "../server/reputation.ts";
import { escapeHtml } from "./escape.ts";
import { pageUrl } from "./layout.ts";

export function money(cents: number, currency: string): string {
  return formatCents(cents, currency);
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

export function skillChips(skills: readonly string[]): string {
  if (skills.length === 0) return `<span class="muted">No skills listed</span>`;
  return skills.map((skill) => `<span class="chip">${escapeHtml(skill)}</span>`).join(" ");
}

const STATUS_LABELS: Readonly<Record<EngagementStatus, string>> = {
  requested: "Requested",
  accepted: "Accepted",
  in_progress: "In progress",
  delivered: "Delivered",
  approved: "Approved",
  paid_out: "Paid out",
  cancelled: "Cancelled",
  disputed: "Disputed",
};

export function engagementStatusLabel(status: EngagementStatus): string {
  return STATUS_LABELS[status];
}

export function statusBadge(status: EngagementStatus): string {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status])}</span>`;
}

export function jobStatusBadge(status: Job["status"]): string {
  return `<span class="badge badge-${escapeHtml(status)}">${escapeHtml(status)}</span>`;
}

export function emptyState(title: string, body: string): string {
  return `<div class="empty-state"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p></div>`;
}

export function jobCard(basePath: string, job: Job): string {
  return `<article class="card job-card">
    <div class="card-head">
      <h3><a href="${escapeHtml(pageUrl(basePath, `/jobs/${job.id}`))}">${escapeHtml(job.title)}</a></h3>
      ${jobStatusBadge(job.status)}
    </div>
    <p class="meta">${escapeHtml(money(job.budgetMinCents, job.currency))}–${escapeHtml(money(job.budgetMaxCents, job.currency))} · ${escapeHtml(job.timeline)} · ${escapeHtml(JOB_CATEGORY_LABELS[job.category])} · posted ${escapeHtml(shortDate(job.createdAt))}</p>
    <p class="clamp">${escapeHtml(job.description)}</p>
    <p class="chips">${skillChips(job.skills)}</p>
  </article>`;
}

export function coderCard(
  basePath: string,
  coder: CoderProfile,
  reputation?: Reputation,
  rating?: { readonly count: number; readonly average: number },
): string {
  const links = Object.entries(coder.links)
    .map(
      ([label, href]) =>
        `<a class="link" href="${escapeHtml(href)}" rel="nofollow ugc noopener" target="_blank">${escapeHtml(label)}</a>`,
    )
    .join(" ");
  return `<article class="card coder-card">
    <div class="card-head">
      <h3><a href="${escapeHtml(pageUrl(basePath, `/coders/${coder.id}`))}">${escapeHtml(coder.displayName)}</a></h3>
      <span class="rate">${escapeHtml(money(coder.rateMinCents, coder.currency))}–${escapeHtml(money(coder.rateMaxCents, coder.currency))}</span>
    </div>
    <p class="headline">${escapeHtml(coder.headline)}</p>
    <p class="meta">${escapeHtml(AVAILABILITY_LABELS[coder.availability])} · ${escapeHtml(coder.timezone)}</p>
    ${
      reputation === undefined
        ? ""
        : `<p class="meta reputation-line"><span class="badge badge-open">${escapeHtml(reputation.levelLabel)}</span> ${escapeHtml(String(reputation.completedEngagements))} paid ${reputation.completedEngagements === 1 ? "delivery" : "deliveries"}${reputation.earnedCents === 0 ? "" : ` · ${escapeHtml(money(reputation.earnedCents, reputation.currency))} earned`}${reputation.evidenceDeliveries === 0 ? "" : ` · ${escapeHtml(String(reputation.evidenceDeliveries))} with evidence`}</p>`
    }
    ${
      rating === undefined || rating.count === 0
        ? ""
        : `<p class="meta rating-line"><span class="badge badge-open">★ ${escapeHtml(rating.average.toFixed(1))}</span> from ${escapeHtml(String(rating.count))} ${rating.count === 1 ? "rating" : "ratings"}</p>`
    }
    <p class="clamp">${escapeHtml(coder.bio)}</p>
    <p class="chips">${skillChips(coder.skills)}</p>
    ${coder.interests.length === 0 ? "" : `<p class="meta">Wants work in: ${escapeHtml(coder.interests.join(", "))}</p>`}
    ${links === "" ? "" : `<p class="links">${links}</p>`}
    ${coder.evidence.length === 0 ? "" : `<p class="links">${coder.evidence.map((href) => `<a class="link" href="${escapeHtml(href)}" rel="nofollow ugc noopener" target="_blank">evidence</a>`).join(" ")}</p>`}
  </article>`;
}

export function matchReasons(reasons: readonly MatchReason[]): string {
  return `<ul class="reasons">${reasons
    .map(
      (reason) =>
        `<li class="reason reason-${escapeHtml(reason.kind)}"><span class="reason-kind">${escapeHtml(reason.kind)}</span> ${escapeHtml(reason.detail)}</li>`,
    )
    .join("")}</ul>`;
}

export interface FieldOptions {
  readonly name: string;
  readonly label: string;
  readonly value?: string | number;
  readonly type?: "text" | "email" | "number" | "url" | "password";
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly autocomplete?: string;
}

export function field(options: FieldOptions): string {
  const type = options.type ?? "text";
  const attributes = [
    `type="${escapeHtml(type)}"`,
    `name="${escapeHtml(options.name)}"`,
    `id="field-${escapeHtml(options.name)}"`,
    options.value === undefined ? "" : `value="${escapeHtml(options.value)}"`,
    options.required === true ? "required" : "",
    options.min === undefined ? "" : `min="${escapeHtml(options.min)}"`,
    options.max === undefined ? "" : `max="${escapeHtml(options.max)}"`,
    options.step === undefined ? "" : `step="${escapeHtml(options.step)}"`,
    options.placeholder === undefined ? "" : `placeholder="${escapeHtml(options.placeholder)}"`,
    options.autocomplete === undefined ? "" : `autocomplete="${escapeHtml(options.autocomplete)}"`,
  ]
    .filter((attribute) => attribute !== "")
    .join(" ");
  return `<p class="field">
    <label for="field-${escapeHtml(options.name)}">${escapeHtml(options.label)}</label>
    <input ${attributes}>
    ${options.hint === undefined ? "" : `<span class="hint">${escapeHtml(options.hint)}</span>`}
  </p>`;
}

export function textareaField(options: {
  readonly name: string;
  readonly label: string;
  readonly value?: string;
  readonly rows?: number;
  readonly required?: boolean;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly maxlength?: number;
}): string {
  return `<p class="field">
    <label for="field-${escapeHtml(options.name)}">${escapeHtml(options.label)}</label>
    <textarea id="field-${escapeHtml(options.name)}" name="${escapeHtml(options.name)}" rows="${escapeHtml(options.rows ?? 5)}"${options.required === true ? " required" : ""}${options.placeholder === undefined ? "" : ` placeholder="${escapeHtml(options.placeholder)}"`}${options.maxlength === undefined ? "" : ` maxlength="${escapeHtml(options.maxlength)}"`}>${escapeHtml(options.value ?? "")}</textarea>
    ${options.hint === undefined ? "" : `<span class="hint">${escapeHtml(options.hint)}</span>`}
  </p>`;
}

export function selectField(options: {
  readonly name: string;
  readonly label: string;
  readonly value?: string;
  readonly choices: readonly { readonly value: string; readonly label: string }[];
  readonly hint?: string;
}): string {
  const choices = options.choices
    .map(
      (choice) =>
        `<option value="${escapeHtml(choice.value)}"${choice.value === options.value ? " selected" : ""}>${escapeHtml(choice.label)}</option>`,
    )
    .join("");
  return `<p class="field">
    <label for="field-${escapeHtml(options.name)}">${escapeHtml(options.label)}</label>
    <select id="field-${escapeHtml(options.name)}" name="${escapeHtml(options.name)}">${choices}</select>
    ${options.hint === undefined ? "" : `<span class="hint">${escapeHtml(options.hint)}</span>`}
  </p>`;
}
