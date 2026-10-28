import * as NodeCrypto from "node:crypto";

import { JOB_CATEGORIES, type JobCategory } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { execute, executeChanges, queryAll, queryOne } from "./db.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { listOpenJobs } from "./jobs.ts";
import { notify } from "./notifications.ts";
import type { AccountRow } from "./types.ts";
import type { Body } from "./validate.ts";

export const MAX_SAVED_SEARCHES = 10;
export const JOB_ALERT_LIMIT = 5;

export interface SavedSearch {
  readonly id: string;
  readonly query: string;
  readonly category: JobCategory | "";
  readonly minBudgetCents: number;
  readonly createdAt: string;
  readonly lastCheckedAt: string;
}

interface SavedSearchRow {
  readonly id: string;
  readonly query: string;
  readonly category: string;
  readonly minBudgetCents: number;
  readonly createdAt: string;
  readonly lastCheckedAt: string;
}

const COLUMNS = `
  id, query, category, min_budget_cents AS minBudgetCents,
  created_at AS createdAt, last_checked_at AS lastCheckedAt
`;

function toSavedSearch(row: SavedSearchRow): SavedSearch {
  const category = (JOB_CATEGORIES as readonly string[]).includes(row.category)
    ? (row.category as JobCategory)
    : "";
  return {
    id: row.id,
    query: row.query,
    category,
    minBudgetCents: Number(row.minBudgetCents),
    createdAt: row.createdAt,
    lastCheckedAt: row.lastCheckedAt,
  };
}

export function listSavedSearches(ctx: AppContext, accountId: string): SavedSearch[] {
  return queryAll<SavedSearchRow>(
    ctx.db,
    `SELECT ${COLUMNS} FROM saved_searches WHERE account_id = ? ORDER BY created_at DESC`,
    [accountId],
  ).map(toSavedSearch);
}

/** The same filters the /jobs page accepts, so saving a search is not a new vocabulary. */
interface ReadSearch {
  readonly query: string;
  readonly category: JobCategory | "";
  readonly minBudgetCents: number;
}

function readSearch(body: Body): ReadSearch {
  const query = typeof body.q === "string" ? body.q.trim().slice(0, 120) : "";
  const rawCategory = typeof body.category === "string" ? body.category.trim() : "";
  if (rawCategory !== "" && !(JOB_CATEGORIES as readonly string[]).includes(rawCategory)) {
    throw badRequest("Pick one of the job fields, or leave it empty.", "invalid_category");
  }
  const rawBudget = Number(body.minBudget ?? 0);
  const minBudgetCents =
    Number.isFinite(rawBudget) && rawBudget > 0 ? Math.round(rawBudget * 100) : 0;
  if (query === "" && rawCategory === "" && minBudgetCents === 0) {
    throw badRequest(
      "Add at least one filter (search text, field or minimum budget) before saving.",
      "empty_search",
    );
  }
  return { query, category: rawCategory as JobCategory | "", minBudgetCents };
}

export function createSavedSearch(ctx: AppContext, account: AccountRow, body: Body): SavedSearch {
  if (account.role !== "coder") {
    throw forbidden("Only coders save job searches.", "wrong_role");
  }
  const existing = listSavedSearches(ctx, account.id);
  if (existing.length >= MAX_SAVED_SEARCHES) {
    throw conflict(
      `You can keep ${MAX_SAVED_SEARCHES} saved searches. Delete one first.`,
      "too_many_saved_searches",
    );
  }
  const search = readSearch(body);
  const duplicate = existing.some(
    (saved) =>
      saved.query.toLowerCase() === search.query.toLowerCase() &&
      saved.category === search.category &&
      saved.minBudgetCents === search.minBudgetCents,
  );
  if (duplicate) throw conflict("You already saved this search.", "duplicate_saved_search");

  const id = `search_${NodeCrypto.randomUUID()}`;
  const now = ctx.now().toISOString();
  execute(
    ctx.db,
    `INSERT INTO saved_searches
      (id, account_id, query, category, min_budget_cents, created_at, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, account.id, search.query, search.category, search.minBudgetCents, now, now],
  );
  return toSavedSearch({
    id,
    query: search.query,
    category: search.category,
    minBudgetCents: search.minBudgetCents,
    createdAt: now,
    lastCheckedAt: now,
  });
}

export function deleteSavedSearch(ctx: AppContext, accountId: string, id: string): void {
  const removed = executeChanges(
    ctx.db,
    "DELETE FROM saved_searches WHERE id = ? AND account_id = ?",
    [id, accountId],
  );
  if (removed === 0) throw notFound("That saved search is already gone.", "saved_search_not_found");
}

/** The public link for a saved search, so a notification opens the same filter. */
export function savedSearchHref(search: SavedSearch): string {
  const params = new URLSearchParams();
  if (search.query !== "") params.set("q", search.query);
  if (search.category !== "") params.set("category", search.category);
  if (search.minBudgetCents > 0) params.set("minBudget", String(search.minBudgetCents / 100));
  const query = params.toString();
  return query === "" ? "/jobs" : `/jobs?${query}`;
}

/**
 * The alert sweep: for every saved search, look for open jobs posted since the
 * last check, notify once per search with a count, and move the watermark. It
 * is idempotent between runs and never emails — alerts live in the feed/push,
 * because the email channel is reserved for money and invitations.
 */
export function runJobAlerts(ctx: AppContext): { readonly notified: number } {
  const searches = queryAll<SavedSearchRow & { accountId: string }>(
    ctx.db,
    `SELECT ${COLUMNS}, account_id AS accountId FROM saved_searches ORDER BY created_at ASC`,
  );
  let notified = 0;
  for (const row of searches) {
    const search = toSavedSearch(row);
    const matches = queryAll<{ id: string; title: string }>(
      ctx.db,
      `SELECT id, title FROM jobs
       WHERE status = 'open'
         AND created_at > ?
         AND (? = '' OR lower(title) LIKE ? OR lower(description) LIKE ? OR lower(skills) LIKE ?)
         AND (? = '' OR category = ?)
         AND budget_max_cents >= ?
       ORDER BY created_at DESC LIMIT ?`,
      [
        search.lastCheckedAt,
        search.query.toLowerCase(),
        `%${search.query.toLowerCase()}%`,
        `%${search.query.toLowerCase()}%`,
        `%${search.query.toLowerCase()}%`,
        search.category,
        search.category,
        search.minBudgetCents,
        JOB_ALERT_LIMIT,
      ],
    );
    if (matches.length > 0) {
      const label =
        search.query !== ""
          ? `"${search.query}"`
          : search.category !== ""
            ? `the ${search.category} field`
            : `your budget filter`;
      notify(ctx, {
        accountId: row.accountId,
        kind: "job_alert",
        message: `${matches.length} new job${matches.length === 1 ? "" : "s"} match${matches.length === 1 ? "es" : ""} ${label}. The first: "${matches[0]?.title ?? ""}".`,
        href: savedSearchHref(search),
      });
      notified += 1;
    }
    execute(ctx.db, "UPDATE saved_searches SET last_checked_at = ? WHERE id = ?", [
      ctx.now().toISOString(),
      search.id,
    ]);
  }
  return { notified };
}

/** Open-job count for a saved search, used on the dashboard list. */
export function savedSearchMatchCount(ctx: AppContext, search: SavedSearch): number {
  return listOpenJobs(ctx, 100, {
    query: search.query,
    category: search.category,
    minBudgetCents: search.minBudgetCents,
  }).length;
}

/** Kept for callers that only need the row, not the notification. */
export function getSavedSearch(ctx: AppContext, accountId: string, id: string): SavedSearch | null {
  const row = queryOne<SavedSearchRow>(
    ctx.db,
    `SELECT ${COLUMNS} FROM saved_searches WHERE id = ? AND account_id = ?`,
    [id, accountId],
  );
  return row === undefined ? null : toSavedSearch(row);
}
