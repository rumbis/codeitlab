import type { AppContext } from "./context.ts";
import { queryAll } from "./db.ts";

export type ReputationLevel = "new" | "proven" | "trusted" | "expert";

export type ReputationBadgeId =
  | "first_delivery"
  | "evidence_backed"
  | "repeat_clients"
  | "dispute_free";

export interface ReputationBadge {
  readonly id: ReputationBadgeId;
  readonly label: string;
  /** Why this badge exists, in one sentence: the lesson, not the trophy. */
  readonly lesson: string;
  readonly earned: boolean;
}

/** Facts read from the ledger of real engagements; nothing here is stored. */
export interface ReputationSummary {
  readonly completedEngagements: number;
  readonly earnedCents: number;
  readonly evidenceDeliveries: number;
  readonly disputes: number;
  readonly repeatClients: number;
}

export interface Reputation extends ReputationSummary {
  readonly level: ReputationLevel;
  readonly levelLabel: string;
  /** What the level actually means, in plain words. */
  readonly levelNote: string;
  readonly badges: readonly ReputationBadge[];
  /** The next thing that changes the record, phrased as an outcome. */
  readonly nextMilestone: string;
  readonly currency: string;
}

const LEVEL_LABELS: Record<ReputationLevel, string> = {
  new: "New",
  proven: "Proven",
  trusted: "Trusted",
  expert: "Expert",
};

/**
 * Reputation is derived from money that actually moved and evidence that was
 * actually attached, so a coder cannot buy, claim or reset it. A refunded
 * dispute is the only thing that can lower it, and only by removing the
 * dispute-free badge — the completed work stays true.
 */
export function reputationFrom(summary: ReputationSummary, currency: string): Reputation {
  const level: ReputationLevel =
    summary.completedEngagements >= 8 && summary.disputes === 0
      ? "expert"
      : summary.completedEngagements >= 3 && summary.evidenceDeliveries >= 1
        ? "trusted"
        : summary.completedEngagements >= 1
          ? "proven"
          : "new";

  const levelNote =
    level === "new"
      ? "No paid delivery yet. The first one is what turns a profile into a record."
      : level === "proven"
        ? "A business paid for work you delivered. That is the first fact nobody can take back."
        : level === "trusted"
          ? "Three paid deliveries, at least one with evidence. Businesses can check instead of hoping."
          : "Eight paid deliveries and no refunded dispute. A record built from work, not from claims.";

  const nextMilestone =
    level === "new"
      ? "Finish one paid delivery to become Proven."
      : level === "proven"
        ? "Reach three paid deliveries with at least one evidence link to become Trusted."
        : level === "trusted"
          ? "Reach eight paid deliveries with no refunded dispute to become Expert."
          : "You are at the top tier. Keep attaching evidence — that is what keeps the record clean.";

  const badges: ReputationBadge[] = [
    {
      id: "first_delivery",
      label: "First delivery",
      lesson:
        "One paid delivery proves the escrow path is real: the money existed before the work did.",
      earned: summary.completedEngagements >= 1,
    },
    {
      id: "evidence_backed",
      label: "Evidence backed",
      lesson: "Three deliveries carried proof links. Approval stops being a leap of faith.",
      earned: summary.evidenceDeliveries >= 3,
    },
    {
      id: "repeat_clients",
      label: "Repeat client",
      lesson: "A business came back. Repeat work is the cheapest form of trust.",
      earned: summary.repeatClients >= 1,
    },
    {
      id: "dispute_free",
      label: "Dispute free",
      lesson:
        "Three or more paid deliveries with no refunded dispute. Not a score — a clean record.",
      earned: summary.completedEngagements >= 3 && summary.disputes === 0,
    },
  ];

  return {
    ...summary,
    level,
    levelLabel: LEVEL_LABELS[level],
    levelNote,
    badges,
    nextMilestone,
    currency,
  };
}

interface SummaryRow {
  readonly coderId: string;
  readonly completedEngagements: number;
  readonly earnedCents: number;
  readonly evidenceDeliveries: number;
  readonly disputes: number;
}

interface RepeatRow {
  readonly coderId: string;
  readonly repeats: number;
}

/**
 * Load the summaries for many coders in two queries instead of one per card,
 * so the directory stays cheap to render.
 */
export function loadReputationSummaries(
  ctx: AppContext,
  coderIds: readonly string[],
): Map<string, ReputationSummary> {
  const summaries = new Map<string, ReputationSummary>();
  if (coderIds.length === 0) return summaries;
  const placeholders = coderIds.map(() => "?").join(", ");

  const rows = queryAll<SummaryRow>(
    ctx.db,
    `SELECT coder_id AS coderId,
            SUM(CASE WHEN status = 'paid_out' THEN 1 ELSE 0 END) AS completedEngagements,
            SUM(CASE WHEN status = 'paid_out' THEN payout_cents ELSE 0 END) AS earnedCents,
            SUM(CASE WHEN status IN ('delivered', 'paid_out')
                      AND delivery_evidence NOT IN ('[]', '') THEN 1 ELSE 0 END) AS evidenceDeliveries,
            SUM(CASE WHEN status = 'disputed' OR resolution_outcome = 'refunded'
                     THEN 1 ELSE 0 END) AS disputes
     FROM engagements
     WHERE coder_id IN (${placeholders})
     GROUP BY coder_id`,
    [...coderIds],
  );
  for (const row of rows) {
    summaries.set(row.coderId, {
      completedEngagements: Number(row.completedEngagements),
      earnedCents: Number(row.earnedCents),
      evidenceDeliveries: Number(row.evidenceDeliveries),
      disputes: Number(row.disputes),
      repeatClients: 0,
    });
  }

  const repeats = queryAll<RepeatRow>(
    ctx.db,
    `SELECT coder_id AS coderId, COUNT(*) AS repeats FROM (
       SELECT coder_id, business_id FROM engagements
       WHERE status = 'paid_out' AND coder_id IN (${placeholders})
       GROUP BY coder_id, business_id HAVING COUNT(*) >= 2
     ) GROUP BY coder_id`,
    [...coderIds],
  );
  for (const row of repeats) {
    const existing = summaries.get(row.coderId);
    if (existing !== undefined) {
      summaries.set(row.coderId, { ...existing, repeatClients: Number(row.repeats) });
    }
  }

  return summaries;
}

export function reputationForCoder(ctx: AppContext, coderId: string, currency: string): Reputation {
  const summary = loadReputationSummaries(ctx, [coderId]).get(coderId) ?? {
    completedEngagements: 0,
    earnedCents: 0,
    evidenceDeliveries: 0,
    disputes: 0,
    repeatClients: 0,
  };
  return reputationFrom(summary, currency);
}
