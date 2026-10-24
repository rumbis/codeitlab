import type { AccountRole, Availability } from "../shared/contracts.ts";

/**
 * Row shapes as they come out of SQLite (snake_case columns are aliased to these
 * camelCase names in the queries). Numbers that stand in for booleans stay
 * numbers here; the mappers in the service modules convert them.
 */
export interface AccountRow {
  readonly id: string;
  readonly email: string;
  readonly role: AccountRole;
  readonly createdAt: string;
}

export interface CoderProfileRow {
  readonly id: string;
  readonly accountId: string;
  readonly displayName: string;
  readonly headline: string;
  readonly bio: string;
  readonly skills: string;
  readonly interests: string;
  readonly skillLevels: string;
  readonly evidence: string;
  readonly availability: Availability;
  readonly rateMinCents: number;
  readonly rateMaxCents: number;
  readonly currency: string;
  readonly timezone: string;
  readonly links: string;
  readonly approved: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BusinessProfileRow {
  readonly id: string;
  readonly accountId: string;
  readonly companyName: string;
  readonly website: string;
  readonly about: string;
  readonly industry: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface JobRow {
  readonly assisted: number;
  readonly id: string;
  readonly businessId: string;
  readonly title: string;
  readonly description: string;
  readonly skills: string;
  readonly category: string;
  readonly budgetMinCents: number;
  readonly budgetMaxCents: number;
  readonly currency: string;
  readonly timeline: string;
  readonly status: "open" | "matched" | "closed";
  readonly createdAt: string;
}

export interface InterestRow {
  readonly id: string;
  readonly jobId: string;
  readonly coderId: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface EngagementRow {
  readonly id: string;
  readonly jobId: string;
  readonly coderId: string;
  readonly businessId: string;
  readonly amountCents: number;
  readonly feeBps: number;
  readonly feeCents: number;
  readonly payoutCents: number;
  readonly currency: string;
  readonly status: import("../shared/contracts.ts").EngagementStatus;
  readonly paymentRef: string;
  readonly deliveryNote: string;
  /** JSON array; parsed by the mapper so a corrupt value degrades to []. */
  readonly deliveryEvidence: string;
  readonly resolutionOutcome: import("../shared/contracts.ts").DisputeResolution;
  readonly resolutionNote: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LedgerRow {
  readonly id: string;
  readonly engagementId: string;
  readonly kind: import("../shared/contracts.ts").LedgerKind;
  readonly amountCents: number;
  readonly currency: string;
  readonly note: string;
  readonly createdAt: string;
}
