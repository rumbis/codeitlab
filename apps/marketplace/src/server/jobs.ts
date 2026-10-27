import * as NodeCrypto from "node:crypto";

import type { Interest, Job, JobCategory } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { conflict, forbidden, notFound } from "./errors.ts";
import { assertNoOffPlatformContact } from "./contactGuard.ts";
import { consumeRateLimit } from "./ratelimit.ts";
import { toCoderProfile } from "./profiles.ts";
import { notify } from "./notifications.ts";
import type { AccountRow, CoderProfileRow, InterestRow, JobRow } from "./types.ts";
import {
  optionalText,
  requireCategory,
  requireCurrency,
  requireInteger,
  requireSkills,
  requireText,
  type Body,
} from "./validate.ts";

const JOB_COLUMNS = `
  id, business_id AS businessId, title, description, skills, category,
  budget_min_cents AS budgetMinCents, budget_max_cents AS budgetMaxCents,
  currency, timeline, status, assisted, created_at AS createdAt
`;

const INTEREST_COLUMNS = `
  id, job_id AS jobId, coder_id AS coderId, message, created_at AS createdAt
`;

export function toJob(row: JobRow): Job {
  let skills: string[] = [];
  try {
    const value: unknown = JSON.parse(row.skills);
    if (Array.isArray(value)) {
      skills = value.filter((skill): skill is string => typeof skill === "string");
    }
  } catch {
    skills = [];
  }
  return {
    id: row.id,
    businessId: row.businessId,
    title: row.title,
    description: row.description,
    skills,
    category: row.category as JobCategory,
    budgetMinCents: Number(row.budgetMinCents),
    budgetMaxCents: Number(row.budgetMaxCents),
    currency: row.currency,
    timeline: row.timeline,
    status: row.status,
    assisted: Number(row.assisted) === 1,
    createdAt: row.createdAt,
  };
}

export function getJobRow(ctx: AppContext, id: string): JobRow | undefined {
  return queryOne<JobRow>(ctx.db, `SELECT ${JOB_COLUMNS} FROM jobs WHERE id = ?`, [id]);
}

export function getJob(ctx: AppContext, id: string): Job | null {
  const row = getJobRow(ctx, id);
  return row === undefined ? null : toJob(row);
}

export function getJobOrThrow(ctx: AppContext, id: string): Job {
  const job = getJob(ctx, id);
  if (job === null) throw notFound("Job not found.", "job_not_found");
  return job;
}

export function createJob(ctx: AppContext, account: AccountRow, body: Body): Job {
  if (account.role !== "business") {
    throw forbidden("Only business accounts can post a job.", "wrong_role");
  }
  const title = requireText(body, "title", "Title", 4, 120);
  const description = requireText(body, "description", "Description", 20, 5_000);
  const skills = requireSkills(body, "skills", 1);
  const budgetMinCents = requireInteger(body, "budgetMinCents", "Minimum budget", 1, 100_000_000);
  const budgetMaxCents = requireInteger(body, "budgetMaxCents", "Maximum budget", 1, 100_000_000);
  if (budgetMaxCents < budgetMinCents) {
    throw conflict("Maximum budget must be at least the minimum budget.", "invalid_budget");
  }
  const currency = requireCurrency(body);
  const timeline = requireText(body, "timeline", "Timeline", 2, 120);
  const category = requireCategory(body);
  const assisted =
    body.assisted === true || body.assisted === "on" || body.assisted === "1" ? 1 : 0;

  // A flood of posts is spam or a stolen session, not a person scoping work.
  consumeRateLimit(
    ctx,
    `job_post:${account.id}`,
    ctx.rateLimits.jobPostPerHour,
    "You are posting jobs too quickly. Try again later.",
  );

  const id = NodeCrypto.randomUUID();
  const createdAt = ctx.now().toISOString();
  execute(
    ctx.db,
    `INSERT INTO jobs
      (id, business_id, title, description, skills, category, budget_min_cents, budget_max_cents,
       currency, timeline, status, assisted, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    [
      id,
      account.id,
      title,
      description,
      JSON.stringify(skills),
      category,
      budgetMinCents,
      budgetMaxCents,
      currency,
      timeline,
      assisted,
      createdAt,
    ],
  );

  const created = getJobRow(ctx, id);
  if (created === undefined) throw notFound("Job was not saved.", "job_not_found");
  return toJob(created);
}

export interface JobSearch {
  /** Free text over title, description and skills (case-insensitive). */
  readonly query?: string;
  readonly category?: JobCategory | "";
  /** Only jobs whose maximum budget reaches this amount. */
  readonly minBudgetCents?: number;
  /** Rows to skip, for the paged job board. */
  readonly offset?: number;
}

/**
 * Search is plain SQL over the text the business wrote. It does not rank by
 * clicks, and a coder's declared interests are applied on their dashboard
 * instead — this is for a person who wants to look for something specific.
 */
export function listOpenJobs(ctx: AppContext, limit = 50, search: JobSearch = {}): Job[] {
  const query = (search.query ?? "").trim().toLowerCase();
  const like = `%${query}%`;
  const category = search.category ?? "";
  const minBudgetCents =
    Number.isInteger(search.minBudgetCents) && (search.minBudgetCents ?? 0) > 0
      ? (search.minBudgetCents ?? 0)
      : 0;
  const offset =
    Number.isInteger(search.offset) && (search.offset ?? 0) > 0 ? (search.offset ?? 0) : 0;
  return queryAll<JobRow>(
    ctx.db,
    `SELECT ${JOB_COLUMNS} FROM jobs
     WHERE status = 'open'
       AND (? = '' OR lower(title) LIKE ? OR lower(description) LIKE ? OR lower(skills) LIKE ?)
       AND (? = '' OR category = ?)
       AND budget_max_cents >= ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [
      query,
      like,
      like,
      like,
      category,
      category,
      minBudgetCents,
      Math.min(Math.max(limit, 1), 100),
      offset,
    ],
  ).map(toJob);
}

/** Total rows matching a board filter, for "page 2 of 3" without loading them. */
export function countOpenJobs(ctx: AppContext, search: JobSearch = {}): number {
  const query = (search.query ?? "").trim().toLowerCase();
  const like = `%${query}%`;
  const category = search.category ?? "";
  const minBudgetCents =
    Number.isInteger(search.minBudgetCents) && (search.minBudgetCents ?? 0) > 0
      ? (search.minBudgetCents ?? 0)
      : 0;
  const row = queryOne<{ n: number }>(
    ctx.db,
    `SELECT COUNT(*) AS n FROM jobs
     WHERE status = 'open'
       AND (? = '' OR lower(title) LIKE ? OR lower(description) LIKE ? OR lower(skills) LIKE ?)
       AND (? = '' OR category = ?)
       AND budget_max_cents >= ?`,
    [query, like, like, like, category, category, minBudgetCents],
  );
  return row === undefined ? 0 : Number(row.n);
}

export interface RepeatSource {
  readonly engagementId: string;
  readonly job: Job;
  readonly coderId: string;
}

/**
 * A repeat hire is only offered for work that already paid out: the business and
 * the coder have a finished, settled engagement. The new job is a fresh posting
 * (new id, new escrow) — nothing is cloned from the old money path.
 */
export function repeatSourceFor(
  ctx: AppContext,
  businessId: string,
  engagementId: string,
): RepeatSource | null {
  if (engagementId === "") return null;
  const row = queryOne<{
    jobId: string;
    coderId: string;
    status: string;
    businessId: string;
  }>(
    ctx.db,
    `SELECT job_id AS jobId, coder_id AS coderId, status, business_id AS businessId
     FROM engagements WHERE id = ?`,
    [engagementId],
  );
  if (row === undefined || row.businessId !== businessId) return null;
  if (row.status !== "paid_out" && row.status !== "approved") return null;
  const job = getJob(ctx, row.jobId);
  if (job === null) return null;
  return { engagementId, job, coderId: row.coderId };
}

export function listJobsForBusiness(ctx: AppContext, businessId: string): Job[] {
  return queryAll<JobRow>(
    ctx.db,
    `SELECT ${JOB_COLUMNS} FROM jobs WHERE business_id = ? ORDER BY created_at DESC`,
    [businessId],
  ).map(toJob);
}

/**
 * The owner can stop accepting applications without hiring anyone. Only an open
 * job can be closed: a job with an active engagement is managed through that
 * engagement (cancel refunds and reopens the job), and a job removed after a
 * report cannot be reopened by its owner.
 */
export function closeJob(ctx: AppContext, account: AccountRow, jobId: string): Job {
  if (account.role !== "business") {
    throw forbidden("Only the business that posted a job can close it.", "wrong_role");
  }
  const job = getJobOrThrow(ctx, jobId);
  if (job.businessId !== account.id) {
    throw forbidden("This job belongs to another business.", "not_owner");
  }
  if (job.status !== "open") {
    throw conflict(
      "Only an open job can be closed. A job with an active engagement is managed through the engagement.",
      "job_not_open",
    );
  }
  setJobStatus(ctx, jobId, "closed");
  return getJobOrThrow(ctx, jobId);
}

export function reopenJob(ctx: AppContext, account: AccountRow, jobId: string): Job {
  if (account.role !== "business") {
    throw forbidden("Only the business that posted a job can reopen it.", "wrong_role");
  }
  const job = getJobOrThrow(ctx, jobId);
  if (job.businessId !== account.id) {
    throw forbidden("This job belongs to another business.", "not_owner");
  }
  if (job.status !== "closed") {
    throw conflict("Only a closed job can be reopened.", "job_not_closed");
  }
  const removed = queryOne<{ id: string }>(
    ctx.db,
    `SELECT id FROM reports
     WHERE target_kind = 'job' AND target_id = ? AND status = 'resolved' AND resolution = 'job_removed'
     LIMIT 1`,
    [jobId],
  );
  if (removed !== undefined) {
    throw forbidden(
      "This job was removed after a report. Post a new brief instead of reopening it.",
      "job_removed",
    );
  }
  setJobStatus(ctx, jobId, "open");
  return getJobOrThrow(ctx, jobId);
}

export function setJobStatus(ctx: AppContext, jobId: string, status: Job["status"]): void {
  execute(ctx.db, "UPDATE jobs SET status = ? WHERE id = ?", [status, jobId]);
}

export function toInterest(row: InterestRow): Interest {
  return {
    id: row.id,
    jobId: row.jobId,
    coderId: row.coderId,
    message: row.message,
    createdAt: row.createdAt,
  };
}

export function addInterest(
  ctx: AppContext,
  account: AccountRow,
  jobId: string,
  body: Body,
): Interest {
  if (account.role !== "coder") {
    throw forbidden("Only coder accounts can apply to a job.", "wrong_role");
  }
  const job = getJobOrThrow(ctx, jobId);
  if (job.status !== "open") {
    throw conflict("This job is no longer accepting applications.", "job_not_open");
  }

  const coderRow = queryOne<CoderProfileRow>(
    ctx.db,
    "SELECT id FROM coder_profiles WHERE account_id = ?",
    [account.id],
  );
  if (coderRow === undefined) {
    throw conflict("Create a coder profile before applying to jobs.", "profile_required");
  }

  const existing = queryOne<InterestRow>(
    ctx.db,
    `SELECT ${INTEREST_COLUMNS} FROM interests WHERE job_id = ? AND coder_id = ?`,
    [jobId, coderRow.id],
  );
  if (existing !== undefined) {
    throw conflict("You already applied to this job.", "already_applied");
  }

  const message = optionalText(body, "message", "Message", 1_000);
  assertNoOffPlatformContact(message, "application");
  consumeRateLimit(
    ctx,
    `apply:${account.id}`,
    ctx.rateLimits.applicationPerHour,
    "You are sending applications too quickly. Try again later.",
  );
  const id = NodeCrypto.randomUUID();
  const createdAt = ctx.now().toISOString();
  const coderName = queryOne<{ displayName: string }>(
    ctx.db,
    "SELECT display_name AS displayName FROM coder_profiles WHERE id = ?",
    [coderRow.id],
  );
  execute(
    ctx.db,
    "INSERT INTO interests (id, job_id, coder_id, message, created_at) VALUES (?, ?, ?, ?, ?)",
    [id, jobId, coderRow.id, message, createdAt],
  );
  notify(ctx, {
    accountId: job.businessId,
    kind: "application",
    message: `${coderName?.displayName ?? "A coder"} applied to "${job.title}".`,
    href: `/jobs/${jobId}`,
    engagementId: "",
  });
  return { id, jobId, coderId: coderRow.id, message, createdAt };
}

export interface InterestWithCoder extends Interest {
  readonly coder: ReturnType<typeof toCoderProfile> | null;
}

export function listInterests(
  ctx: AppContext,
  account: AccountRow,
  jobId: string,
): InterestWithCoder[] {
  const job = getJobOrThrow(ctx, jobId);
  if (job.businessId !== account.id) {
    throw forbidden(
      "Only the business that posted this job can see its applications.",
      "wrong_role",
    );
  }

  const rows = queryAll<InterestRow>(
    ctx.db,
    `SELECT ${INTEREST_COLUMNS} FROM interests WHERE job_id = ? ORDER BY created_at ASC`,
    [jobId],
  );
  return rows.map((row) => {
    const coderRow = queryOne<CoderProfileRow>(
      ctx.db,
      `SELECT id, account_id AS accountId, display_name AS displayName, headline, bio, skills,
              availability, rate_min_cents AS rateMinCents, rate_max_cents AS rateMaxCents,
              currency, timezone, links, approved, created_at AS createdAt, updated_at AS updatedAt
       FROM coder_profiles WHERE id = ?`,
      [row.coderId],
    );
    return {
      ...toInterest(row),
      coder: coderRow === undefined ? null : toCoderProfile(coderRow),
    };
  });
}

export interface InterestWithJob extends Interest {
  readonly jobTitle: string;
  readonly jobStatus: Job["status"];
}

export function listInterestsForCoder(ctx: AppContext, account: AccountRow): InterestWithJob[] {
  if (account.role !== "coder") return [];
  const rows = queryAll<InterestRow & { jobTitle: string; jobStatus: Job["status"] }>(
    ctx.db,
    `SELECT i.id, i.job_id AS jobId, i.coder_id AS coderId, i.message, i.created_at AS createdAt,
            j.title AS jobTitle, j.status AS jobStatus
     FROM interests i
     JOIN jobs j ON j.id = i.job_id
     WHERE i.coder_id IN (SELECT id FROM coder_profiles WHERE account_id = ?)
     ORDER BY i.created_at DESC`,
    [account.id],
  );
  return rows.map((row) => ({
    ...toInterest(row),
    jobTitle: row.jobTitle,
    jobStatus: row.jobStatus,
  }));
}

export function getInterestForCoder(
  ctx: AppContext,
  account: AccountRow,
  jobId: string,
): Interest | null {
  const coderRow = queryOne<CoderProfileRow>(
    ctx.db,
    "SELECT id FROM coder_profiles WHERE account_id = ?",
    [account.id],
  );
  if (coderRow === undefined) return null;
  const row = queryOne<InterestRow>(
    ctx.db,
    `SELECT ${INTEREST_COLUMNS} FROM interests WHERE job_id = ? AND coder_id = ?`,
    [jobId, coderRow.id],
  );
  return row === undefined ? null : toInterest(row);
}
