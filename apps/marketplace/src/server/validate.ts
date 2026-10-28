import type { AccountRole, Availability, JobCategory } from "../shared/contracts.ts";
import { AVAILABILITY_LABELS, JOB_CATEGORIES } from "../shared/contracts.ts";
import { badRequest } from "./errors.ts";

export type Body = Record<string, unknown>;

export const MAX_CENTS = 100_000_000;

export function requireText(
  body: Body,
  field: string,
  label: string,
  minLength: number,
  maxLength: number,
): string {
  const raw = body[field];
  if (typeof raw !== "string") throw badRequest(`${label} is required.`, `invalid_${field}`);
  const value = raw.trim();
  if (value.length < minLength) {
    throw badRequest(`${label} must be at least ${minLength} characters.`, `invalid_${field}`);
  }
  if (value.length > maxLength) {
    throw badRequest(`${label} must be at most ${maxLength} characters.`, `invalid_${field}`);
  }
  return value;
}

export function optionalText(body: Body, field: string, label: string, maxLength: number): string {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") throw badRequest(`${label} must be text.`, `invalid_${field}`);
  const value = raw.trim();
  if (value.length > maxLength) {
    throw badRequest(`${label} must be at most ${maxLength} characters.`, `invalid_${field}`);
  }
  return value;
}

export function requireId(body: Body, field: string, label: string): string {
  const raw = body[field];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw badRequest(`${label} is required.`, `invalid_${field}`);
  }
  const value = raw.trim();
  if (value.length > 64) throw badRequest(`${label} is not valid.`, `invalid_${field}`);
  return value;
}

export function requireInteger(
  body: Body,
  field: string,
  label: string,
  min: number,
  max: number,
): number {
  const raw = body[field];
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;
  if (!Number.isInteger(value)) {
    throw badRequest(`${label} must be a whole number.`, `invalid_${field}`);
  }
  if (value < min || value > max) {
    throw badRequest(`${label} must be between ${min} and ${max}.`, `invalid_${field}`);
  }
  return value;
}

export function requireEnum<T extends string>(
  body: Body,
  field: string,
  label: string,
  values: readonly T[],
): T {
  const raw = body[field];
  if (typeof raw !== "string" || !values.includes(raw as T)) {
    throw badRequest(`${label} must be one of: ${values.join(", ")}.`, `invalid_${field}`);
  }
  return raw as T;
}

export function requireAvailability(body: Body, field = "availability"): Availability {
  return requireEnum(
    body,
    field,
    "Availability",
    Object.keys(AVAILABILITY_LABELS) as Availability[],
  );
}

export function requireEmail(body: Body, field = "email"): string {
  const raw = body[field];
  if (typeof raw !== "string") throw badRequest("Email is required.", "invalid_email");
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw badRequest("Enter a valid email address.", "invalid_email");
  }
  return email;
}

export function requireRole(body: Body, field = "role"): AccountRole {
  return requireEnum<AccountRole>(body, field, "Role", ["coder", "business"]);
}

/**
 * Skills arrive as a JSON array or as the comma/newline separated string the
 * no-JS forms post. They are compared case-insensitively everywhere, so keep
 * one trimmed spelling per case-insensitive value.
 */
export function parseSkills(raw: unknown, label = "Skills"): string[] {
  let values: string[] = [];
  if (Array.isArray(raw)) {
    values = raw.filter((value): value is string => typeof value === "string");
  } else if (typeof raw === "string") {
    values = raw.split(/[,\n]/u);
  } else if (raw !== undefined && raw !== null) {
    throw badRequest(`${label} must be a list of skills.`, "invalid_skills");
  }

  const seen = new Set<string>();
  const skills: string[] = [];
  for (const value of values) {
    const skill = value.trim().replace(/\s+/gu, " ");
    if (skill === "") continue;
    if (skill.length > 40) {
      throw badRequest(`${label} entries must be at most 40 characters.`, "invalid_skills");
    }
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    skills.push(skill);
  }
  if (skills.length > 30) {
    throw badRequest(`${label} can list at most 30 skills.`, "invalid_skills");
  }
  return skills;
}

export function requireSkills(body: Body, field: string, min: number): string[] {
  const skills = parseSkills(body[field]);
  if (skills.length < min) {
    throw badRequest(
      min === 1 ? "Add at least one skill." : `Add at least ${min} skills.`,
      "invalid_skills",
    );
  }
  return skills;
}

/**
 * Links arrive as a JSON object or as "Label=https://example.com" lines from the
 * no-JS form. Only http(s) URLs are accepted; a missing label falls back to the
 * hostname.
 */
export function parseLinks(raw: unknown, label = "Links"): Record<string, string> {
  const entries: Array<[string, string]> = [];

  if (raw === undefined || raw === null || raw === "") {
    return {};
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "string") entries.push([key, value]);
    }
  } else if (typeof raw === "string") {
    for (const line of raw.split(/\n/u)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) {
        entries.push(["", trimmed]);
      } else {
        entries.push([trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()]);
      }
    }
  } else {
    throw badRequest(`${label} must be a list of URLs.`, "invalid_links");
  }

  if (entries.length > 5) {
    throw badRequest(`${label} can list at most 5 URLs.`, "invalid_links");
  }

  const links: Record<string, string> = {};
  let index = 0;
  for (const [rawLabel, rawUrl] of entries) {
    index += 1;
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw badRequest(`${label} must be full http(s) URLs.`, "invalid_links");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw badRequest(`${label} must use http or https.`, "invalid_links");
    }
    const name = (rawLabel === "" ? parsed.hostname : rawLabel).slice(0, 40);
    links[name === "" ? `Link ${index}` : name] = parsed.toString();
  }
  return links;
}

/**
 * Declared skill depth arrives as a JSON object (`{"React": 5}`) or as
 * "Skill=5" lines from the no-JS form. Levels are clamped to 1–5; unknown
 * skills are allowed so a coder can declare a skill before adding it.
 */
export function parseSkillLevels(raw: unknown, label = "Skill levels"): Record<string, number> {
  const levels: Record<string, number> = {};
  const entries: Array<[string, unknown]> = [];

  if (raw === undefined || raw === null || raw === "") return levels;
  if (typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) entries.push([key, value]);
  } else if (typeof raw === "string") {
    for (const line of raw.split(/[\n,]/u)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const separator = trimmed.includes("=") ? trimmed.indexOf("=") : trimmed.indexOf(":");
      if (separator === -1) continue;
      entries.push([trimmed.slice(0, separator).trim(), trimmed.slice(separator + 1).trim()]);
    }
  } else {
    throw badRequest(`${label} must be a skill-to-level map.`, "invalid_skill_levels");
  }

  if (entries.length > 30) {
    throw badRequest(`${label} can list at most 30 skills.`, "invalid_skill_levels");
  }
  for (const [rawSkill, rawLevel] of entries) {
    const skill = rawSkill.trim().replace(/\s+/gu, " ");
    if (skill === "" || skill.length > 40) continue;
    const level = Number(rawLevel);
    if (!Number.isFinite(level)) {
      throw badRequest(`${label} must use whole numbers from 1 to 5.`, "invalid_skill_levels");
    }
    levels[skill] = Math.min(Math.max(Math.round(level), 1), 5);
  }
  return levels;
}

/**
 * Evidence links prove the work: repos, case studies, delivered projects.
 * They are rendered as links, so only http(s) is accepted and the list is
 * capped to keep the profile page small.
 */
/**
 * The coder's delivery note: optional, but capped so a wall of text cannot push
 * the business's approval decision off the page.
 */
export function parseDeliveryNote(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") {
    throw badRequest("Delivery note must be text.", "invalid_delivery_note");
  }
  const value = raw.trim();
  if (value.length > 2_000) {
    throw badRequest("Delivery note can be at most 2000 characters.", "invalid_delivery_note");
  }
  return value;
}

export function parseEvidence(raw: unknown, label = "Evidence"): string[] {
  let values: string[] = [];
  if (raw === undefined || raw === null || raw === "") return [];
  if (Array.isArray(raw)) {
    values = raw.filter((value): value is string => typeof value === "string");
  } else if (typeof raw === "string") {
    values = raw.split(/[\n,]/u);
  } else {
    throw badRequest(`${label} must be a list of URLs.`, "invalid_evidence");
  }

  const seen = new Set<string>();
  const evidence: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed === "") continue;
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw badRequest(`${label} must be full http(s) URLs.`, "invalid_evidence");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw badRequest(`${label} must use http or https.`, "invalid_evidence");
    }
    const href = parsed.toString();
    if (seen.has(href)) continue;
    seen.add(href);
    evidence.push(href);
    if (evidence.length > 5) {
      throw badRequest(`${label} can list at most 5 URLs.`, "invalid_evidence");
    }
  }
  return evidence;
}

export function requireCategory(
  body: Body,
  field = "category",
  fallback: JobCategory = "other",
): JobCategory {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string" || !(JOB_CATEGORIES as readonly string[]).includes(raw)) {
    throw badRequest(`Category must be one of: ${JOB_CATEGORIES.join(", ")}.`, "invalid_category");
  }
  return raw as JobCategory;
}

export function requireCurrency(body: Body, field = "currency", fallback = "EUR"): string {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") return fallback;
  if (typeof raw !== "string" || !/^[A-Za-z]{3}$/u.test(raw.trim())) {
    throw badRequest("Currency must be a three-letter code such as EUR.", "invalid_currency");
  }
  return raw.trim().toUpperCase();
}

export function requireTimezone(body: Body, field = "timezone", fallback = "UTC"): string {
  const raw = body[field];
  const timezone = raw === undefined || raw === null || raw === "" ? fallback : raw;
  if (typeof timezone !== "string" || timezone.length > 64) {
    throw badRequest("Timezone must be an IANA name such as Europe/Berlin.", "invalid_timezone");
  }
  try {
    Intl.DateTimeFormat("en", { timeZone: timezone }).format(0);
  } catch {
    throw badRequest("Timezone must be an IANA name such as Europe/Berlin.", "invalid_timezone");
  }
  return timezone;
}
