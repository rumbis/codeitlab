import type { Engagement, LedgerEntry } from "../shared/contracts.ts";
import { escapeHtml } from "./escape.ts";
import { engagementStatusLabel, money, statusBadge } from "./components.ts";
import { pageUrl } from "./layout.ts";

export type EngagementViewer = "coder" | "business" | "observer";

interface ActionSpec {
  readonly action: string;
  readonly label: string;
  readonly variant: "primary" | "secondary" | "danger";
}

function availableActions(engagement: Engagement, viewer: EngagementViewer): ActionSpec[] {
  if (viewer === "observer") return [];
  const coder = viewer === "coder";
  const business = viewer === "business";
  const actions: ActionSpec[] = [];

  if (coder && engagement.status === "requested") {
    actions.push({ action: "accept", label: "Accept engagement", variant: "primary" });
  }
  if (coder && engagement.status === "accepted") {
    actions.push({ action: "start", label: "Start work", variant: "primary" });
  }
  if (business && engagement.status === "delivered") {
    actions.push({ action: "approve", label: "Approve and pay out", variant: "primary" });
  }
  if (["requested", "accepted", "in_progress"].includes(engagement.status)) {
    actions.push({ action: "cancel", label: "Cancel", variant: "danger" });
  }
  if (["accepted", "in_progress", "delivered"].includes(engagement.status)) {
    actions.push({ action: "dispute", label: "Raise a dispute", variant: "secondary" });
  }
  return actions;
}

function actionForm(
  basePath: string,
  engagementId: string,
  spec: ActionSpec,
  redirectTo: string,
): string {
  const buttonClass =
    spec.variant === "primary"
      ? "button"
      : spec.variant === "danger"
        ? "button button-danger"
        : "button button-secondary";
  return `<form class="inline-form" method="post" action="${escapeHtml(pageUrl(basePath, `/api/engagements/${engagementId}/${spec.action}`))}">
    <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}">
    <button class="${buttonClass}" type="submit">${escapeHtml(spec.label)}</button>
  </form>`;
}

/**
 * Delivering is the one transition that carries information, so it gets a form
 * instead of a button. The evidence field is the point: it turns "trust me" into
 * "check it", which is exactly what the business is being asked to do next.
 */
function deliveryForm(basePath: string, engagementId: string, redirectTo: string): string {
  const noteId = `delivery-note-${engagementId}`;
  const evidenceId = `delivery-evidence-${engagementId}`;
  return `<form class="form" method="post" action="${escapeHtml(pageUrl(basePath, `/api/engagements/${engagementId}/deliver`))}">
    <input type="hidden" name="redirectTo" value="${escapeHtml(redirectTo)}">
    <div class="field">
      <label for="${escapeHtml(noteId)}">What did you deliver?</label>
      <textarea id="${escapeHtml(noteId)}" name="deliveryNote" rows="3" maxlength="2000" placeholder="One or two lines: what is done, where it lives, how to check it."></textarea>
    </div>
    <div class="field">
      <label for="${escapeHtml(evidenceId)}">Evidence links (one per line)</label>
      <textarea id="${escapeHtml(evidenceId)}" name="deliveryEvidence" rows="3" placeholder="https://github.com/you/repo/pull/12&#10;https://staging.example.com"></textarea>
    </div>
    <p class="muted">Evidence is optional, but a delivery with proof is approved faster and builds your reputation.</p>
    <button class="button" type="submit">Mark delivered</button>
  </form>`;
}

function deliveryEvidenceSection(engagement: Engagement): string {
  if (
    engagement.status === "requested" ||
    engagement.status === "accepted" ||
    engagement.status === "in_progress"
  ) {
    return "";
  }
  const links = engagement.deliveryEvidence
    .map(
      (href) =>
        `<li><a href="${escapeHtml(href)}" rel="noopener noreferrer nofollow" target="_blank">${escapeHtml(href)}</a></li>`,
    )
    .join("");
  return `<section class="delivery-evidence" aria-labelledby="delivery-${escapeHtml(engagement.id)}">
    <h4 id="delivery-${escapeHtml(engagement.id)}">Delivery evidence</h4>
    ${
      engagement.deliveryNote === ""
        ? `<p class="muted">No note was attached to this delivery.</p>`
        : `<p>${escapeHtml(engagement.deliveryNote)}</p>`
    }
    ${
      links === ""
        ? `<p class="muted">No evidence links were attached.</p>`
        : `<ul class="evidence-list">${links}</ul>`
    }
    ${
      engagement.status === "delivered"
        ? `<p class="muted">Check the evidence before approving: approval releases the escrow to the coder.</p>`
        : ""
    }
  </section>`;
}

export function ledgerRows(ledger: readonly LedgerEntry[]): string {
  if (ledger.length === 0) return `<p class="muted">No ledger entries yet.</p>`;
  return `<div class="table-wrap"><table>
    <thead><tr><th scope="col">Entry</th><th scope="col">Amount</th><th scope="col">Note</th></tr></thead>
    <tbody>${ledger
      .map(
        (entry) =>
          `<tr><td>${escapeHtml(entry.kind.replace(/_/gu, " "))}</td><td class="numeric">${escapeHtml(money(entry.amountCents, entry.currency))}</td><td>${escapeHtml(entry.note)}</td></tr>`,
      )
      .join("")}</tbody>
  </table></div>`;
}

/** One sentence naming who acts next; the lesson sits exactly where the state is. */
function nextStep(engagement: Engagement): string {
  switch (engagement.status) {
    case "requested":
      return "Waiting for the coder to accept. The money is already in escrow.";
    case "accepted":
      return "Waiting for the coder to start. The money stays in escrow until approval.";
    case "in_progress":
      return "Waiting for the coder to mark the work delivered.";
    case "delivered":
      return "Waiting for the business to check the evidence and approve or dispute.";
    case "disputed":
      return "Waiting for an operator to read the evidence and resolve the dispute. The money stays in escrow.";
    case "approved":
    case "paid_out":
      return "Done: the fee and payout are in the ledger and cannot change.";
    case "cancelled":
      return "Done: the escrow was refunded to the business.";
    default:
      return "";
  }
}

function autoReleaseLine(engagement: Engagement, days: number | undefined): string {
  if (engagement.status !== "delivered" || days === undefined || days <= 0) return "";
  const releaseAt = new Date(new Date(engagement.updatedAt).getTime() + days * 24 * 60 * 60_000);
  if (Number.isNaN(releaseAt.getTime())) return "";
  return `<p class="meta auto-release">If the business does not approve or dispute by <strong>${escapeHtml(releaseAt.toISOString().slice(0, 10))}</strong>, the escrow releases to the coder automatically (${escapeHtml(money(engagement.payoutCents, engagement.currency))}).</p>`;
}

export function engagementPanel(options: {
  readonly basePath: string;
  readonly engagement: Engagement;
  readonly viewer: EngagementViewer;
  readonly redirectTo: string;
  readonly ledger: readonly LedgerEntry[];
  readonly jobTitle?: string;
  /** The deployment's auto-release window, shown on delivered engagements. */
  readonly autoReleaseDays?: number;
}): string {
  const { basePath, engagement, viewer, redirectTo } = options;
  const actions = availableActions(engagement, viewer);
  const actionForms = actions
    .map((spec) => actionForm(basePath, engagement.id, spec, redirectTo))
    .join(" ");

  return `<section class="card engagement-card" id="engagement-${escapeHtml(engagement.id)}" aria-labelledby="engagement-${escapeHtml(engagement.id)}-title">
    <div class="card-head">
      <h3 id="engagement-${escapeHtml(engagement.id)}-title">Engagement ${escapeHtml(engagement.id.slice(0, 8))}</h3>
      ${statusBadge(engagement.status)}
    </div>
    ${options.jobTitle === undefined ? "" : `<p class="meta">Job: ${escapeHtml(options.jobTitle)}</p>`}
    <dl class="money-list">
      <div><dt>Amount held</dt><dd>${escapeHtml(money(engagement.amountCents, engagement.currency))}</dd></div>
      <div><dt>Platform fee (${escapeHtml(String(engagement.feeBps / 100))}%)</dt><dd>${escapeHtml(money(engagement.feeCents, engagement.currency))}</dd></div>
      <div><dt>Coder payout</dt><dd>${escapeHtml(money(engagement.payoutCents, engagement.currency))}</dd></div>
    </dl>
    <p class="meta">Status: ${escapeHtml(engagementStatusLabel(engagement.status))} · payment ref ${escapeHtml(engagement.paymentRef)}</p>
    <p class="meta next-step">${escapeHtml(nextStep(engagement))}</p>
    ${autoReleaseLine(engagement, options.autoReleaseDays)}
    ${
      engagement.resolutionOutcome === ""
        ? ""
        : `<p class="meta"><strong>Dispute resolved:</strong> ${
            engagement.resolutionOutcome === "refunded"
              ? "escrow refunded to the business"
              : "escrow released to the coder"
          } — ${escapeHtml(engagement.resolutionNote)}</p>`
    }
    ${deliveryEvidenceSection(engagement)}
    ${
      viewer === "coder" && engagement.status === "in_progress"
        ? deliveryForm(basePath, engagement.id, redirectTo)
        : ""
    }
    ${actionForms === "" ? "" : `<div class="actions">${actionForms}</div>`}
    <details class="ledger">
      <summary>Ledger (${escapeHtml(options.ledger.length)} entries)</summary>
      ${ledgerRows(options.ledger)}
    </details>
    ${
      viewer === "observer"
        ? ""
        : `<p class="meta"><a class="link" href="${escapeHtml(pageUrl(basePath, `/engagements/${engagement.id}/receipt`))}">Printable receipt</a></p>`
    }
  </section>`;
}
