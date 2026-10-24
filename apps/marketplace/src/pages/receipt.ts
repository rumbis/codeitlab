import type { Engagement, LedgerEntry } from "../shared/contracts.ts";
import type { AppContext } from "../server/context.ts";
import type { AccountRow } from "../server/types.ts";
import { engagementStatusLabel, money, statusBadge } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { layout, pageUrl } from "./layout.ts";

const LEDGER_KIND_LABELS: Readonly<Record<string, string>> = {
  charge: "Escrow charge",
  platform_fee: "Platform fee",
  payout: "Payout to coder",
  refund: "Refund to business",
};

function ledgerRows(ledger: readonly LedgerEntry[]): string {
  if (ledger.length === 0) {
    return `<p class="muted">No money has moved for this engagement yet.</p>`;
  }
  return `<table class="table">
    <thead><tr><th>When</th><th>What</th><th>Amount</th><th>Note</th></tr></thead>
    <tbody>${ledger
      .map(
        (entry) => `<tr>
          <td>${escapeHtml(entry.createdAt.slice(0, 10))}</td>
          <td>${escapeHtml(LEDGER_KIND_LABELS[entry.kind] ?? entry.kind)}</td>
          <td>${escapeHtml(money(entry.amountCents, entry.currency))}</td>
          <td>${escapeHtml(entry.note)}</td>
        </tr>`,
      )
      .join("")}</tbody>
  </table>`;
}

/**
 * A printable record of one engagement, for the people who actually paid and
 * were paid. It is deliberately not an invoice: the platform is not the seller
 * of the work, it holds the money and records the movement, and the accountant
 * pairs this with the operator's ledger CSV.
 */
export function renderReceipt(options: {
  readonly ctx: AppContext;
  readonly account: AccountRow;
  readonly engagement: Engagement;
  readonly jobTitle: string;
  readonly businessName: string;
  readonly coderName: string;
  readonly ledger: readonly LedgerEntry[];
}): string {
  const { ctx, account, engagement, ledger } = options;
  const date = (engagement.updatedAt || engagement.createdAt).slice(0, 10);

  const content = `<section class="stack narrow receipt">
    <p class="eyebrow">Payment record</p>
    <h1>Receipt</h1>
    <p class="lead">A record of the money the platform held and released for one engagement. It is not a tax invoice — the platform is not the seller of the work — and it pairs with the operator's ledger export for your accountant.</p>

    <div class="card">
      <dl class="money-list">
        <div><dt>Receipt</dt><dd>${escapeHtml(engagement.id)}</dd></div>
        <div><dt>Date</dt><dd>${escapeHtml(date)}</dd></div>
        <div><dt>Job</dt><dd>${escapeHtml(options.jobTitle)}</dd></div>
        <div><dt>Status</dt><dd>${statusBadge(engagement.status)} ${escapeHtml(engagementStatusLabel(engagement.status))}</dd></div>
      </dl>
    </div>

    <div class="card">
      <h2>Parties</h2>
      <p><strong>Business:</strong> ${escapeHtml(options.businessName)}</p>
      <p><strong>Coder:</strong> ${escapeHtml(options.coderName)}</p>
      <p class="meta">Issued to ${escapeHtml(account.email)}.</p>
    </div>

    <div class="card">
      <h2>Money</h2>
      <dl class="money-list">
        <div><dt>Amount held in escrow</dt><dd>${escapeHtml(money(engagement.amountCents, engagement.currency))}</dd></div>
        <div><dt>Platform fee (${escapeHtml(String(engagement.feeBps / 100))}%)</dt><dd>${escapeHtml(money(engagement.feeCents, engagement.currency))}</dd></div>
        <div><dt>Coder payout</dt><dd>${escapeHtml(money(engagement.payoutCents, engagement.currency))}</dd></div>
      </dl>
      <p class="meta">Payment reference: ${escapeHtml(engagement.paymentRef === "" ? "—" : engagement.paymentRef)}</p>
    </div>

    <div class="card">
      <h2>Ledger</h2>
      ${ledgerRows(ledger)}
    </div>

    <p class="hint">Use your browser's print dialog to keep a PDF copy. The amounts above come from the append-only ledger, not from a template.</p>
    <p><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, "/dashboard"))}">Back to the dashboard</a></p>
  </section>`;

  return layout({
    basePath: ctx.basePath,
    baseUrl: ctx.baseUrl,
    title: `Receipt ${engagement.id.slice(0, 8)}`,
    account,
    content,
    currentPath: "/dashboard",
  });
}
