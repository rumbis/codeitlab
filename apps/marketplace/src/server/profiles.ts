import * as NodeCrypto from "node:crypto";

import {
  JOB_CATEGORIES,
  type Availability,
  type BusinessProfile,
  type CoderProfile,
  type WorkHistoryEntry,
} from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { badRequest, forbidden, notFound } from "./errors.ts";
import type { AccountRow, BusinessProfileRow, CoderProfileRow } from "./types.ts";
import {
  optionalText,
  parseEvidence,
  parseLinks,
  parseSkillLevels,
  parseSkills,
  requireAvailability,
  requireCurrency,
  requireInteger,
  requireText,
  requireTimezone,
  type Body,
} from "./validate.ts";

/** A profile is a summary; more than this and nobody reads it. */
const MAX_WORK_ENTRIES = 20;

const CODER_COLUMNS = `
  id, account_id AS accountId, display_name AS displayName, headline, bio, skills,
  interests, skill_levels AS skillLevels, evidence, work_history AS workHistory,
  availability, rate_min_cents AS rateMinCents, rate_max_cents AS rateMaxCents,
  currency, timezone, links, approved, created_at AS createdAt, updated_at AS updatedAt
`;

const BUSINESS_COLUMNS = `
  id, account_id AS accountId, company_name AS companyName, website, about, industry,
  created_at AS createdAt, updated_at AS updatedAt
`;

function parseJsonArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * Rows are written by normaliseWorkHistory below, but the column also has to
 * survive a hand-edited database and older values, so anything that is not a
 * well-formed entry is dropped rather than surfaced as a broken profile.
 */
function parseWorkHistory(raw: string): WorkHistoryEntry[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const entries: WorkHistoryEntry[] = [];
    for (const item of value) {
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const company = typeof record.company === "string" ? record.company.trim() : "";
      const role = typeof record.role === "string" ? record.role.trim() : "";
      const summary = typeof record.summary === "string" ? record.summary.trim() : "";
      // A row with neither a company, a role nor a summary says nothing.
      if (company === "" && role === "" && summary === "") continue;
      const period = typeof record.period === "string" ? record.period.trim() : "";
      entries.push({ company, role, period, summary });
    }
    return entries.slice(0, MAX_WORK_ENTRIES);
  } catch {
    return [];
  }
}

const WORK_FIELD_LIMITS = { company: 120, role: 120, period: 40, summary: 1_000 } as const;

/**
 * "Role at Company (period): summary" is the shape the dashboard form shows,
 * and every part after the role is optional so a one-line entry is enough.
 */
export function parseWorkLine(line: string): WorkHistoryEntry {
  const text = line.trim();
  if (text === "") return { company: "", role: "", period: "", summary: "" };

  const separator = text.indexOf(":");
  const heading = separator === -1 ? text : text.slice(0, separator);
  const summary = separator === -1 ? "" : text.slice(separator + 1).trim();

  const periodMatch = /\(([^()]*)\)\s*$/u.exec(heading);
  const period = periodMatch?.[1]?.trim() ?? "";
  const withoutPeriod = periodMatch === null ? heading : heading.slice(0, periodMatch.index);

  const atMatch = /\s+at\s+/iu.exec(withoutPeriod);
  const role = (atMatch === null ? withoutPeriod : withoutPeriod.slice(0, atMatch.index)).trim();
  const company = (
    atMatch === null ? "" : withoutPeriod.slice(atMatch.index + atMatch[0].length)
  ).trim();

  return { company, role, period, summary };
}

/** The inverse, so the form shows back exactly what the person wrote. */
export function formatWorkEntry(entry: WorkHistoryEntry): string {
  const heading = [entry.role, entry.company === "" ? "" : `at ${entry.company}`]
    .filter((part) => part !== "")
    .join(" ");
  const period = entry.period === "" ? "" : ` (${entry.period})`;
  const summary = entry.summary === "" ? "" : `: ${entry.summary}`;
  return `${heading}${period}${summary}`;
}

/**
 * Input side of the column: unlike the stored form this rejects bad shapes
 * loudly, because it runs while the person is still on the form. Blank rows are
 * skipped so an empty table row left behind on screen is not an error.
 */
function normaliseWorkHistory(raw: unknown): WorkHistoryEntry[] {
  if (raw === undefined || raw === null || raw === "") return [];
  // The dashboard form posts lines of text while the app posts the structured
  // entries, so both shapes arrive here and are judged by the same rules.
  if (typeof raw === "string") return raw.split("\n").map(parseWorkLine);
  if (!Array.isArray(raw)) {
    throw badRequest("Work history must be a list of jobs.", "invalid_work_history");
  }
  if (raw.length > MAX_WORK_ENTRIES) {
    throw badRequest(`Keep work history to ${MAX_WORK_ENTRIES} entries.`, "invalid_work_history");
  }

  const entries: WorkHistoryEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw badRequest("Each work history entry must be a job.", "invalid_work_history");
    }
    const record = item as Record<string, unknown>;
    const field = (key: keyof typeof WORK_FIELD_LIMITS): string => {
      const value = record[key];
      if (value === undefined || value === null) return "";
      if (typeof value !== "string") {
        throw badRequest(`Work entry ${key} must be text.`, "invalid_work_history");
      }
      const trimmed = value.trim();
      if (trimmed.length > WORK_FIELD_LIMITS[key]) {
        throw badRequest(
          `Work entry ${key} must be at most ${WORK_FIELD_LIMITS[key]} characters.`,
          "invalid_work_history",
        );
      }
      return trimmed;
    };

    const entry: WorkHistoryEntry = {
      company: field("company"),
      role: field("role"),
      period: field("period"),
      summary: field("summary"),
    };
    if (entry.company === "" && entry.role === "" && entry.summary === "") continue;
    entries.push(entry);
  }
  return entries;
}

function parseJsonNumberRecord(raw: string): Record<string, number> {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const record: Record<string, number> = {};
    for (const [key, item] of Object.entries(value)) {
      const level = Number(item);
      if (Number.isFinite(level)) record[key] = Math.min(Math.max(Math.round(level), 1), 5);
    }
    return record;
  } catch {
    return {};
  }
}

function parseJsonRecord(raw: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const record: Record<string, string> = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") record[key] = item;
    }
    return record;
  } catch {
    return {};
  }
}

export function toCoderProfile(row: CoderProfileRow): CoderProfile {
  return {
    id: row.id,
    accountId: row.accountId,
    displayName: row.displayName,
    headline: row.headline,
    bio: row.bio,
    skills: parseJsonArray(row.skills),
    interests: parseJsonArray(row.interests),
    skillLevels: parseJsonNumberRecord(row.skillLevels),
    evidence: parseJsonArray(row.evidence),
    workHistory: parseWorkHistory(row.workHistory),
    availability: row.availability,
    rateMinCents: Number(row.rateMinCents),
    rateMaxCents: Number(row.rateMaxCents),
    currency: row.currency,
    timezone: row.timezone,
    links: parseJsonRecord(row.links),
    approved: row.approved === 1,
    createdAt: row.createdAt,
  };
}

export function toBusinessProfile(row: BusinessProfileRow): BusinessProfile {
  return {
    id: row.id,
    accountId: row.accountId,
    companyName: row.companyName,
    website: row.website,
    about: row.about,
    industry: row.industry as BusinessProfile["industry"],
    createdAt: row.createdAt,
  };
}

export function findCoderRowByAccount(
  ctx: AppContext,
  accountId: string,
): CoderProfileRow | undefined {
  return queryOne<CoderProfileRow>(
    ctx.db,
    `SELECT ${CODER_COLUMNS} FROM coder_profiles WHERE account_id = ?`,
    [accountId],
  );
}

export function findCoderRowById(ctx: AppContext, id: string): CoderProfileRow | undefined {
  return queryOne<CoderProfileRow>(
    ctx.db,
    `SELECT ${CODER_COLUMNS} FROM coder_profiles WHERE id = ?`,
    [id],
  );
}

export function getCoderProfile(ctx: AppContext, accountId: string): CoderProfile | null {
  const row = findCoderRowByAccount(ctx, accountId);
  return row === undefined ? null : toCoderProfile(row);
}

export function upsertCoderProfile(ctx: AppContext, account: AccountRow, body: Body): CoderProfile {
  if (account.role !== "coder") {
    throw forbidden("Only coder accounts can create a coder profile.", "wrong_role");
  }

  const displayName = requireText(body, "displayName", "Display name", 2, 80);
  const headline = requireText(body, "headline", "Headline", 4, 120);
  const bio = requireText(body, "bio", "Bio", 1, 2_000);
  const skills = parseSkills(body.skills);
  if (skills.length < 1) {
    throw badRequest("Add at least one skill.", "invalid_skills");
  }
  const availability: Availability = requireAvailability(body);
  const rateMinCents = requireInteger(body, "rateMinCents", "Minimum rate", 0, 100_000_000);
  const rateMaxCents = requireInteger(body, "rateMaxCents", "Maximum rate", 0, 100_000_000);
  if (rateMaxCents < rateMinCents) {
    throw badRequest("Maximum rate must be at least the minimum rate.", "invalid_rate");
  }
  const currency = requireCurrency(body);
  const timezone = requireTimezone(body);
  const links = parseLinks(body.links);
  const interests = parseSkills(body.interests, "Interests");
  const skillLevels = parseSkillLevels(body.skillLevels);
  const evidence = parseEvidence(body.evidence);
  const workHistory = normaliseWorkHistory(body.workHistory);
  const now = ctx.now().toISOString();

  const existing = findCoderRowByAccount(ctx, account.id);
  if (existing !== undefined) {
    execute(
      ctx.db,
      `UPDATE coder_profiles SET
        display_name = ?, headline = ?, bio = ?, skills = ?, interests = ?,
        skill_levels = ?, evidence = ?, work_history = ?, availability = ?,
        rate_min_cents = ?, rate_max_cents = ?, currency = ?, timezone = ?, links = ?, updated_at = ?
       WHERE id = ?`,
      [
        displayName,
        headline,
        bio,
        JSON.stringify(skills),
        JSON.stringify(interests),
        JSON.stringify(skillLevels),
        JSON.stringify(evidence),
        JSON.stringify(workHistory),
        availability,
        rateMinCents,
        rateMaxCents,
        currency,
        timezone,
        JSON.stringify(links),
        now,
        existing.id,
      ],
    );
    return toCoderProfile({
      ...existing,
      displayName,
      headline,
      bio,
      skills: JSON.stringify(skills),
      interests: JSON.stringify(interests),
      skillLevels: JSON.stringify(skillLevels),
      evidence: JSON.stringify(evidence),
      workHistory: JSON.stringify(workHistory),
      availability,
      rateMinCents,
      rateMaxCents,
      currency,
      timezone,
      links: JSON.stringify(links),
      updatedAt: now,
    });
  }

  const id = NodeCrypto.randomUUID();
  execute(
    ctx.db,
    `INSERT INTO coder_profiles
      (id, account_id, display_name, headline, bio, skills, interests, skill_levels, evidence,
       work_history, availability, rate_min_cents, rate_max_cents, currency, timezone, links,
       approved, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      account.id,
      displayName,
      headline,
      bio,
      JSON.stringify(skills),
      JSON.stringify(interests),
      JSON.stringify(skillLevels),
      JSON.stringify(evidence),
      JSON.stringify(workHistory),
      availability,
      rateMinCents,
      rateMaxCents,
      currency,
      timezone,
      JSON.stringify(links),
      ctx.autoApprove ? 1 : 0,
      now,
      now,
    ],
  );

  const created = findCoderRowById(ctx, id);
  if (created === undefined) throw notFound("Coder profile was not saved.");
  return toCoderProfile(created);
}

export function approveCoder(ctx: AppContext, coderId: string): CoderProfile {
  const row = findCoderRowById(ctx, coderId);
  if (row === undefined) throw notFound("Coder profile not found.", "coder_not_found");
  execute(ctx.db, "UPDATE coder_profiles SET approved = 1, updated_at = ? WHERE id = ?", [
    ctx.now().toISOString(),
    coderId,
  ]);
  return toCoderProfile({ ...row, approved: 1 });
}

export function listPendingCoders(ctx: AppContext): CoderProfile[] {
  return queryAll<CoderProfileRow>(
    ctx.db,
    `SELECT ${CODER_COLUMNS} FROM coder_profiles WHERE approved = 0 ORDER BY created_at ASC`,
  ).map(toCoderProfile);
}

/** Public listing: approved profiles only, optionally filtered by every requested skill. */
export function listApprovedCoders(
  ctx: AppContext,
  options: {
    readonly skills?: readonly string[];
    /**
     * Declared interest domains. A coder matches if they declared any of them —
     * a business looking for "video" work should still see a coder who declared
     * "video, animation".
     */
    readonly interests?: readonly string[];
    /** Only coders who declared this availability. */
    readonly availability?: string;
    /** Only coders whose minimum rate is at or below this (cents). */
    readonly maxRateCents?: number;
    readonly limit?: number;
  } = {},
): CoderProfile[] {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const wanted = (options.skills ?? []).map((skill) => skill.trim().toLowerCase()).filter(Boolean);
  const domains = (options.interests ?? [])
    .map((interest) => interest.trim().toLowerCase())
    .filter(Boolean);
  const rows = queryAll<CoderProfileRow>(
    ctx.db,
    `SELECT ${CODER_COLUMNS} FROM coder_profiles WHERE approved = 1 ORDER BY created_at DESC LIMIT ?`,
    [limit],
  ).map(toCoderProfile);

  if (
    wanted.length === 0 &&
    domains.length === 0 &&
    options.availability === undefined &&
    options.maxRateCents === undefined
  ) {
    return rows;
  }
  return rows.filter((coder) => {
    const owned = new Set(coder.skills.map((skill) => skill.toLowerCase()));
    if (!wanted.every((skill) => owned.has(skill))) return false;
    if (options.availability !== undefined && coder.availability !== options.availability) {
      return false;
    }
    if (options.maxRateCents !== undefined && coder.rateMinCents > options.maxRateCents) {
      return false;
    }
    if (domains.length === 0) return true;
    const declared = new Set(coder.interests.map((interest) => interest.toLowerCase()));
    return domains.some((domain) => declared.has(domain));
  });
}

export function upsertBusinessProfile(
  ctx: AppContext,
  account: AccountRow,
  body: Body,
): BusinessProfile {
  if (account.role !== "business") {
    throw forbidden("Only business accounts can create a business profile.", "wrong_role");
  }

  const companyName = requireText(body, "companyName", "Company name", 2, 120);
  const website = optionalText(body, "website", "Website", 300);
  if (website !== "") {
    let parsed: URL;
    try {
      parsed = new URL(website);
    } catch {
      throw badRequest("Website must be a full http(s) URL.", "invalid_website");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw badRequest("Website must use http or https.", "invalid_website");
    }
  }
  const about = optionalText(body, "about", "About", 2_000);
  const industryRaw = optionalText(body, "industry", "Industry", 20);
  if (industryRaw !== "" && !JOB_CATEGORIES.some((category) => category === industryRaw)) {
    throw badRequest("Pick a field from the list.", "invalid_industry");
  }
  const industry = industryRaw as BusinessProfile["industry"];
  const now = ctx.now().toISOString();

  const existing = queryOne<BusinessProfileRow>(
    ctx.db,
    `SELECT ${BUSINESS_COLUMNS} FROM business_profiles WHERE account_id = ?`,
    [account.id],
  );
  if (existing !== undefined) {
    execute(
      ctx.db,
      "UPDATE business_profiles SET company_name = ?, website = ?, about = ?, industry = ?, updated_at = ? WHERE id = ?",
      [companyName, website, about, industry, now, existing.id],
    );
    return toBusinessProfile({ ...existing, companyName, website, about, industry });
  }

  const id = NodeCrypto.randomUUID();
  execute(
    ctx.db,
    `INSERT INTO business_profiles (id, account_id, company_name, website, about, industry, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, account.id, companyName, website, about, industry, now, now],
  );
  return {
    id,
    accountId: account.id,
    companyName,
    website,
    about,
    industry,
    createdAt: now,
  };
}

export function getBusinessProfile(ctx: AppContext, accountId: string): BusinessProfile | null {
  const row = queryOne<BusinessProfileRow>(
    ctx.db,
    `SELECT ${BUSINESS_COLUMNS} FROM business_profiles WHERE account_id = ?`,
    [accountId],
  );
  return row === undefined ? null : toBusinessProfile(row);
}
