import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, executeChanges, queryAll, queryOne } from "./db.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { notify } from "./notifications.ts";
import type { AccountRow } from "./types.ts";
import type { Body } from "./validate.ts";

export const MAX_CODER_ALERTS = 10;
export const CODER_ALERT_LIMIT = 5;

/**
 * The mirror of a saved job search, for the side that has no time: a business
 * says which skills and domain it watches, and the sweep tells it when an
 * approved coder who fits appears. Feed and push only — never email, never a
 * ranking change, and the alert opens the same filtered directory a human would
 * browse.
 */
export interface CoderAlert {
  readonly id: string;
  readonly skills: readonly string[];
  readonly interest: string;
  readonly maxRateCents: number;
  readonly createdAt: string;
  readonly lastCheckedAt: string;
}

interface CoderAlertRow {
  readonly id: string;
  readonly skills: string;
  readonly interest: string;
  readonly maxRateCents: number;
  readonly createdAt: string;
  readonly lastCheckedAt: string;
}

const COLUMNS = `
  id, skills, interest, max_rate_cents AS maxRateCents,
  created_at AS createdAt, last_checked_at AS lastCheckedAt
`;

function parseSkills(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function toAlert(row: CoderAlertRow): CoderAlert {
  return {
    id: row.id,
    skills: parseSkills(row.skills),
    interest: row.interest,
    maxRateCents: Number(row.maxRateCents),
    createdAt: row.createdAt,
    lastCheckedAt: row.lastCheckedAt,
  };
}

export function listCoderAlerts(ctx: AppContext, accountId: string): CoderAlert[] {
  return queryAll<CoderAlertRow>(
    ctx.db,
    `SELECT ${COLUMNS} FROM coder_alerts WHERE account_id = ? ORDER BY created_at DESC`,
    [accountId],
  ).map(toAlert);
}

interface ReadAlert {
  readonly skills: readonly string[];
  readonly interest: string;
  readonly maxRateCents: number;
}

function readAlert(body: Body): ReadAlert {
  const rawSkills = typeof body.skills === "string" ? body.skills.trim() : "";
  const skills = rawSkills
    .split(",")
    .map((skill) => skill.trim())
    .filter((skill) => skill !== "")
    .slice(0, 10);
  const interest = typeof body.interest === "string" ? body.interest.trim().slice(0, 40) : "";
  const rawRate = Number(body.maxRate ?? 0);
  const maxRateCents = Number.isFinite(rawRate) && rawRate > 0 ? Math.round(rawRate * 100) : 0;
  if (skills.length === 0 && interest === "" && maxRateCents === 0) {
    throw badRequest(
      "Add at least one filter (skills, an interest domain or a maximum rate) before watching.",
      "empty_alert",
    );
  }
  return { skills, interest, maxRateCents };
}

export function createCoderAlert(ctx: AppContext, account: AccountRow, body: Body): CoderAlert {
  if (account.role !== "business") {
    throw forbidden("Only businesses watch for coders.", "wrong_role");
  }
  const existing = listCoderAlerts(ctx, account.id);
  if (existing.length >= MAX_CODER_ALERTS) {
    throw conflict(
      `You can keep ${MAX_CODER_ALERTS} coder alerts. Delete one first.`,
      "too_many_coder_alerts",
    );
  }
  const alert = readAlert(body);
  const duplicate = existing.some(
    (saved) =>
      saved.skills.join(",").toLowerCase() === alert.skills.join(",").toLowerCase() &&
      saved.interest.toLowerCase() === alert.interest.toLowerCase() &&
      saved.maxRateCents === alert.maxRateCents,
  );
  if (duplicate) throw conflict("You already watch for this coder.", "duplicate_coder_alert");

  const id = `watch_${NodeCrypto.randomUUID()}`;
  const now = ctx.now().toISOString();
  execute(
    ctx.db,
    `INSERT INTO coder_alerts
      (id, account_id, skills, interest, max_rate_cents, created_at, last_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, account.id, JSON.stringify(alert.skills), alert.interest, alert.maxRateCents, now, now],
  );
  return toAlert({
    id,
    skills: JSON.stringify(alert.skills),
    interest: alert.interest,
    maxRateCents: alert.maxRateCents,
    createdAt: now,
    lastCheckedAt: now,
  });
}

export function deleteCoderAlert(ctx: AppContext, accountId: string, id: string): void {
  const removed = executeChanges(
    ctx.db,
    "DELETE FROM coder_alerts WHERE id = ? AND account_id = ?",
    [id, accountId],
  );
  if (removed === 0) throw notFound("That alert is already gone.", "coder_alert_not_found");
}

export function coderAlertHref(alert: CoderAlert): string {
  const params = new URLSearchParams();
  if (alert.skills.length > 0) params.set("skills", alert.skills.join(","));
  if (alert.interest !== "") params.set("interest", alert.interest);
  if (alert.maxRateCents > 0) params.set("maxRate", String(alert.maxRateCents / 100));
  const query = params.toString();
  return query === "" ? "/coders" : `/coders?${query}`;
}

export function coderAlertLabel(alert: CoderAlert): string {
  const parts: string[] = [];
  if (alert.skills.length > 0) parts.push(alert.skills.join(", "));
  if (alert.interest !== "") parts.push(`${alert.interest} domain`);
  if (alert.maxRateCents > 0) parts.push(`up to ${(alert.maxRateCents / 100).toFixed(0)}/h`);
  return parts.join(" · ");
}

/** Coders matching an alert, newest first, for the dashboard count and the sweep. */
export function coderAlertMatches(
  ctx: AppContext,
  alert: CoderAlert,
  since?: string,
): { id: string; displayName: string }[] {
  const conditions: string[] = ["approved = 1"];
  const params: (string | number)[] = [];
  if (since !== undefined) {
    conditions.push("created_at > ?");
    params.push(since);
  }
  for (const skill of alert.skills) {
    conditions.push("lower(skills) LIKE ?");
    params.push(`%"${skill.toLowerCase()}"%`);
  }
  if (alert.interest !== "") {
    conditions.push("lower(interests) LIKE ?");
    params.push(`%"${alert.interest.toLowerCase()}"%`);
  }
  if (alert.maxRateCents > 0) {
    conditions.push("rate_min_cents <= ?");
    params.push(alert.maxRateCents);
  }
  return queryAll<{ id: string; displayName: string }>(
    ctx.db,
    `SELECT id, display_name AS displayName FROM coder_profiles
     WHERE ${conditions.join(" AND ")}
     ORDER BY created_at DESC LIMIT ?`,
    [...params, CODER_ALERT_LIMIT],
  );
}

export function runCoderAlerts(ctx: AppContext): { readonly notified: number } {
  const rows = queryAll<CoderAlertRow & { accountId: string }>(
    ctx.db,
    `SELECT ${COLUMNS}, account_id AS accountId FROM coder_alerts ORDER BY created_at ASC`,
  );
  let notified = 0;
  for (const row of rows) {
    const alert = toAlert(row);
    const matches = coderAlertMatches(ctx, alert, row.lastCheckedAt);
    if (matches.length > 0) {
      notify(ctx, {
        accountId: row.accountId,
        kind: "coder_alert",
        message: `${matches.length} new coder${matches.length === 1 ? "" : "s"} match ${coderAlertLabel(alert)}. The first: ${matches[0]?.displayName ?? ""}.`,
        href: coderAlertHref(alert),
      });
      notified += 1;
    }
    execute(ctx.db, "UPDATE coder_alerts SET last_checked_at = ? WHERE id = ?", [
      ctx.now().toISOString(),
      alert.id,
    ]);
  }
  return { notified };
}

export function getCoderAlert(ctx: AppContext, accountId: string, id: string): CoderAlert | null {
  const row = queryOne<CoderAlertRow>(
    ctx.db,
    `SELECT ${COLUMNS} FROM coder_alerts WHERE id = ? AND account_id = ?`,
    [id, accountId],
  );
  return row === undefined ? null : toAlert(row);
}
