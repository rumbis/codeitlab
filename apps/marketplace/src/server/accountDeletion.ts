import type { AppContext } from "./context.ts";
import { execute, queryOne, transaction } from "./db.ts";
import { conflict } from "./errors.ts";
import type { AccountRow } from "./types.ts";
import type { Body } from "./validate.ts";

export const DELETION_CONFIRMATION = "delete";

const ACTIVE_STATUSES = "'requested', 'accepted', 'in_progress', 'delivered', 'disputed'";

/**
 * Deleting an account is a privacy action, not a money action. Escrow has to be
 * settled first (an active engagement is someone waiting on a person who is about
 * to disappear), but once it is, the account's personal data goes: the email is
 * replaced, the profile is hidden and emptied, sessions and push subscriptions
 * are removed, open jobs are closed. The ledger rows and the engagements stay —
 * they are the accounting record and they never contained the email — so a
 * deleted account still balances. Signing in with the old address later creates a
 * brand-new account, which is the honest outcome: nothing is restored.
 */
export function deleteAccount(ctx: AppContext, account: AccountRow, body: Body): void {
  if (body.confirm !== DELETION_CONFIRMATION) {
    throw conflict(
      `Type ${DELETION_CONFIRMATION} in the confirmation box to delete your account.`,
      "confirmation_required",
    );
  }
  const active = queryOne<{ n: number }>(
    ctx.db,
    `SELECT COUNT(*) AS n FROM engagements e
     LEFT JOIN coder_profiles p ON p.id = e.coder_id
     WHERE (e.business_id = ? OR p.account_id = ?) AND e.status IN (${ACTIVE_STATUSES})`,
    [account.id, account.id],
  );
  if (active !== undefined && Number(active.n) > 0) {
    throw conflict(
      "You have an active engagement. Finish or cancel it first, then delete the account.",
      "active_engagements",
    );
  }

  const deletedAt = ctx.now().toISOString();
  transaction(ctx.db, () => {
    execute(ctx.db, "UPDATE jobs SET status = 'closed' WHERE business_id = ? AND status = 'open'", [
      account.id,
    ]);
    execute(
      ctx.db,
      `UPDATE coder_profiles
       SET approved = 0, display_name = 'Former member', headline = '', bio = '', skills = '', links = '[]',
           availability = 'not_available', updated_at = ?
       WHERE account_id = ?`,
      [deletedAt, account.id],
    );
    execute(
      ctx.db,
      `UPDATE business_profiles SET company_name = 'Former business', website = '', about = '', updated_at = ?
       WHERE account_id = ?`,
      [deletedAt, account.id],
    );
    execute(ctx.db, "DELETE FROM sessions WHERE account_id = ?", [account.id]);
    execute(ctx.db, "DELETE FROM push_subscriptions WHERE account_id = ?", [account.id]);
    execute(ctx.db, "DELETE FROM saved_searches WHERE account_id = ?", [account.id]);
    execute(
      ctx.db,
      `UPDATE accounts
       SET email = ?, deleted_at = ?, suspended_at = NULL, suspended_reason = ''
       WHERE id = ?`,
      [`deleted+${account.id}@deleted.invalid`, deletedAt, account.id],
    );
  });
}
