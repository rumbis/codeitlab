import type { AppContext } from "../server/context.ts";
import { impactNumbers } from "../server/impact.ts";
import type { AccountRow } from "../server/types.ts";
import { money } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { flashFrom, layout, pageUrl } from "./layout.ts";

function amount(cents: number, currency: string): string {
  return currency === "MIXED"
    ? `${(cents / 100).toFixed(2)} (mixed currencies)`
    : money(cents, currency);
}

function stat(label: string, value: string, hint: string): string {
  return `<div class="stat">
    <span class="stat-label">${escapeHtml(label)}</span>
    <span class="stat-value">${escapeHtml(value)}</span>
    <span class="stat-hint">${escapeHtml(hint)}</span>
  </div>`;
}

/**
 * The transparency page. A marketplace that takes 15–20% should be able to show
 * where the money went without a marketing team in between.
 */
export function renderNumbers(ctx: AppContext, account: AccountRow | null, url: URL): string {
  const flash = flashFrom(url);
  const n = impactNumbers(ctx);
  const average = n.averagePayoutHours === null ? "—" : `${n.averagePayoutHours.toFixed(1)} h`;

  const content = `<section class="stack">
    <p class="eyebrow">Public numbers</p>
    <h1>The numbers, straight from the ledger</h1>
    <p class="lead">Every figure below is a SUM over the same ledger rows that move money through escrow. No tracking, no estimates, no rounding up. Run the reconcile endpoint and the totals must agree.</p>

    <div class="stats">
      ${stat("Paid to coders", amount(n.paidToCodersCents, n.currency), "Payouts released after approval")}
      ${stat("Platform fees", amount(n.platformFeesCents, n.currency), "15% standard, 20% assisted")}
      ${stat("Currently in escrow", amount(n.heldCents, n.currency), "Charged but not yet paid out or refunded")}
      ${stat("Completed engagements", String(n.completedEngagements), "Work approved and paid")}
      ${stat("Coders paid", String(n.codersPaid), "Distinct people who received money")}
      ${stat("Businesses served", String(n.businessesServed), "Distinct businesses that paid for work")}
      ${stat("Average time to payout", average, "From engagement start to payout")}
      ${stat("Disputes resolved", String(n.disputesResolved), "Each one audited")}
      ${stat("Refunds issued", amount(n.refundedCents, n.currency), "Escrow returned to the business")}
    </div>

    <section class="card">
      <h2>What we charge, and what we do not</h2>
      <ul class="plain-list">
        <li><strong>15% standard fee</strong> — the fee comes out of the amount the business funds: on €1,000 the coder receives €850 and the platform keeps €150. The business never pays more than the amount it agreed.</li>
        <li><strong>20% assisted fee</strong> — the same rule at 20%, for jobs where an operator scopes the work, shortlists coders and reviews the delivery.</li>
        <li><strong>0% to post a job</strong>, 0% to apply, 0% to be invited.</li>
        <li><strong>Refunds are full</strong> — if escrow is refunded before approval, no fee was ever taken, so the business gets the whole amount back.</li>
        <li>Fees are recorded only when the business approves a delivery; nothing is taken from a promise.</li>
      </ul>
      <p class="meta">The fee is what pays for escrow, disputes, the operator queue and the abuse reports — a person reads every report. Try it on your own amount with the <a href="${escapeHtml(pageUrl(ctx.basePath, "/how-it-works"))}#fees">fee calculator</a>.</p>
    </section>

    <section class="card">
      <h2>Why publish this</h2>
      <p>Trust is easier to check than to promise. If the numbers on this page ever stop matching the ledger, the ledger wins — and the reconcile endpoint is public to operators. The point of taking a fee is to keep the escrow honest, not to hide it.</p>
      <p class="meta">${escapeHtml(String(n.reportsResolved))} abuse reports resolved · ${escapeHtml(String(n.refundedEngagements))} engagements refunded · ${escapeHtml(String(n.activeEngagements))} active right now</p>
    </section>

    <p><a class="button" href="${escapeHtml(pageUrl(ctx.basePath, "/jobs"))}">Browse open jobs</a> <a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/how-it-works"))}">How it works</a></p>
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    canonicalPath: "/numbers",
    title: "Public numbers",
    description:
      "What CodeitLab paid coders, what it charged, and what is held in escrow — computed from the ledger.",
    account,
    content,
    notice: flash.notice,
    error: flash.error,
  });
}
