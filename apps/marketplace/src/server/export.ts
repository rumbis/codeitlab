import type { AccountRow } from "./types.ts";
import type { AppContext } from "./context.ts";
import { queryAll } from "./db.ts";
import { listEngagements } from "./engagements.ts";
import { listInterestsForCoder, listJobsForBusiness } from "./jobs.ts";
import { listNotifications } from "./notifications.ts";
import { getBusinessProfile, getCoderProfile } from "./profiles.ts";
import { listSessions } from "./sessions.ts";

/**
 * Everything the platform knows about one account, in one JSON file. This is a
 * trust feature, not a debug endpoint: no password material (there is none), no
 * session tokens, and no other account's rows. A person can leave with their
 * data, which is the cheapest way to prove there is no lock-in.
 */
export function exportAccountData(ctx: AppContext, account: AccountRow): Record<string, unknown> {
  const engagements = listEngagements(ctx, account);
  const engagementIds = engagements.map((engagement) => engagement.id);
  const placeholders = engagementIds.map(() => "?").join(", ");
  const ledger =
    engagementIds.length === 0
      ? []
      : queryAll<Record<string, unknown>>(
          ctx.db,
          `SELECT id, engagement_id AS engagementId, kind, amount_cents AS amountCents,
                  currency, note, created_at AS createdAt
           FROM ledger_entries WHERE engagement_id IN (${placeholders})
           ORDER BY created_at ASC`,
          engagementIds,
        );
  const ratings = queryAll<Record<string, unknown>>(
    ctx.db,
    `SELECT r.id, r.engagement_id AS engagementId, r.score, r.comment, r.created_at AS createdAt
     FROM ratings r
     WHERE r.business_id = ?
        OR r.coder_id IN (SELECT id FROM coder_profiles WHERE account_id = ?)
     ORDER BY r.created_at ASC`,
    [account.id, account.id],
  );

  return {
    exportedAt: ctx.now().toISOString(),
    account: {
      id: account.id,
      email: account.email,
      role: account.role,
      createdAt: account.createdAt,
    },
    profile:
      account.role === "coder"
        ? getCoderProfile(ctx, account.id)
        : getBusinessProfile(ctx, account.id),
    jobs: account.role === "business" ? listJobsForBusiness(ctx, account.id) : [],
    applications: account.role === "coder" ? listInterestsForCoder(ctx, account) : [],
    engagements,
    ledger,
    ratings,
    notifications: listNotifications(ctx, account.id, 100),
    sessions: listSessions(ctx, account.id, ""),
  };
}
