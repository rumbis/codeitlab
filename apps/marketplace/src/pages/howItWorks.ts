import {
  ASSISTED_FEE_BPS,
  FEE_TIER_BPS,
  FEE_TIERS,
  payoutCents,
  platformFeeCents,
  type EngagementStatus,
} from "../shared/contracts.ts";
import type { AccountRow } from "../server/types.ts";
import type { AppContext } from "../server/context.ts";
import { escapeHtml } from "./escape.ts";
import { layout, pageUrl } from "./layout.ts";
import { money } from "./components.ts";

const DEFAULT_AMOUNT_EUROS = 1_000;
const MAX_AMOUNT_EUROS = 1_000_000;

/** The order a normal engagement moves in; the two exits are listed apart. */
const ESCROW_PATH: ReadonlyArray<{
  readonly status: EngagementStatus;
  readonly actor: "business" | "coder" | "platform";
  readonly line: string;
}> = [
  {
    status: "requested",
    actor: "business",
    line: "The business picks a coder and an amount. That is the moment the money is charged and held — not when the work is delivered.",
  },
  {
    status: "accepted",
    actor: "coder",
    line: "The coder accepts. The amount, fee and payout are already fixed, so nobody can renegotiate after seeing the work.",
  },
  {
    status: "in_progress",
    actor: "coder",
    line: "Work happens off-platform, however the two sides like. The marketplace only tracks whose turn it is.",
  },
  {
    status: "delivered",
    actor: "coder",
    line: "The coder marks it delivered with a note and up to five proof links. A status flag without evidence is not a delivery.",
  },
  {
    status: "approved",
    actor: "business",
    line: "The business reads the evidence and approves. The platform fee and the payout are written to one append-only ledger.",
  },
  {
    status: "paid_out",
    actor: "platform",
    line: "The payout goes to the coder's connected account. The business sees a receipt, the coder sees what arrived and what the fee was.",
  },
];

const ACTOR_LABELS: Readonly<Record<"business" | "coder" | "platform", string>> = {
  business: "Business",
  coder: "Coder",
  platform: "Platform",
};

function parseAmountEuros(url: URL): { euros: number; clamped: boolean; raw: string } {
  const raw = url.searchParams.get("amount") ?? "";
  if (raw.trim() === "") return { euros: DEFAULT_AMOUNT_EUROS, clamped: false, raw };
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return { euros: DEFAULT_AMOUNT_EUROS, clamped: true, raw };
  }
  const euros = Math.min(Math.max(Math.round(value), 1), MAX_AMOUNT_EUROS);
  return { euros, clamped: euros !== Math.round(value), raw };
}

function feeRow(amountCents: number, tier: "standard" | "assisted"): string {
  const bps = FEE_TIER_BPS[tier];
  const fee = platformFeeCents(amountCents, bps);
  const payout = payoutCents(amountCents, bps);
  return `<tr>
    <td>${escapeHtml(tier === "standard" ? "Standard" : "Assisted")}</td>
    <td>${escapeHtml(String(bps / 100))}%</td>
    <td>${escapeHtml(money(fee, "EUR"))}</td>
    <td><strong>${escapeHtml(money(payout, "EUR"))}</strong></td>
  </tr>`;
}

export function renderHowItWorks(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const amount = parseAmountEuros(url);
  const amountCents = amount.euros * 100;
  const action = escapeHtml(pageUrl(ctx.basePath, "/how-it-works"));

  const pathRows = ESCROW_PATH.map(
    (step, index) => `<li class="card">
      <div class="card-head">
        <h3>${escapeHtml(String(index + 1))}. ${escapeHtml(step.status.replace("_", " "))}</h3>
        <span class="badge badge-requested">${escapeHtml(ACTOR_LABELS[step.actor])} acts</span>
      </div>
      <p>${escapeHtml(step.line)}</p>
    </li>`,
  ).join("");

  return layout({
    basePath: ctx.basePath,
    title: "How it works",
    account,
    currentPath: "/how-it-works",
    description:
      "Escrow, fees and evidence in two minutes: how CodeItLab holds money, what the platform takes, and what happens when work goes wrong.",
    content: `<section class="stack">
      <p class="eyebrow">Two minutes, no jargon</p>
      <h1>How the money and the trust actually work</h1>
      <p class="lead">The business does not pay the coder directly, and the coder does not start on a promise. The platform holds the money in escrow, records every movement in one ledger, and takes its fee only when the work is approved.</p>
    </section>

    <section class="stack" id="escrow">
      <h2>The escrow path</h2>
      <p class="muted">Six states. At each one, exactly one side has to act next — that is why nothing waits in the dark.</p>
      <ol class="plain-list">${pathRows}</ol>
      <div class="card">
        <div class="card-head"><h3>The two exits</h3><span class="badge badge-disputed">Before approval only</span></div>
        <p><strong>Cancelled</strong> — either side can cancel before delivery; the full amount goes back to the business and the coder is told immediately.</p>
        <p><strong>Disputed</strong> — if the delivery is not what was agreed, either side raises a dispute. The money stays in escrow while an operator reads the evidence and decides one of two outcomes: <strong>refunded</strong> to the business, or <strong>released</strong> to the coder. Both sides get the decision and the reason.</p>
        ${
          ctx.autoReleaseDays > 0
            ? `<p><strong>Auto-released</strong> — a delivered engagement that waits <strong>${escapeHtml(String(ctx.autoReleaseDays))} days</strong> with no approval and no dispute is paid out to the coder automatically, through the same approval path and the same ledger. The money was already in escrow; a business that runs out of time cannot leave the person who did the work unpaid.</p>`
            : `<p><strong>Auto-release is off on this deployment</strong> — a delivered engagement waits for the business to approve or dispute. The waiting-delivery reminders still nudge them.</p>`
        }
      </div>
    </section>

    <section class="stack" id="fees">
      <h2>What the platform takes</h2>
      <p>Posting a job is free. The fee is a share of the agreed amount and is only recorded when the business approves the delivery. There is no fee on a refund, no fee on a cancellation, and no per-seat or per-message charge.</p>
      <form class="inline-form" method="get" action="${action}">
        <label class="field">
          <span>Try an amount (EUR)</span>
          <input type="number" name="amount" min="1" max="${MAX_AMOUNT_EUROS}" step="1" value="${escapeHtml(String(amount.euros))}" inputmode="numeric">
        </label>
        <button class="button button-secondary" type="submit">Show the split</button>
      </form>
      ${amount.clamped ? `<p class="hint">“${escapeHtml(amount.raw)}” is not a usable amount; showing ${escapeHtml(money(amountCents, "EUR"))} instead.</p>` : ""}
      <table class="table">
        <thead><tr><th>Tier</th><th>Platform fee</th><th>Fee on ${escapeHtml(money(amountCents, "EUR"))}</th><th>Coder receives</th></tr></thead>
        <tbody>${FEE_TIERS.map((tier) => feeRow(amountCents, tier)).join("")}</tbody>
      </table>
      <p class="muted">Standard is ${escapeHtml(String(FEE_TIER_BPS.standard / 100))}% for work a business runs itself. Assisted is ${escapeHtml(String(ASSISTED_FEE_BPS / 100))}% when the platform helps scope, match and review. Both numbers are stored per engagement as <code>fee_bps</code>, so an old engagement keeps the fee it was agreed under even if the tiers change.</p>
    </section>

    <section class="stack" id="evidence">
      <h2>Evidence is the product</h2>
      <p>Every delivery carries a note and up to five links — a repo, a deploy, a recording, a document. The approval button releases money, so the evidence is what a business checks before pressing it. The same evidence builds the coder's reputation: paid deliveries with proof are what move a profile from New to Proven, Trusted and Expert.</p>
      <p>Reputation cannot be claimed, bought or reset: it is derived from engagements that actually paid out. That is the point — a business with no time can look at one number and know it came from work that happened.</p>
    </section>

    <section class="stack" id="never">
      <h2>What we never do</h2>
      <ul>
        <li>No hidden fee at payout: the fee and the payout are written in the same transaction and shown on the receipt.</li>
        <li>No silent edits: an engagement moves through explicit states, and an admin action is recorded in an append-only audit log.</li>
        <li>${
          ctx.autoReleaseDays > 0
            ? `No surprise release: the business approves the delivery, and an operator resolves a dispute. If a delivery is left unanswered past the stated window, escrow auto-releases on the date shown on the engagement — never earlier, never invisibly.`
            : `No surprise release: the business approves the delivery, and an operator resolves a dispute. Auto-release is off on this deployment, so nothing moves without a human.`
        }</li>
        <li>No reselling your data: the marketplace has no trackers, no third-party scripts and no ad pixels.</li>
      </ul>
    </section>

    <section class="stack" id="ai">
      <h2>Where AI is — and is not</h2>
      <p><strong>AI is not the judge here.</strong> The coder ranking is arithmetic: skill overlap, declared interest, evidence, availability, rate fit, profile completeness and reputation, with weights you can read, and every recommendation shows the reasons behind its score. A model does not decide who is good.</p>
      <p><strong>No model approves a delivery, sets a fee or moves money.</strong> Approval is a human click, a dispute is read by a person, and every movement is a ledger row you can export. That is the point of the escrow: the frightening part of “AI will judge my work” is replaced by a decision a human made and a record you can check.</p>
      <p><strong>Where AI does help:</strong> CodeItLab can help draft a brief or scope an assisted job — that is what the assisted tier is for, and it says so on the job. If a tool was part of the work, the delivery evidence is where it shows.</p>
    </section>

    <section class="stack">
      <h2>Start with one small job</h2>
      <p>Pick a task you can describe in three sentences. Fund it. Judge the delivery on evidence. The first engagement is where the fear of “AI will do it badly” turns into a decision you can check.</p>
      <p class="actions">
        <a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/join?role=business"))}">Post a job</a>
        <a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/coders"))}">Browse coders</a>
        ${account === null ? "" : `<a class="button button-ghost" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">My quest board</a>`}
      </p>
    </section>`,
  });
}
