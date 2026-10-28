import {
  AVAILABILITY_LABELS,
  JOB_CATEGORY_LABELS,
  MATCH_WEIGHTS,
  formatCents,
  type Availability,
  type CoderMatch,
  type CoderProfile,
  type Job,
  type MatchReason,
} from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { queryAll } from "./db.ts";
import { toCoderProfile } from "./profiles.ts";
import { loadReputationSummaries, reputationFrom, type Reputation } from "./reputation.ts";
import type { CoderProfileRow } from "./types.ts";

const AVAILABILITY_SCORE: Record<Availability, number> = {
  full_time: 1,
  part_time: 0.75,
  weekends: 0.5,
  not_available: 0,
};

const DEFAULT_MATCH_LIMIT = 10;
const MAX_MATCH_LIMIT = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function skillSet(skills: readonly string[]): Set<string> {
  return new Set(skills.map((skill) => skill.trim().toLowerCase()).filter((skill) => skill !== ""));
}

function matchedSkills(job: Job, coder: CoderProfile): string[] {
  const offered = skillSet(coder.skills);
  return job.skills.filter((skill) => offered.has(skill.trim().toLowerCase()));
}

/**
 * Jaccard overlap of the job's required skills and the coder's skills, softened
 * by the declared depth: matching at level 5 counts fully, an undeclared skill
 * counts as level 3. A coder who says "I know Node.js deeply" outranks one who
 * lists it with no level.
 */
function skillScore(job: Job, coder: CoderProfile): number {
  const required = skillSet(job.skills);
  const offered = skillSet(coder.skills);
  if (required.size === 0 || offered.size === 0) return 0;
  let intersection = 0;
  for (const skill of required) {
    if (offered.has(skill)) intersection += 1;
  }
  const union = required.size + offered.size - intersection;
  if (union === 0) return 0;
  const overlap = intersection / union;

  const levels = matchedSkills(job, coder)
    .map((skill) => coder.skillLevels[skill] ?? coder.skillLevels[skill.toLowerCase()] ?? 3)
    .filter((level) => Number.isFinite(level));
  const averageLevel =
    levels.length === 0 ? 3 : levels.reduce((sum, level) => sum + level, 0) / levels.length;
  const depthFactor = 0.75 + 0.25 * (clamp(averageLevel, 1, 5) / 5);
  return overlap * depthFactor;
}

/**
 * The field the coder declared they want to work in. This is the difference
 * between "I can do it" and "I want this kind of work" and it is fully visible
 * to both sides (the reason string names the category).
 */
function interestScore(job: Job, coder: CoderProfile): number {
  const interests = new Set(coder.interests.map((interest) => interest.trim().toLowerCase()));
  return interests.has(job.category) ? 1 : 0;
}

/** Up to three evidence links count fully; more than three add nothing. */
function evidenceScore(coder: CoderProfile): number {
  return clamp(coder.evidence.length / 3, 0, 1);
}

/**
 * Full credit when the coder's rate range intersects the job budget. Otherwise
 * fall off linearly with the gap, relative to the larger of the two top ends, so
 * a coder one budget-width over the top scores 0.
 */
function rateScore(job: Job, coder: CoderProfile): number {
  const overlaps =
    coder.rateMaxCents >= job.budgetMinCents && coder.rateMinCents <= job.budgetMaxCents;
  if (overlaps) return 1;
  const gap =
    coder.rateMinCents > job.budgetMaxCents
      ? coder.rateMinCents - job.budgetMaxCents
      : job.budgetMinCents - coder.rateMaxCents;
  const denominator = Math.max(job.budgetMaxCents, coder.rateMaxCents, 1);
  return clamp(1 - gap / denominator, 0, 1);
}

/** Levels are the product of paid deliveries and evidence, so they score directly. */
const REPUTATION_SCORE: Record<Reputation["level"], number> = {
  new: 0,
  proven: 0.4,
  trusted: 0.8,
  expert: 1,
};

/**
 * Profile completeness: a real bio (40+ chars) is worth 0.4, at least one link
 * 0.3, and three or more skills 0.3.
 */
function completenessScore(coder: CoderProfile): number {
  const bio = coder.bio.trim();
  const bioScore = bio.length >= 40 ? 0.4 : bio.length > 0 ? 0.2 : 0;
  const linkScore = Object.keys(coder.links).length >= 1 ? 0.3 : 0;
  const skillsScore = coder.skills.length >= 3 ? 0.3 : coder.skills.length * 0.1;
  return clamp(bioScore + linkScore + skillsScore, 0, 1);
}

function buildReasons(
  job: Job,
  coder: CoderProfile,
  reputation: Reputation,
  scores: {
    skills: number;
    interest: number;
    evidence: number;
    availability: number;
    rate: number;
    completeness: number;
  },
): MatchReason[] {
  const required = skillSet(job.skills);
  const offered = skillSet(coder.skills);
  const matched = job.skills.filter((skill) => offered.has(skill.trim().toLowerCase()));
  const levelDetail = matched
    .map((skill) => {
      const level = coder.skillLevels[skill] ?? coder.skillLevels[skill.toLowerCase()];
      return level === undefined ? `${skill} (level not set)` : `${skill} ${level}/5`;
    })
    .join(", ");
  const skillDetail =
    matched.length > 0
      ? `Matches ${matched.length} of ${required.size} required skills: ${levelDetail}`
      : `None of the required skills (${job.skills.join(", ")}) are on this profile`;

  const categoryLabel = JOB_CATEGORY_LABELS[job.category];
  const interestDetail =
    scores.interest === 1
      ? `Declared interest in ${categoryLabel} (${job.category}), the job's field`
      : `No declared interest in ${categoryLabel} (${job.category}); interests: ${
          coder.interests.length === 0 ? "none declared" : coder.interests.join(", ")
        }`;

  const evidenceDetail =
    coder.evidence.length === 0
      ? "No evidence links yet"
      : `${coder.evidence.length} evidence link(s)${coder.evidence.length >= 3 ? " — full credit" : ""}`;

  const availabilityDetail =
    coder.availability === "not_available"
      ? "Not currently available for work"
      : `${AVAILABILITY_LABELS[coder.availability]} availability`;

  const rateDetail =
    scores.rate === 1
      ? `Rate ${formatCents(coder.rateMinCents, coder.currency)}–${formatCents(coder.rateMaxCents, coder.currency)} fits the ${formatCents(job.budgetMinCents, job.currency)}–${formatCents(job.budgetMaxCents, job.currency)} budget`
      : `Rate ${formatCents(coder.rateMinCents, coder.currency)}–${formatCents(coder.rateMaxCents, coder.currency)} is outside the ${formatCents(job.budgetMinCents, job.currency)}–${formatCents(job.budgetMaxCents, job.currency)} budget`;

  const parts: string[] = [];
  if (coder.bio.trim().length >= 40) parts.push("a detailed bio");
  else if (coder.bio.trim().length > 0) parts.push("a short bio");
  if (Object.keys(coder.links).length >= 1)
    parts.push(`${Object.keys(coder.links).length} link(s)`);
  parts.push(`${coder.skills.length} skill(s)`);
  const completenessDetail = `Profile includes ${parts.join(", ")}`;

  const reputationDetail =
    reputation.level === "new"
      ? "No paid deliveries yet — reputation is earned, not declared"
      : `${reputation.levelLabel} reputation: ${reputation.completedEngagements} paid delivery(ies), ${reputation.evidenceDeliveries} with evidence`;

  return [
    { kind: "skills", detail: skillDetail },
    { kind: "interest", detail: interestDetail },
    { kind: "evidence", detail: evidenceDetail },
    { kind: "availability", detail: availabilityDetail },
    { kind: "rate", detail: rateDetail },
    { kind: "completeness", detail: completenessDetail },
    { kind: "reputation", detail: reputationDetail },
  ];
}

function scoreCoder(
  job: Job,
  coder: CoderProfile,
  reputation: Reputation,
): { score: number; reasons: MatchReason[] } {
  const scores = {
    skills: skillScore(job, coder),
    interest: interestScore(job, coder),
    evidence: evidenceScore(coder),
    availability: AVAILABILITY_SCORE[coder.availability],
    rate: rateScore(job, coder),
    completeness: completenessScore(coder),
  };
  const weighted =
    MATCH_WEIGHTS.skills * scores.skills +
    MATCH_WEIGHTS.interest * scores.interest +
    MATCH_WEIGHTS.evidence * scores.evidence +
    MATCH_WEIGHTS.availability * scores.availability +
    MATCH_WEIGHTS.rate * scores.rate +
    MATCH_WEIGHTS.completeness * scores.completeness +
    MATCH_WEIGHTS.reputation * REPUTATION_SCORE[reputation.level];
  return {
    // The epsilon keeps a mathematically exact .5 (e.g. 0.225 * 100) from
    // rounding down because of binary floating point.
    score: clamp(Math.round(weighted * 100 + 1e-9), 0, 100),
    reasons: buildReasons(job, coder, reputation, scores),
  };
}

/**
 * Ranked, approved coders for a job. Ties break deterministically by profile age
 * (older first) and then by id, so the same job always returns the same order.
 */
export function rankCoders(ctx: AppContext, job: Job, limit?: number): CoderMatch[] {
  const cappedLimit = Math.min(Math.max(limit ?? DEFAULT_MATCH_LIMIT, 1), MAX_MATCH_LIMIT);
  const coders = queryAll<CoderProfileRow>(
    ctx.db,
    `SELECT id, account_id AS accountId, display_name AS displayName, headline, bio, skills,
            interests, skill_levels AS skillLevels, evidence,
            availability, rate_min_cents AS rateMinCents, rate_max_cents AS rateMaxCents,
            currency, timezone, links, approved, created_at AS createdAt, updated_at AS updatedAt
     FROM coder_profiles WHERE approved = 1`,
  ).map(toCoderProfile);

  const summaries = loadReputationSummaries(
    ctx,
    coders.map((coder) => coder.id),
  );
  const reputationFor = (coder: CoderProfile): Reputation => {
    const summary = summaries.get(coder.id) ?? {
      completedEngagements: 0,
      earnedCents: 0,
      evidenceDeliveries: 0,
      disputes: 0,
      repeatClients: 0,
    };
    return reputationFrom(summary, coder.currency);
  };

  return coders
    .map((coder) => {
      const reputation = reputationFor(coder);
      return {
        coder,
        ...scoreCoder(job, coder, reputation),
        reputation: {
          level: reputation.level,
          completedEngagements: reputation.completedEngagements,
          evidenceDeliveries: reputation.evidenceDeliveries,
        },
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.coder.createdAt !== right.coder.createdAt) {
        return left.coder.createdAt < right.coder.createdAt ? -1 : 1;
      }
      return left.coder.id < right.coder.id ? -1 : left.coder.id > right.coder.id ? 1 : 0;
    })
    .slice(0, cappedLimit);
}
