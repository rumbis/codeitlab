/**
 * Shared marketplace vocabulary. The server, the rendered pages and the
 * marketing site all speak these names; keep money in integer cents and never
 * let a page compute a fee on its own.
 */

export const MARKETPLACE_ORIGIN = "https://codeitlab.com";
export const MARKETPLACE_BASE_PATH = "/market";

/**
 * The take rate. `standard` is the 15% fee for a normal engagement; `assisted`
 * is 20% when CodeItLab also runs the project (matching, check-ins, dispute
 * handling). The tier is chosen by the business per engagement and stored on the
 * row, so a later change to the default never rewrites history.
 */
export const PLATFORM_FEE_BPS = 1500;
export const ASSISTED_FEE_BPS = 2000;

export const FEE_TIERS = ["standard", "assisted"] as const;
export type FeeTier = (typeof FEE_TIERS)[number];

export const FEE_TIER_BPS: Record<FeeTier, number> = {
  standard: PLATFORM_FEE_BPS,
  assisted: ASSISTED_FEE_BPS,
};

export const FEE_TIER_LABELS: Record<FeeTier, string> = {
  standard: "Standard — 15% platform fee",
  assisted: "Assisted — 20%, we help run the project",
};

export const PAYOUT_DELAY_DAYS = 0;

export type AccountRole = "coder" | "business";

export type Availability = "full_time" | "part_time" | "weekends" | "not_available";

/**
 * The field a job belongs to. Coders declare the fields they want work in
 * (`interests`) and the ranker rewards the overlap; it is the only signal that
 * says "this is the kind of work I actually want", not just "I can do it".
 */
export const JOB_CATEGORIES = ["web", "video", "data", "ops", "design", "ai", "other"] as const;
export type JobCategory = (typeof JOB_CATEGORIES)[number];

export const JOB_CATEGORY_LABELS: Record<JobCategory, string> = {
  web: "Web app",
  video: "Video / motion",
  data: "Data / analytics",
  ops: "Ops / automation",
  design: "Design / brand",
  ai: "AI / agents",
  other: "Other",
};

export const AVAILABILITY_LABELS: Record<Availability, string> = {
  full_time: "Full time",
  part_time: "Part time",
  weekends: "Weekends",
  not_available: "Not available",
};

export type EngagementStatus =
  | "requested"
  | "accepted"
  | "in_progress"
  | "delivered"
  | "approved"
  | "paid_out"
  | "cancelled"
  | "disputed";

export type LedgerKind = "charge" | "platform_fee" | "payout" | "refund";

/**
 * One job a person has held. It is the structured form of "what have you done
 * so far": a business reads the role and the company, not a paragraph.
 */
export interface WorkHistoryEntry {
  readonly company: string;
  readonly role: string;
  /** Free text such as "2021 - 2023"; not every job has exact dates. */
  readonly period: string;
  readonly summary: string;
}

export interface CoderProfile {
  readonly id: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly headline: string;
  readonly bio: string;
  readonly skills: readonly string[];
  /** Fields the coder wants to work in (see JOB_CATEGORIES). */
  readonly interests: readonly string[];
  /** Declared level per skill, 1 (learning) to 5 (expert). */
  readonly skillLevels: Readonly<Record<string, number>>;
  /** Public links that prove the work: repos, case studies, deliveries. */
  readonly evidence: readonly string[];
  /** Jobs in the person's own words, newest first. */
  readonly workHistory: readonly WorkHistoryEntry[];
  readonly availability: Availability;
  readonly rateMinCents: number;
  readonly rateMaxCents: number;
  readonly currency: string;
  readonly timezone: string;
  readonly links: Readonly<Record<string, string>>;
  readonly approved: boolean;
  readonly createdAt: string;
}

export interface BusinessProfile {
  readonly id: string;
  readonly accountId: string;
  readonly companyName: string;
  readonly website: string;
  readonly about: string;
  /** The field this business usually hires in (see JOB_CATEGORIES), or "". */
  readonly industry: JobCategory | "";
  readonly createdAt: string;
}

export interface Job {
  readonly id: string;
  readonly businessId: string;
  readonly title: string;
  readonly description: string;
  readonly skills: readonly string[];
  readonly category: JobCategory;
  readonly budgetMinCents: number;
  readonly budgetMaxCents: number;
  readonly currency: string;
  readonly timeline: string;
  readonly status: "open" | "matched" | "closed";
  /** The business asked CodeItLab to help scope and shortlist (20% tier). */
  readonly assisted: boolean;
  readonly createdAt: string;
}

export interface MatchReason {
  readonly kind:
    | "skills"
    | "interest"
    | "evidence"
    | "availability"
    | "rate"
    | "completeness"
    | "reputation";
  readonly detail: string;
}

/** The part of a coder's derived record that a match card shows. */
export interface MatchReputation {
  readonly level: "new" | "proven" | "trusted" | "expert";
  readonly completedEngagements: number;
  readonly evidenceDeliveries: number;
}

export interface CoderMatch {
  readonly coder: CoderProfile;
  readonly score: number;
  readonly reasons: readonly MatchReason[];
  readonly reputation: MatchReputation;
}

export interface Interest {
  readonly id: string;
  readonly jobId: string;
  readonly coderId: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface Engagement {
  readonly id: string;
  readonly jobId: string;
  readonly coderId: string;
  readonly businessId: string;
  readonly amountCents: number;
  readonly feeBps: number;
  readonly feeCents: number;
  readonly payoutCents: number;
  readonly currency: string;
  readonly status: EngagementStatus;
  readonly paymentRef: string;
  /** What the coder says they delivered, shown to the business before approval. */
  readonly deliveryNote: string;
  /** Proof links attached at delivery: repos, deploys, recordings, docs. */
  readonly deliveryEvidence: readonly string[];
  /** Set only when a dispute was resolved by an operator. */
  readonly resolutionOutcome: DisputeResolution;
  readonly resolutionNote: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** How an operator closed a dispute: money back to the business or released to the coder. */
export type DisputeResolution = "" | "refunded" | "released";

export interface LedgerEntry {
  readonly id: string;
  readonly engagementId: string;
  readonly kind: LedgerKind;
  readonly amountCents: number;
  readonly currency: string;
  readonly note: string;
  readonly createdAt: string;
}

/**
 * Weights behind the published matching formula. Skills dominate, but the
 * declared interest (the field the coder wants), evidence of past work and
 * declared skill depth all move the score — so a coder who wants the job and
 * can prove it beats a better-on-paper coder who does not.
 */
export const MATCH_WEIGHTS = {
  skills: 0.4,
  interest: 0.15,
  evidence: 0.15,
  availability: 0.1,
  rate: 0.1,
  completeness: 0.05,
  /**
   * A small, honest weight for work that actually happened. Five percent cannot
   * outrank skills or a declared interest, but it breaks near-ties in favour of
   * the coder whose record a business can check.
   */
  reputation: 0.05,
} as const;

export function platformFeeCents(amountCents: number, feeBps = PLATFORM_FEE_BPS): number {
  return Math.round((amountCents * feeBps) / 10_000);
}

export function payoutCents(amountCents: number, feeBps = PLATFORM_FEE_BPS): number {
  return amountCents - platformFeeCents(amountCents, feeBps);
}

export function formatCents(amountCents: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(amountCents / 100);
}

export const MARKETPLACE_ROUTES = {
  home: "/",
  coders: "/coders",
  jobs: "/jobs",
  join: "/join",
  login: "/login",
  dashboard: "/dashboard",
  admin: "/admin",
  health: "/health",
} as const;

export interface ApiError {
  readonly error: string;
  readonly message: string;
}

export const AUTH_CODE_TTL_MINUTES = 15;
export const SESSION_COOKIE = "market_session";
