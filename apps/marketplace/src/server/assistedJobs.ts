import type { Job } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { badRequest, conflict, notFound } from "./errors.ts";
import { getJob } from "./jobs.ts";
import { notify } from "./notifications.ts";

export const MAX_SHORTLIST = 3;
export const MIN_SCOPE_NOTE = 20;
export const MAX_SCOPE_NOTE = 2_000;

export interface AssistedScope {
  readonly jobId: string;
  readonly note: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssistedJob {
  readonly job: Job;
  readonly scope: AssistedScope | null;
  readonly shortlist: readonly string[];
}

const SCOPE_COLUMNS = "job_id AS jobId, note, created_at AS createdAt, updated_at AS updatedAt";

export function getAssistedScope(ctx: AppContext, jobId: string): AssistedScope | null {
  return (
    queryOne<AssistedScope>(
      ctx.db,
      `SELECT ${SCOPE_COLUMNS} FROM assisted_scopes WHERE job_id = ?`,
      [jobId],
    ) ?? null
  );
}

export function getShortlist(ctx: AppContext, jobId: string): string[] {
  return queryAll<{ coderId: string }>(
    ctx.db,
    "SELECT coder_id AS coderId FROM assisted_shortlist WHERE job_id = ? ORDER BY rowid ASC",
    [jobId],
  ).map((row) => row.coderId);
}

export function isShortlisted(ctx: AppContext, jobId: string, coderId: string): boolean {
  return (
    queryOne<{ coder_id: string }>(
      ctx.db,
      "SELECT coder_id FROM assisted_shortlist WHERE job_id = ? AND coder_id = ?",
      [jobId, coderId],
    ) !== undefined
  );
}

function requireAssistedJob(ctx: AppContext, jobId: string): Job {
  const job = getJob(ctx, jobId);
  if (job === null) throw notFound("Job not found.", "job_not_found");
  if (!job.assisted) {
    throw conflict("This job did not ask for assisted help.", "not_assisted_job");
  }
  return job;
}

/**
 * The operator writes the scoping note the business paid the assisted tier for:
 * what "done" means, what to watch out for, which skills actually matter. It is
 * advisory and visible to the business; it never changes the job or the money.
 */
export function saveAssistedScope(ctx: AppContext, jobId: string, rawNote: unknown): AssistedScope {
  const job = requireAssistedJob(ctx, jobId);
  if (typeof rawNote !== "string") throw badRequest("Scope note must be text.", "bad_note");
  const note = rawNote.trim();
  if (note.length < MIN_SCOPE_NOTE) {
    throw badRequest(
      `Write at least ${MIN_SCOPE_NOTE} characters: what done means and what to check.`,
      "note_too_short",
    );
  }
  if (note.length > MAX_SCOPE_NOTE) {
    throw badRequest(`Keep the note under ${MAX_SCOPE_NOTE} characters.`, "note_too_long");
  }
  const now = ctx.now().toISOString();
  const existing = getAssistedScope(ctx, jobId);
  if (existing === null) {
    execute(
      ctx.db,
      "INSERT INTO assisted_scopes (job_id, note, created_at, updated_at) VALUES (?, ?, ?, ?)",
      [jobId, note, now, now],
    );
  } else {
    execute(ctx.db, "UPDATE assisted_scopes SET note = ?, updated_at = ? WHERE job_id = ?", [
      note,
      now,
      jobId,
    ]);
  }
  notify(ctx, {
    accountId: job.businessId,
    kind: "scope",
    message: `CodeItLab scoped “${job.title}”: the operator note is on the job page.`,
    href: `/jobs/${jobId}`,
  });
  return getAssistedScope(ctx, jobId) as AssistedScope;
}

function parseCoderIds(raw: unknown): string[] {
  const values =
    typeof raw === "string"
      ? raw.split(",").map((value) => value.trim())
      : Array.isArray(raw)
        ? raw.filter((value): value is string => typeof value === "string").map((v) => v.trim())
        : [];
  const unique = [...new Set(values.filter((value) => value !== ""))];
  if (unique.length > MAX_SHORTLIST) {
    throw badRequest(`Shortlist at most ${MAX_SHORTLIST} coders.`, "shortlist_too_long");
  }
  return unique;
}

/**
 * The operator picks up to three coders for the business. The shortlist is a
 * recommendation, not a hire: it notifies the business and the coders, and the
 * business still chooses (and pays) whom to start an engagement with.
 */
export function setShortlist(ctx: AppContext, jobId: string, rawCoderIds: unknown): string[] {
  const job = requireAssistedJob(ctx, jobId);
  const coderIds = parseCoderIds(rawCoderIds);
  for (const coderId of coderIds) {
    const coder = queryOne<{ id: string; approved: number; account_id: string }>(
      ctx.db,
      "SELECT id, approved, account_id FROM coder_profiles WHERE id = ?",
      [coderId],
    );
    if (coder === undefined) throw notFound(`Coder ${coderId} not found.`, "coder_not_found");
    if (Number(coder.approved) !== 1) {
      throw conflict(`Coder ${coderId} is not approved for work yet.`, "coder_not_available");
    }
  }
  const now = ctx.now().toISOString();
  execute(ctx.db, "DELETE FROM assisted_shortlist WHERE job_id = ?", [jobId]);
  for (const coderId of coderIds) {
    execute(
      ctx.db,
      "INSERT INTO assisted_shortlist (job_id, coder_id, created_at) VALUES (?, ?, ?)",
      [jobId, coderId, now],
    );
  }
  if (coderIds.length > 0) {
    notify(ctx, {
      accountId: job.businessId,
      kind: "shortlist",
      message: `CodeItLab shortlisted ${coderIds.length} coder${coderIds.length === 1 ? "" : "s"} for “${job.title}”.`,
      href: `/jobs/${jobId}`,
    });
    for (const coderId of coderIds) {
      const coder = queryOne<{ account_id: string }>(
        ctx.db,
        "SELECT account_id FROM coder_profiles WHERE id = ?",
        [coderId],
      );
      if (coder === undefined) continue;
      notify(ctx, {
        accountId: coder.account_id,
        kind: "shortlist",
        message: `An operator shortlisted you for “${job.title}”. The business can see your profile.`,
        href: `/jobs/${jobId}`,
      });
    }
  }
  return coderIds;
}

/** Assisted jobs with no scope note yet, oldest first: the operator's queue. */
export function listAssistedJobs(ctx: AppContext, limit = 25): AssistedJob[] {
  const rows = queryAll<{ id: string }>(
    ctx.db,
    "SELECT id FROM jobs WHERE assisted = 1 AND status = 'open' ORDER BY created_at ASC LIMIT ?",
    [Math.min(Math.max(limit, 1), 50)],
  );
  const jobs: AssistedJob[] = [];
  for (const row of rows) {
    const job = getJob(ctx, row.id);
    if (job === null) continue;
    jobs.push({ job, scope: getAssistedScope(ctx, job.id), shortlist: getShortlist(ctx, job.id) });
  }
  return jobs;
}
