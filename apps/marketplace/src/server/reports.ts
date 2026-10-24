import type { AppContext } from "./context.ts";
import { badRequest, conflict, notFound } from "./errors.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { recordAdminAction } from "./admin.ts";
import { findCoderRowById } from "./profiles.ts";
import { getJobRow, setJobStatus } from "./jobs.ts";
import { notify } from "./notifications.ts";
import { consumeRateLimit } from "./ratelimit.ts";
import type { AccountRow } from "./types.ts";

export const REPORT_REASONS = {
  scam: "Scam or payment outside escrow",
  spam: "Spam or duplicate post",
  harassment: "Harassment or abusive language",
  stolen_work: "Stolen work or fake evidence",
  impersonation: "Impersonation",
  other: "Something else",
} as const;

export type ReportReason = keyof typeof REPORT_REASONS;

export type ReportTargetKind = "job" | "coder";

export type ReportResolution = "dismissed" | "job_removed" | "coder_unapproved";

export const MAX_REPORT_DETAIL = 1_000;

export interface Report {
  readonly id: string;
  readonly reporterAccountId: string;
  readonly reporterEmail: string;
  readonly targetKind: ReportTargetKind;
  readonly targetId: string;
  /** Human-readable target, e.g. the job title or the coder name. */
  readonly targetLabel: string;
  readonly reason: ReportReason;
  readonly reasonLabel: string;
  readonly detail: string;
  readonly status: "open" | "resolved";
  readonly resolution: ReportResolution | "";
  readonly resolvedAt: string;
  readonly createdAt: string;
}

interface ReportRow {
  readonly id: string;
  readonly reporterAccountId: string;
  readonly reporterEmail: string;
  readonly targetKind: ReportTargetKind;
  readonly targetId: string;
  readonly targetLabel: string | null;
  readonly reason: ReportReason;
  readonly detail: string;
  readonly status: "open" | "resolved";
  readonly resolution: ReportResolution | "";
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

const REPORT_COLUMNS = `r.id, r.reporter_account_id AS reporterAccountId,
  a.email AS reporterEmail, r.target_kind AS targetKind, r.target_id AS targetId,
  CASE r.target_kind
    WHEN 'job' THEN (SELECT title FROM jobs WHERE id = r.target_id)
    ELSE (SELECT display_name FROM coder_profiles WHERE id = r.target_id)
  END AS targetLabel,
  r.reason, r.detail, r.status, r.resolution, r.resolved_at AS resolvedAt,
  r.created_at AS createdAt`;

function toReport(row: ReportRow): Report {
  return {
    id: row.id,
    reporterAccountId: row.reporterAccountId,
    reporterEmail: row.reporterEmail,
    targetKind: row.targetKind,
    targetId: row.targetId,
    targetLabel: row.targetLabel ?? "(removed)",
    reason: row.reason,
    reasonLabel: REPORT_REASONS[row.reason] ?? row.reason,
    detail: row.detail,
    status: row.status,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt ?? "",
    createdAt: row.createdAt,
  };
}

function parseTarget(
  ctx: AppContext,
  kind: unknown,
  id: unknown,
): { kind: ReportTargetKind; id: string; label: string; ownerAccountId: string } {
  if (kind !== "job" && kind !== "coder") {
    throw badRequest("Reports are about a job or a coder profile.", "invalid_target");
  }
  if (typeof id !== "string" || id === "") throw badRequest("Which one?", "invalid_target");
  if (kind === "job") {
    const job = getJobRow(ctx, id);
    if (job === undefined) throw notFound("Job not found.", "job_not_found");
    return { kind, id, label: job.title, ownerAccountId: job.businessId };
  }
  const coder = findCoderRowById(ctx, id);
  if (coder === undefined || !coder.approved) throw notFound("Coder not found.", "coder_not_found");
  return { kind, id, label: coder.displayName, ownerAccountId: coder.accountId };
}

/**
 * Anyone signed in can report a job or a coder. Reports never notify the
 * reported party (that would invite retaliation); they go to the operator queue
 * with the reporter's email, and the reporter hears back when it is resolved.
 */
export function createReport(
  ctx: AppContext,
  account: AccountRow,
  input: {
    readonly targetKind: unknown;
    readonly targetId: unknown;
    readonly reason: unknown;
    readonly detail?: unknown;
  },
): Report {
  consumeRateLimit(
    ctx,
    `report:${account.id}`,
    ctx.rateLimits.reportPerHour,
    "You are sending reports too quickly. Try again later.",
  );
  const target = parseTarget(ctx, input.targetKind, input.targetId);
  if (target.ownerAccountId === account.id) {
    throw badRequest("You cannot report your own post or profile.", "self_report");
  }
  const reason = input.reason;
  if (typeof reason !== "string" || !(reason in REPORT_REASONS)) {
    throw badRequest("Choose a reason from the list.", "invalid_reason");
  }
  if (input.detail !== undefined && typeof input.detail !== "string") {
    throw badRequest("The details must be text.", "invalid_detail");
  }
  const detail = (input.detail ?? "").trim();
  if (detail.length > MAX_REPORT_DETAIL) {
    throw badRequest(`Keep the details under ${MAX_REPORT_DETAIL} characters.`, "invalid_detail");
  }
  const duplicate = queryOne<{ id: string }>(
    ctx.db,
    `SELECT id FROM reports
     WHERE reporter_account_id = ? AND target_kind = ? AND target_id = ? AND status = 'open'`,
    [account.id, target.kind, target.id],
  );
  if (duplicate !== undefined) {
    throw conflict("You already reported this. We are on it.", "already_reported");
  }
  const id = `report_${crypto.randomUUID()}`;
  execute(
    ctx.db,
    `INSERT INTO reports (id, reporter_account_id, target_kind, target_id, reason, detail, status, resolution, resolved_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', '', NULL, ?)`,
    [id, account.id, target.kind, target.id, reason, detail, ctx.now().toISOString()],
  );
  return getReport(ctx, id);
}

export function getReport(ctx: AppContext, id: string): Report {
  const row = queryOne<ReportRow>(
    ctx.db,
    `SELECT ${REPORT_COLUMNS} FROM reports r JOIN accounts a ON a.id = r.reporter_account_id WHERE r.id = ?`,
    [id],
  );
  if (row === undefined) throw notFound("Report not found.", "report_not_found");
  return toReport(row);
}

export function listReports(
  ctx: AppContext,
  options: { readonly status?: "open" | "resolved" | "all"; readonly limit?: number } = {},
): Report[] {
  const status = options.status ?? "open";
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = queryAll<ReportRow>(
    ctx.db,
    `SELECT ${REPORT_COLUMNS} FROM reports r JOIN accounts a ON a.id = r.reporter_account_id
     ${status === "all" ? "" : "WHERE r.status = ?"}
     ORDER BY r.created_at DESC, r.rowid DESC LIMIT ?`,
    status === "all" ? [limit] : [status, limit],
  );
  return rows.map(toReport);
}

export function openReportCount(ctx: AppContext): number {
  return Number(
    queryOne<{ count: number }>(
      ctx.db,
      "SELECT COUNT(*) AS count FROM reports WHERE status = 'open'",
    )?.count ?? 0,
  );
}

const RESOLUTIONS_BY_TARGET: Record<ReportTargetKind, readonly ReportResolution[]> = {
  job: ["dismissed", "job_removed"],
  coder: ["dismissed", "coder_unapproved"],
};

export function resolveReport(
  ctx: AppContext,
  reportId: string,
  resolution: unknown,
  note?: unknown,
): Report {
  const report = getReport(ctx, reportId);
  if (report.status !== "open")
    throw conflict("This report is already resolved.", "already_resolved");
  if (
    typeof resolution !== "string" ||
    !RESOLUTIONS_BY_TARGET[report.targetKind].includes(resolution as ReportResolution)
  ) {
    throw badRequest("Choose a valid resolution for this target.", "invalid_resolution");
  }
  const outcome = resolution as ReportResolution;
  if (typeof note !== "string" && note !== undefined) {
    throw badRequest("The note must be text.", "invalid_note");
  }
  if (outcome === "job_removed") setJobStatus(ctx, report.targetId, "closed");
  if (outcome === "coder_unapproved") {
    execute(ctx.db, "UPDATE coder_profiles SET approved = 0 WHERE id = ?", [report.targetId]);
  }
  execute(
    ctx.db,
    "UPDATE reports SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ? AND status = 'open'",
    [outcome, ctx.now().toISOString(), reportId],
  );
  recordAdminAction(ctx, {
    action: "report.resolve",
    targetId: reportId,
    detail: `${report.targetKind} ${report.targetId}: ${outcome}${typeof note === "string" && note.trim() !== "" ? ` — ${note.trim().slice(0, 200)}` : ""}`,
  });
  const outcomeText =
    outcome === "dismissed"
      ? "no rule was broken"
      : outcome === "job_removed"
        ? "the job was removed"
        : "the profile was taken down for review";
  notify(ctx, {
    accountId: report.reporterAccountId,
    kind: "resolved",
    message: `Your report about "${report.targetLabel}" was reviewed: ${outcomeText}.`,
    href: "/dashboard",
  });
  return getReport(ctx, reportId);
}
