import type { AppContext } from "../server/context.ts";
import type { LedgerReport } from "../server/engagements.ts";
import { adminOverview, listAdminAudit, searchAccounts } from "../server/admin.ts";
import { eligibleForAutoRelease } from "../server/autoRelease.ts";
import { reconcileLedger } from "../server/reconcile.ts";
import { listAssistedDeliveries } from "../server/assisted.ts";
import { listAssistedJobs, MAX_SHORTLIST } from "../server/assistedJobs.ts";
import { rankCoders } from "../server/matching.ts";
import { listDisputedEngagements } from "../server/disputes.ts";
import { listPendingCoders } from "../server/profiles.ts";
import { listReports } from "../server/reports.ts";
import { waitingDeliveryCount } from "../server/reminders.ts";
import type { AccountRow } from "../server/types.ts";
import { emptyState, money } from "./components.ts";
import { escapeHtml } from "./escape.ts";
import { layout, pageUrl } from "./layout.ts";

export function renderAdminGate(ctx: AppContext, account: AccountRow | null): string {
  return layout({
    basePath: ctx.basePath,
    title: "Admin",
    account,
    content: `<section class="stack narrow">
      <h1>Admin</h1>
      <p class="lead">This page is guarded by MARKETPLACE_ADMIN_TOKEN.</p>
      <form class="card form" method="get" action="${escapeHtml(pageUrl(ctx.basePath, "/admin"))}">
        <p class="field">
          <label for="admin-token">Admin token</label>
          <input id="admin-token" name="token" type="password" required autocomplete="off">
        </p>
        <button class="button" type="submit">Open admin</button>
      </form>
    </section>`,
  });
}

function totalsCard(label: string, value: string, hint: string): string {
  return `<div class="stat">
    <span class="stat-label">${escapeHtml(label)}</span>
    <span class="stat-value">${escapeHtml(value)}</span>
    <span class="stat-hint">${escapeHtml(hint)}</span>
  </div>`;
}

export function renderAdmin(
  ctx: AppContext,
  account: AccountRow | null,
  report: LedgerReport,
  url: URL,
): string {
  const { totals, entries } = report;
  const overview = adminOverview(ctx);
  const pending = listPendingCoders(ctx);
  const disputes = listDisputedEngagements(ctx);
  const assisted = listAssistedDeliveries(ctx);
  const assistedJobs = listAssistedJobs(ctx);
  const audit = listAdminAudit(ctx, 20);
  const reconciliation = reconcileLedger(ctx);
  const autoReleaseEligible = eligibleForAutoRelease(ctx);
  const reports = listReports(ctx, { status: "open", limit: 50 });
  const adminPath = pageUrl(ctx.basePath, "/admin");
  const accountQuery = (url.searchParams.get("account") ?? "").trim();
  const accounts = searchAccounts(ctx, accountQuery);
  const accountsSection = `<form class="form inline" method="get" action="${escapeHtml(pageUrl(ctx.basePath, "/admin"))}">
      <div class="field">
        <label for="account-search">Find an account by email</label>
        <input id="account-search" name="account" type="search" value="${escapeHtml(accountQuery)}" placeholder="ada@example.com">
      </div>
      <button class="button button-secondary" type="submit">Search</button>
    </form>
    ${
      accountQuery === ""
        ? `<p class="muted">Search by email to suspend or restore one account. Nothing is listed until you search.</p>`
        : accounts.length === 0
          ? `<p class="muted">No account matches “${escapeHtml(accountQuery)}”.</p>`
          : `<ul class="plain-list">${accounts
              .map(
                (row) => `<li class="card">
                  <div class="card-head">
                    <h3>${escapeHtml(row.email)}</h3>
                    <span class="badge ${row.suspendedAt === null ? "badge-open" : "badge-disputed"}">${row.suspendedAt === null ? "Active" : "Suspended"}</span>
                  </div>
                  <p class="meta">${escapeHtml(row.role)} · joined ${escapeHtml(row.createdAt.slice(0, 10))} · ${escapeHtml(row.id)}</p>
                  ${
                    row.suspendedAt === null
                      ? `<form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/accounts/${row.id}/suspend`))}">
                          <input type="hidden" name="redirectTo" value="${escapeHtml(`${adminPath}&account=${encodeURIComponent(accountQuery)}`)}">
                          <div class="field">
                            <label for="reason-${escapeHtml(row.id)}">Reason (sent to the person)</label>
                            <input id="reason-${escapeHtml(row.id)}" name="reason" required minlength="3" maxlength="500" placeholder="Chargeback after delivery">
                          </div>
                          <button class="button button-danger" type="submit">Suspend</button>
                        </form>`
                      : `<p class="meta">Suspended ${escapeHtml((row.suspendedAt ?? "").slice(0, 10))}: ${escapeHtml(row.suspendedReason)}</p>
                        <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/accounts/${row.id}/unsuspend`))}">
                          <input type="hidden" name="redirectTo" value="${escapeHtml(`${adminPath}&account=${encodeURIComponent(accountQuery)}`)}">
                          <button class="button button-secondary" type="submit">Restore account</button>
                        </form>`
                  }
                </li>`,
              )
              .join("")}</ul>`
    }`;

  const reportsSection =
    reports.length === 0
      ? `<p class="muted">No open reports.</p>`
      : `<ul class="plain-list">${reports
          .map(
            (report) => `<li class="card">
              <div class="card-head">
                <h3>${escapeHtml(report.targetLabel)}</h3>
                <span class="badge badge-requested">${escapeHtml(report.targetKind === "job" ? "Job" : "Coder")}</span>
              </div>
              <p class="meta">Reported by ${escapeHtml(report.reporterEmail)} · ${escapeHtml(report.createdAt.slice(0, 10))} · ${escapeHtml(report.reasonLabel)}</p>
              ${report.detail === "" ? "" : `<blockquote class="quote">${escapeHtml(report.detail)}</blockquote>`}
              <div class="actions">
                <form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/reports/${report.id}/resolve`))}">
                  <input type="hidden" name="resolution" value="dismissed">
                  <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                  <button class="button button-secondary" type="submit">Dismiss</button>
                </form>
                ${
                  report.targetKind === "job"
                    ? `<form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/reports/${report.id}/resolve`))}">
                        <input type="hidden" name="resolution" value="job_removed">
                        <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                        <button class="button" type="submit">Remove job</button>
                      </form>`
                    : `<form class="form inline" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/reports/${report.id}/resolve`))}">
                        <input type="hidden" name="resolution" value="coder_unapproved">
                        <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                        <button class="button" type="submit">Take profile down</button>
                      </form>`
                }
              </div>
            </li>`,
          )
          .join("")}</ul>`;

  const pendingSection =
    pending.length === 0
      ? `<p class="muted">No coder profiles are waiting for review.</p>`
      : `<ul class="plain-list">${pending
          .map(
            (coder) => `<li class="card">
              <div class="card-head">
                <h3>${escapeHtml(coder.displayName)}</h3>
                <span class="meta">${escapeHtml(coder.createdAt.slice(0, 10))}</span>
              </div>
              <p class="headline">${escapeHtml(coder.headline)}</p>
              <p class="meta">${escapeHtml(coder.skills.join(", "))}</p>
              <form class="inline-form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/coders/${coder.id}/approve`))}">
                <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                <button class="button" type="submit">Approve profile</button>
              </form>
            </li>`,
          )
          .join("")}</ul>`;

  const disputesSection =
    disputes.length === 0
      ? `<p class="muted">No open disputes. Money in dispute stays in escrow until someone decides.</p>`
      : `<ul class="plain-list">${disputes
          .map(
            (engagement) => `<li class="card">
              <div class="card-head">
                <h3>Engagement ${escapeHtml(engagement.id.slice(0, 8))}</h3>
                <span class="meta">${escapeHtml(money(engagement.amountCents, engagement.currency))} in escrow</span>
              </div>
              <p class="meta">Opened ${escapeHtml(engagement.updatedAt.slice(0, 10))} · payout if released: ${escapeHtml(money(engagement.payoutCents, engagement.currency))}</p>
              ${
                engagement.deliveryNote === ""
                  ? ""
                  : `<p class="headline">Delivery note: ${escapeHtml(engagement.deliveryNote)}</p>`
              }
              <form class="form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/disputes/${engagement.id}/resolve`))}">
                <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                <div class="field">
                  <label for="resolution-${escapeHtml(engagement.id)}">Why are you deciding this way?</label>
                  <textarea id="resolution-${escapeHtml(engagement.id)}" name="note" rows="2" maxlength="1000" required placeholder="What did you check? What does the evidence show?"></textarea>
                </div>
                <div class="actions">
                  <button class="button button-secondary" type="submit" name="outcome" value="refunded">Refund the business</button>
                  <button class="button" type="submit" name="outcome" value="released">Release to the coder</button>
                </div>
              </form>
            </li>`,
          )
          .join("")}</ul>`;

  const auditSection =
    audit.length === 0
      ? `<p class="muted">No admin actions yet. Dispute decisions and profile approvals are recorded here.</p>`
      : `<div class="table-wrap"><table>
          <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Detail</th></tr></thead>
          <tbody>${audit
            .map(
              (entry) => `<tr>
                <td>${escapeHtml(entry.createdAt.slice(0, 19).replace("T", " "))}</td>
                <td>${escapeHtml(entry.action)}</td>
                <td><code>${escapeHtml(entry.targetId.slice(0, 8))}</code></td>
                <td>${escapeHtml(entry.detail)}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table></div>`;

  const ledgerTable =
    entries.length === 0
      ? emptyState(
          "No ledger entries yet",
          "Charges, fees, payouts and refunds appear here as engagements move.",
        )
      : `<div class="table-wrap"><table>
          <thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Amount</th><th scope="col">Engagement</th><th scope="col">Note</th></tr></thead>
          <tbody>${entries
            .map(
              (entry) => `<tr>
                <td>${escapeHtml(entry.createdAt.slice(0, 19).replace("T", " "))}</td>
                <td>${escapeHtml(entry.kind.replace(/_/gu, " "))}</td>
                <td class="numeric">${escapeHtml(money(entry.amountCents, entry.currency))}</td>
                <td><code>${escapeHtml(entry.engagementId.slice(0, 8))}</code></td>
                <td>${escapeHtml(entry.note)}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table></div>`;

  return layout({
    basePath: ctx.basePath,
    title: "Admin",
    account,
    content: `<section class="stack">
      <p class="eyebrow">Operations</p>
      <h1>Admin</h1>
      <div class="stats">
        ${totalsCard("Charged into escrow", money(totals.chargedCents, totals.currency), `${escapeHtml(totals.entryCount)} ledger entries`)}
        ${totalsCard("Platform fees", money(totals.feeCents, totals.currency), "15% standard, 20% assisted")}
        ${totalsCard("Coder payouts", money(totals.payoutCents, totals.currency), "Released on approval")}
        ${totalsCard("Refunded", money(totals.refundedCents, totals.currency), "Cancelled engagements")}
        ${totalsCard("Still held", money(totals.heldCents, totals.currency), "Charged − refunded − fees − payouts")}
      </div>

      <section class="stack">
        <h2>Operator snapshot</h2>
        <div class="stats">
          ${totalsCard("Accounts", String(overview.accounts), `${overview.suspendedAccounts} suspended`)}
          ${totalsCard("Coders", String(overview.approvedCoders), `${overview.pendingCoders} waiting for approval`)}
          ${totalsCard("Open jobs", String(overview.openJobs), "accepting applications")}
          ${totalsCard("Escrow engagements", String(overview.escrowEngagements), `${overview.deliveredAwaitingRelease} delivered, awaiting release`)}
          ${totalsCard("Needs a human", String(overview.openReports + overview.openDisputes), `${overview.openReports} reports · ${overview.openDisputes} disputes`)}
          ${totalsCard("Queued messages", String(overview.queuedMail + overview.queuedPush), `${overview.queuedMail} mail · ${overview.queuedPush} push`)}
        </div>
      </section>

      <section class="stack">
        <h2>Open disputes</h2>
        ${disputesSection}
      </section>

      <section class="stack">
        <h2>Assisted deliveries waiting for review</h2>
        <p class="muted">These engagements paid the 20% assisted fee, so an operator reads the evidence before the business approves. A review is advisory and audited: it never moves money.</p>
        ${
          assisted.length === 0
            ? `<p class="muted">Nothing waiting. Assisted deliveries appear here once the coder marks them delivered.</p>`
            : `<ul class="plain-list">${assisted
                .map(
                  (engagement) => `<li class="card">
                    <div class="card-head">
                      <h3>Engagement ${escapeHtml(engagement.id.slice(0, 8))}</h3>
                      <span class="meta">${escapeHtml(money(engagement.amountCents, engagement.currency))} · ${escapeHtml(String(engagement.feeBps / 100))}% tier</span>
                    </div>
                    ${
                      engagement.deliveryNote === ""
                        ? ""
                        : `<p class="headline">Delivery note: ${escapeHtml(engagement.deliveryNote)}</p>`
                    }
                    ${
                      engagement.deliveryEvidence.length === 0
                        ? `<p class="meta">No evidence links were attached.</p>`
                        : `<ul class="plain-list">${engagement.deliveryEvidence
                            .map(
                              (link) =>
                                `<li><a class="link" href="${escapeHtml(link)}" rel="nofollow noopener noreferrer">${escapeHtml(link)}</a></li>`,
                            )
                            .join("")}</ul>`
                    }
                    <form class="form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/assisted/${engagement.id}/review`))}">
                      <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                      <div class="field">
                        <label for="review-${escapeHtml(engagement.id)}">What did the evidence show?</label>
                        <textarea id="review-${escapeHtml(engagement.id)}" name="note" rows="2" maxlength="1000" required placeholder="Which links did you open, and does the work match the note?"></textarea>
                      </div>
                      <button class="button button-secondary" type="submit">Record review</button>
                    </form>
                  </li>`,
                )
                .join("")}</ul>`
        }
      </section>

      <section class="stack">
        <h2>Deliveries waiting on a business</h2>
        <p class="muted">Coders who delivered more than 3 days ago and are still waiting for a review. Sending a reminder only notifies the business — it never approves or moves money — and the same delivery is reminded at most once every 48 hours.</p>
        <p class="meta">${escapeHtml(String(waitingDeliveryCount(ctx)))} deliver${waitingDeliveryCount(ctx) === 1 ? "y" : "ies"} past the 3-day mark.</p>
        <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/admin/reminders/run"))}">
          <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
          <button class="button button-secondary" type="submit">Send waiting-delivery reminders</button>
        </form>
      </section>

      <section class="stack">
        <h2>Ledger reconciliation</h2>
        ${
          reconciliation.ok
            ? `<p class="badge badge-approved">All ${reconciliation.engagements} engagements balance across ${reconciliation.entries} ledger entries.</p>`
            : `<p class="badge badge-disputed">${reconciliation.problems.length} engagement${reconciliation.problems.length === 1 ? "" : "s"} disagree with the escrow state machine.</p>
               <ul class="plain-list">${reconciliation.problems
                 .map(
                   (problem) =>
                     `<li class="card"><p class="meta">${escapeHtml(problem.engagementId)}</p><p>${escapeHtml(problem.detail)}</p></li>`,
                 )
                 .join("")}</ul>`
        }
        <p class="muted">Read-only: the expected entries are derived from each engagement's state (charge, then fee+payout or a refund) and compared with the ledger. The same report is at <code>/api/admin/reconcile</code>.</p>
      </section>

      <section class="stack">
        <h2>Auto-release</h2>
        <p class="muted">A delivered engagement with no approval and no dispute is paid out after <strong>${escapeHtml(String(ctx.autoReleaseDays))} days</strong> (0 disables). The sweep uses the normal approval path, writes the same ledger rows and records an audit entry per release; a provider failure leaves the row delivered for the next run.</p>
        <p class="meta">${escapeHtml(String(autoReleaseEligible))} delivery${autoReleaseEligible === 1 ? "" : "ies"} eligible now.</p>
        <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/admin/auto-release/run"))}">
          <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
          <button class="button button-secondary" type="submit">Run auto-release sweep</button>
        </form>
      </section>

      <section class="stack">
        <h2>Accounts</h2>
        ${accountsSection}
      </section>

      <section class="stack">
        <h2>Saved-search alerts</h2>
        <p class="muted">Coders can save a filtered job search. This sweep checks each one for jobs posted since its last run and writes one feed/push notification per search with new matches. It never emails and never changes a job.</p>
        <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/admin/job-alerts/run"))}">
          <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
          <button class="button button-secondary" type="submit">Run job-alert sweep</button>
        </form>
      </section>

      <section class="stack">
        <h2>Coder alerts</h2>
        <p class="muted">Businesses watch a skill set, an interest domain or a maximum rate. This sweep notifies each watcher once about newly approved coders who fit — feed and push only, never email, never a ranking change.</p>
        <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/admin/coder-alerts/run"))}">
          <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
          <button class="button button-secondary" type="submit">Run coder-alert sweep</button>
        </form>
      </section>

      <section class="stack">
        <h2>Assisted jobs</h2>
        <p class="muted">Jobs where the business paid for help. Write the scoping note (what done means, what to check) and shortlist up to ${escapeHtml(String(MAX_SHORTLIST))} coders. Both are advisory: the business still hires and approves, and neither moves money.</p>
        ${
          assistedJobs.length === 0
            ? `<p class="muted">No assisted jobs right now.</p>`
            : `<ul class="plain-list">${assistedJobs
                .map(({ job, scope, shortlist }) => {
                  const matches = rankCoders(ctx, job, 5);
                  return `<li class="card">
                    <div class="card-head">
                      <h3><a class="link" href="${escapeHtml(pageUrl(ctx.basePath, `/jobs/${job.id}`))}">${escapeHtml(job.title)}</a></h3>
                      <span class="badge ${scope === null ? "badge-requested" : "badge-open"}">${scope === null ? "Needs scoping" : "Scoped"}</span>
                    </div>
                    <p class="meta">${escapeHtml(money(job.budgetMinCents, job.currency))}–${escapeHtml(money(job.budgetMaxCents, job.currency))} · posted ${escapeHtml(job.createdAt.slice(0, 10))} · ${escapeHtml(String(shortlist.length))} on shortlist</p>
                    <form class="form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/assisted/jobs/${job.id}/scope`))}">
                      <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                      <div class="field">
                        <label for="scope-${escapeHtml(job.id)}">Scoping note</label>
                        <textarea id="scope-${escapeHtml(job.id)}" name="note" rows="3" minlength="20" maxlength="2000" required placeholder="What done means, which skills actually matter, what to check in the delivery.">${escapeHtml(scope?.note ?? "")}</textarea>
                      </div>
                      <button class="button button-secondary" type="submit">Save scope note</button>
                    </form>
                    <form class="form" method="post" action="${escapeHtml(pageUrl(ctx.basePath, `/api/admin/assisted/jobs/${job.id}/shortlist`))}">
                      <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
                      <div class="field">
                        <label for="shortlist-${escapeHtml(job.id)}">Shortlist coder ids (comma separated, max ${escapeHtml(String(MAX_SHORTLIST))})</label>
                        <input id="shortlist-${escapeHtml(job.id)}" name="coderIds" type="text" value="${escapeHtml(shortlist.join(", "))}" placeholder="${escapeHtml(
                          matches
                            .map((match) => match.coder.id)
                            .slice(0, 3)
                            .join(", "),
                        )}">
                        <span class="hint">${matches.length === 0 ? "No approved coder matches yet." : `Ranked: ${matches.map((match) => `${escapeHtml(match.coder.displayName)} (${escapeHtml(match.coder.id.slice(0, 8))}…, ${escapeHtml(String(match.score))}/100)`).join(" · ")}`}</span>
                      </div>
                      <button class="button button-secondary" type="submit">Save shortlist</button>
                    </form>
                  </li>`;
                })
                .join("")}</ul>`
        }
      </section>

      <section class="stack">
        <h2>Abuse reports</h2>
        <p class="meta">Reported jobs are hidden from the job list; reported profiles leave the directory. Resolving a report notifies the reporter.</p>
        ${reportsSection}
      </section>

      <section class="stack">
        <h2>Profiles waiting for review</h2>
        ${pendingSection}
      </section>

      <section class="stack">
        <h2>Recent admin actions</h2>
        ${auditSection}
      </section>

      <section class="stack">
        <h2>Ledger</h2>
        <p><a class="button button-secondary" href="${escapeHtml(pageUrl(ctx.basePath, "/api/admin/ledger.csv"))}">Download ledger (CSV)</a></p>
        ${ledgerTable}
      </section>

      <section class="stack">
        <h2>Backups</h2>
        <p class="muted">A consistent copy of the live database (<code>VACUUM INTO</code>), reopened and checked with <code>integrity_check</code> before it is reported. Use it before payouts and from cron; the copy lands in <code>MARKETPLACE_BACKUP_DIR</code>.</p>
        <form method="post" action="${escapeHtml(pageUrl(ctx.basePath, "/api/admin/backup/run"))}">
          <input type="hidden" name="redirectTo" value="${escapeHtml(adminPath)}">
          <button class="button button-secondary" type="submit">Back up now</button>
        </form>
      </section>
    </section>`,
  });
}
