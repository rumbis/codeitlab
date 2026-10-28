import type { Job } from "../shared/contracts.ts";
import type { AppContext } from "./context.ts";
import { listOpenJobs } from "./jobs.ts";
import { listInterestsForCoder } from "./jobs.ts";
import { getCoderProfile } from "./profiles.ts";
import type { AccountRow } from "./types.ts";

export interface RecommendedJob {
  readonly job: Job;
  /** 0..1: how much of the job matches what the coder declared. */
  readonly score: number;
  readonly matchedSkills: readonly string[];
  readonly matchedInterests: readonly string[];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Recommendations are built only from what the coder declared: skills and the
 * fields they want to work in. Jobs they already applied to are excluded, so the
 * list never asks for a decision that was already made.
 */
export function recommendedJobsForCoder(
  ctx: AppContext,
  account: AccountRow,
  limit = 5,
): RecommendedJob[] {
  const profile = getCoderProfile(ctx, account.id);
  if (profile === null) return [];
  const skills = new Set(profile.skills.map(normalize));
  const interests = new Set(profile.interests.map(normalize));
  if (skills.size === 0 && interests.size === 0) return [];

  const applied = new Set(listInterestsForCoder(ctx, account).map((interest) => interest.jobId));
  const scored: RecommendedJob[] = [];
  for (const job of listOpenJobs(ctx, 100)) {
    if (applied.has(job.id)) continue;
    const matchedSkills = job.skills.filter((skill) => skills.has(normalize(skill)));
    const matchedInterests = interests.has(normalize(job.category)) ? [job.category] : [];
    if (matchedSkills.length === 0 && matchedInterests.length === 0) continue;
    const skillScore = job.skills.length === 0 ? 0 : matchedSkills.length / job.skills.length;
    const score =
      Math.round((skillScore * 0.6 + (matchedInterests.length > 0 ? 0.4 : 0)) * 100) / 100;
    scored.push({ job, score, matchedSkills, matchedInterests });
  }
  return scored
    .sort((left, right) =>
      right.score === left.score
        ? left.job.createdAt < right.job.createdAt
          ? 1
          : -1
        : right.score - left.score,
    )
    .slice(0, Math.min(Math.max(limit, 1), 20));
}
