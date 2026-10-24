import * as NodeCrypto from "node:crypto";

import type { AppContext } from "./context.ts";
import { execute, queryAll, queryOne } from "./db.ts";
import { assertNoOffPlatformContact } from "./contactGuard.ts";
import { badRequest, conflict, forbidden, notFound } from "./errors.ts";
import { getJob } from "./jobs.ts";
import { notify } from "./notifications.ts";
import type { AccountRow } from "./types.ts";
import { requireId, type Body } from "./validate.ts";

export const MAX_INVITE_MESSAGE_LENGTH = 300;

export interface Invite {
  readonly id: string;
  readonly jobId: string;
  readonly coderId: string;
  readonly businessId: string;
  readonly message: string;
  readonly createdAt: string;
}

export interface InviteWithJob extends Invite {
  readonly jobTitle: string;
  readonly jobStatus: string;
  readonly budgetMinCents: number;
  readonly budgetMaxCents: number;
  readonly currency: string;
  readonly companyName: string;
}

function parseInviteMessage(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw badRequest("Invite message must be text.", "bad_message");
  const message = value.trim();
  if (message.length > MAX_INVITE_MESSAGE_LENGTH) {
    throw badRequest(
      `Keep the invite under ${MAX_INVITE_MESSAGE_LENGTH} characters.`,
      "message_too_long",
    );
  }
  return message;
}

/**
 * An invite is the business reaching out first: it puts the job in front of a
 * ranked coder with a notification, instead of waiting for applications. It is
 * deliberately *not* an application — the coder still decides to apply, so the
 * record of interest stays something the coder declared, not something that was
 * assumed on their behalf.
 */
export function inviteCoder(
  ctx: AppContext,
  account: AccountRow,
  jobId: string,
  body: Body,
): Invite {
  if (account.role !== "business") {
    throw forbidden("Only businesses can invite coders.", "wrong_role");
  }
  const job = getJob(ctx, jobId);
  if (job === null) throw notFound("Job not found.", "job_not_found");
  if (job.businessId !== account.id) {
    throw forbidden("Only the business that posted this job can invite coders.", "wrong_role");
  }
  if (job.status !== "open") {
    throw conflict("This job is no longer accepting invitations.", "job_not_open");
  }
  const coderId = requireId(body, "coderId", "Coder");
  const coder = queryOne<{ id: string; approved: number; account_id: string }>(
    ctx.db,
    "SELECT id, approved, account_id FROM coder_profiles WHERE id = ?",
    [coderId],
  );
  if (coder === undefined) throw notFound("Coder profile not found.", "coder_not_found");
  if (Number(coder.approved) !== 1) {
    throw conflict("This coder is not approved for work yet.", "coder_not_available");
  }
  const existing = queryOne<{ id: string }>(
    ctx.db,
    "SELECT id FROM job_invites WHERE job_id = ? AND coder_id = ?",
    [jobId, coderId],
  );
  if (existing !== undefined) {
    throw conflict("You already invited this coder to this job.", "already_invited");
  }
  const message = parseInviteMessage(body.message);
  assertNoOffPlatformContact(message, "invite");
  const invite: Invite = {
    id: `invite_${NodeCrypto.randomUUID()}`,
    jobId,
    coderId,
    businessId: account.id,
    message,
    createdAt: ctx.now().toISOString(),
  };
  execute(
    ctx.db,
    `INSERT INTO job_invites (id, job_id, coder_id, business_id, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [invite.id, invite.jobId, invite.coderId, invite.businessId, invite.message, invite.createdAt],
  );
  notify(ctx, {
    accountId: coder.account_id,
    kind: "invite",
    message:
      message === ""
        ? `A business invited you to apply: “${job.title}”.`
        : `A business invited you to apply: “${job.title}” — “${message}”`,
    href: `/jobs/${job.id}`,
  });
  return invite;
}

export function listInvitesForCoder(
  ctx: AppContext,
  account: AccountRow,
  limit = 10,
): InviteWithJob[] {
  const capped = Math.min(Math.max(limit, 1), 50);
  return queryAll<InviteWithJob>(
    ctx.db,
    `SELECT i.id, i.job_id AS jobId, i.coder_id AS coderId, i.business_id AS businessId,
            i.message, i.created_at AS createdAt,
            j.title AS jobTitle, j.status AS jobStatus,
            j.budget_min_cents AS budgetMinCents, j.budget_max_cents AS budgetMaxCents,
            j.currency, COALESCE(b.company_name, '') AS companyName
     FROM job_invites i
     JOIN coder_profiles p ON p.id = i.coder_id
     JOIN jobs j ON j.id = i.job_id
     LEFT JOIN business_profiles b ON b.account_id = i.business_id
     WHERE p.account_id = ?
     ORDER BY i.created_at DESC, i.rowid DESC LIMIT ?`,
    [account.id, capped],
  );
}

export function listInvitedCoderIds(ctx: AppContext, jobId: string): Set<string> {
  const rows = queryAll<{ coderId: string }>(
    ctx.db,
    "SELECT coder_id AS coderId FROM job_invites WHERE job_id = ?",
    [jobId],
  );
  return new Set(rows.map((row) => row.coderId));
}

export function getInviteForCoder(
  ctx: AppContext,
  account: AccountRow,
  jobId: string,
): Invite | null {
  return (
    queryOne<Invite>(
      ctx.db,
      `SELECT i.id, i.job_id AS jobId, i.coder_id AS coderId, i.business_id AS businessId,
              i.message, i.created_at AS createdAt
       FROM job_invites i
       JOIN coder_profiles p ON p.id = i.coder_id
       WHERE i.job_id = ? AND p.account_id = ?`,
      [jobId, account.id],
    ) ?? null
  );
}
