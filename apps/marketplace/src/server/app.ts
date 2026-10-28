import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  JOB_CATEGORIES,
  type AccountRole,
  type Engagement,
  type JobCategory,
} from "../shared/contracts.ts";
import { renderAdmin, renderAdminGate } from "../pages/admin.ts";
import { deleteAccount } from "./accountDeletion.ts";
import { listSessions, revokeAllSessions, revokeOtherSessions, revokeSession } from "./sessions.ts";
import { createReport, listReports, openReportCount, resolveReport } from "./reports.ts";
import {
  drainPush,
  pushKeysFromEnv,
  pushStatus,
  removePushSubscription,
  savePushSubscription,
} from "./push.ts";
import { renderCoders } from "../pages/coders.ts";
import { renderReport } from "../pages/report.ts";
import { renderNumbers } from "../pages/numbers.ts";
import { renderCoderProfile } from "../pages/coderProfile.ts";
import { renderDashboard } from "../pages/dashboard.ts";
import { errorPage } from "../pages/layout.ts";
import { renderHome } from "../pages/home.ts";
import { renderHowItWorks } from "../pages/howItWorks.ts";
import { renderJob } from "../pages/job.ts";
import { renderReceipt } from "../pages/receipt.ts";
import { renderJobs } from "../pages/jobs.ts";
import { renderJoin } from "../pages/join.ts";
import { renderLogin } from "../pages/login.ts";
import {
  adminLedger,
  listAdminAudit,
  recordAdminAction,
  requireAdmin,
  searchAccounts,
  suspendAccount,
  unsuspendAccount,
} from "./admin.ts";
import { autoReleaseDaysFromEnv, runAutoRelease } from "./autoRelease.ts";
import { backupDatabase } from "./backup.ts";
import { runDeliveryReminders } from "./reminders.ts";
import { createCoderAlert, deleteCoderAlert, runCoderAlerts } from "./coderAlerts.ts";
import { createSavedSearch, deleteSavedSearch, runJobAlerts } from "./savedSearches.ts";
import { exportAccountData } from "./export.ts";
import {
  authenticate,
  clearedSessionCookie,
  clientIp,
  findAccountById,
  logout,
  readCredentials,
  readLoginCode,
  requestCode,
  sessionCookieFor,
  type AuthSession,
  verifyCode,
} from "./auth.ts";
import type { AppContext } from "./context.ts";
import { openDatabase, queryAll, queryOne, type Db } from "./db.ts";
import { reviewAssistedDelivery } from "./assisted.ts";
import { resolveDispute } from "./disputes.ts";
import {
  listNotifications,
  markNotificationsRead,
  setEmailNotificationPreference,
  unreadNotificationCount,
} from "./notifications.ts";
import { drainOutbox, outboxStatus } from "./outbox.ts";
import {
  createDefaultMailTransport,
  drainMail,
  mailOutboxStatus,
  type MailTransport,
} from "./mail.ts";
import { saveAssistedScope, setShortlist } from "./assistedJobs.ts";
import { inviteCoder } from "./invites.ts";
import { rateEngagement } from "./ratings.ts";
import { consumeRateLimit } from "./ratelimit.ts";
import {
  renderRobotsTxt,
  renderSecurityPolicy,
  renderSecurityTxt,
  renderSitemap,
} from "./wellknown.ts";
import { rateLimitsFromEnv } from "./ratelimit.ts";
import {
  PWA_ICON_SVG,
  renderAppScript,
  renderManifest,
  renderOfflinePage,
  renderServiceWorker,
} from "./pwa.ts";
import {
  createEngagement,
  getEngagement,
  ledgerForEngagement,
  listEngagements,
  transitionEngagement,
  type EngagementAction,
} from "./engagements.ts";
import { HttpError, badRequest, conflict, notFound, unauthorized } from "./errors.ts";
import {
  MAX_BODY_BYTES,
  errorMessage,
  htmlResponse,
  jsonResponse,
  normalizeBasePath,
  readBody,
  redirectResponse,
  stripBasePath,
  toInternalLocation,
  withNotice,
  type ParsedBody,
} from "./http.ts";
import {
  addInterest,
  closeJob,
  createJob,
  getJob,
  listInterests,
  listOpenJobs,
  reopenJob,
  repeatSourceFor,
} from "./jobs.ts";
import { layout, pageUrl } from "../pages/layout.ts";
import { rankCoders } from "./matching.ts";
import { createPaymentProvider, type PaymentProvider } from "./payments.ts";
import { toCsv } from "./csv.ts";
import { reconcileLedger } from "./reconcile.ts";
import { parseWebhookEvent, recordWebhookEvent, verifyWebhookSignature } from "./webhook.ts";
import { questsFor } from "./quests.ts";
import { adminCookieHeader, assertSameOrigin, securityHeaders } from "./security.ts";
import {
  approveCoder,
  findCoderRowById,
  getBusinessProfile,
  listApprovedCoders,
  toCoderProfile,
  upsertBusinessProfile,
  upsertCoderProfile,
} from "./profiles.ts";
import type { AccountRow } from "./types.ts";
import {
  listEngagementMessages,
  postEngagementMessage,
  type MessageAuthorRole,
} from "./engagementMessages.ts";
import { createApiToken, listApiTokens, resolveBearerAccount, revokeApiToken } from "./tokens.ts";

export interface CreateAppOptions {
  readonly dbPath: string;
  /** Defaults to MARKETPLACE_BACKUP_DIR or `<db dir>/backups`. */
  readonly backupDir?: string;
  readonly basePath?: string;
  readonly baseUrl?: string;
  readonly adminToken?: string;
  readonly trustProxy?: boolean;
  readonly notifyWebhook?: string;
  readonly notifySecret?: string;
  readonly mailTransport?: import("./mail.ts").MailTransport;
  readonly push?: import("./push.ts").PushKeys | null;
  readonly rateLimits?: Partial<import("./ratelimit.ts").RateLimitConfig>;
  readonly paymentProvider?: PaymentProvider;
  readonly now?: () => Date;
  readonly onDevCode?: (email: string, code: string) => void;
  readonly devEmail?: boolean;
  readonly autoApprove?: boolean;
  readonly autoReleaseDays?: number;
  readonly cookieSecure?: boolean;
  readonly webhookSecret?: string;
}

export interface SweepSummary {
  readonly reminders: number;
  readonly alerts: number;
  readonly coderAlerts: number;
  readonly released: number;
  readonly failed: number;
}

export interface AppHandler {
  (request: Request): Promise<Response>;
  readonly db: Db;
  /** One maintenance pass: reminders, job alerts and stale-delivery release. */
  sweep(): Promise<SweepSummary>;
  close(): void;
}

interface DispatchInput {
  readonly ctx: AppContext;
  readonly request: Request;
  readonly url: URL;
  readonly path: string;
  readonly method: string;
  readonly session: AuthSession | null;
}

const ENGAGEMENT_ACTIONS = new Set<EngagementAction>([
  "accept",
  "start",
  "deliver",
  "approve",
  "cancel",
  "dispute",
]);

const ACTION_NOTICES: Readonly<Record<EngagementAction, string>> = {
  accept: "Engagement accepted.",
  start: "Work started.",
  deliver: "Delivery recorded. Waiting for the business to approve.",
  approve: "Approved. The payout and platform fee are recorded.",
  cancel: "Engagement cancelled and the charge refunded.",
  dispute: "Dispute raised. The money stays in escrow.",
};

function publicAccount(account: AccountRow): {
  id: string;
  email: string;
  role: AccountRole;
  createdAt: string;
} {
  return { id: account.id, email: account.email, role: account.role, createdAt: account.createdAt };
}

function ensureMethod(method: string, allowed: readonly string[]): void {
  if (!allowed.includes(method)) {
    throw new HttpError(405, "method_not_allowed", `Use ${allowed.join(" or ")}.`);
  }
}

function requireAccount(session: AuthSession | null): AccountRow {
  if (session === null) throw unauthorized();
  return session.account;
}

interface EngagementListItem extends Engagement {
  /** Which side of the engagement the requesting account is on. */
  readonly role: MessageAuthorRole;
  readonly jobTitle: string;
  readonly counterpartName: string;
}

/**
 * The same engagement row is returned to both sides, so the list names the
 * other party and the job it came from. That saves a client one request per
 * engagement to render "hired by Acme".
 */
function engagementListItem(
  ctx: AppContext,
  account: AccountRow,
  engagement: Engagement,
): EngagementListItem {
  const job = getJob(ctx, engagement.jobId);
  if (engagement.businessId === account.id) {
    const row = findCoderRowById(ctx, engagement.coderId);
    const coder = row === undefined ? null : toCoderProfile(row);
    const coderEmail = coder === null ? "" : (findAccountById(ctx, coder.accountId)?.email ?? "");
    return {
      ...engagement,
      role: "business",
      jobTitle: job?.title ?? "Job removed",
      counterpartName: coder?.displayName.trim() || coderEmail || "Coder",
    };
  }
  const business = getBusinessProfile(ctx, engagement.businessId);
  const businessEmail = findAccountById(ctx, engagement.businessId)?.email ?? "";
  return {
    ...engagement,
    role: "coder",
    jobTitle: job?.title ?? "Job removed",
    counterpartName: business?.companyName.trim() || businessEmail || "Business",
  };
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice("bearer ".length).trim()
    : "";
}

function isAdminPath(path: string): boolean {
  return (
    path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/admin" ||
    path.startsWith("/api/admin/")
  );
}

/**
 * One account context for both a browser session and an API token. Admin routes
 * are exempt: requireAdmin() owns the same Authorization header, including its
 * rate limit on wrong tokens, so it must see the raw request untouched.
 */
function requestSession(ctx: AppContext, request: Request, path: string): AuthSession | null {
  const session = authenticate(ctx, request);
  if (isAdminPath(path)) return session;
  const token = bearerToken(request);
  if (token === "") return session;
  const account = resolveBearerAccount(ctx, token);
  if (account === null) {
    throw unauthorized("This API token is invalid or was revoked.", "unauthorized");
  }
  // An API token is not a device session, so there is no id or expiry to report.
  return { account, sessionId: "", expiresAt: "" };
}

function parseLimit(url: URL, fallback: number): number {
  const raw = url.searchParams.get("limit");
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, 100);
}

function parseSkillsQuery(url: URL): string[] {
  const raw = url.searchParams.get("skills") ?? "";
  return raw
    .split(",")
    .map((skill) => skill.trim())
    .filter((skill) => skill !== "");
}

let cachedStyles: string | null = null;

function stylesCss(): string {
  if (cachedStyles === null) {
    cachedStyles = NodeFS.readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  }
  return cachedStyles;
}

export function createApp(options: CreateAppOptions): AppHandler {
  const db = openDatabase(options.dbPath);
  const devEmail = options.devEmail ?? (process.env.MARKETPLACE_DEV_EMAIL ?? "1") !== "0";
  const onDevCode =
    options.onDevCode ??
    (devEmail
      ? (email: string, code: string) => {
          // Development only: the code is the one secret this service may log.
          console.log(`[marketplace] login code for ${email}: ${code}`);
        }
      : undefined);

  const mail: MailTransport =
    options.mailTransport ??
    (options.onDevCode !== undefined
      ? {
          // The caller took over delivery (tests, embedders): keep the outbox quiet.
          name: "caller",
          send: () => Promise.resolve(),
        }
      : createDefaultMailTransport(devEmail));
  if (!devEmail && options.onDevCode === undefined && mail.name === "none") {
    throw new Error(
      "MARKETPLACE_DEV_EMAIL=0 requires MARKETPLACE_MAIL_TRANSPORT (webhook) and MARKETPLACE_MAIL_WEBHOOK, otherwise login codes have no way to reach a user.",
    );
  }

  const ctx: AppContext = {
    db,
    dbPath: options.dbPath,
    backupDir:
      options.backupDir ??
      process.env.MARKETPLACE_BACKUP_DIR ??
      NodePath.join(NodePath.dirname(NodePath.resolve(options.dbPath)), "backups"),
    basePath: normalizeBasePath(options.basePath ?? process.env.MARKETPLACE_BASE_PATH),
    baseUrl: (
      options.baseUrl ??
      process.env.MARKETPLACE_BASE_URL ??
      "https://codeitlab.com/market"
    ).replace(/\/+$/u, ""),
    adminToken: options.adminToken ?? process.env.MARKETPLACE_ADMIN_TOKEN ?? "",
    trustProxy: options.trustProxy ?? process.env.MARKETPLACE_TRUST_PROXY === "1",
    notifyWebhook: options.notifyWebhook ?? process.env.MARKETPLACE_NOTIFY_WEBHOOK ?? "",
    notifySecret: options.notifySecret ?? process.env.MARKETPLACE_NOTIFY_SECRET ?? "",
    mail,
    push: options.push === undefined ? pushKeysFromEnv() : options.push,
    rateLimits: { ...rateLimitsFromEnv(), ...options.rateLimits },
    payments:
      options.paymentProvider ?? createPaymentProvider(process.env.PAYMENTS_PROVIDER ?? "mock"),
    now: options.now ?? (() => new Date()),
    onDevCode,
    autoApprove: options.autoApprove ?? process.env.MARKETPLACE_AUTO_APPROVE === "1",
    autoReleaseDays: options.autoReleaseDays ?? autoReleaseDaysFromEnv(),
    cookieSecure: options.cookieSecure ?? process.env.MARKETPLACE_COOKIE_SECURE === "1",
    webhookSecret: options.webhookSecret ?? process.env.PAYMENTS_WEBHOOK_SECRET ?? "",
  };

  let closed = false;

  function respond(input: {
    readonly request: Request;
    readonly parsed: ParsedBody;
    readonly payload: unknown;
    readonly status?: number;
    readonly fallbackRedirect: string;
    readonly notice?: string;
    readonly headers?: Record<string, string>;
  }): Response {
    if (input.parsed.isForm) {
      const candidate =
        typeof input.parsed.data.redirectTo === "string"
          ? input.parsed.data.redirectTo
          : input.request.headers.get("referer");
      const location = withNotice(
        toInternalLocation(ctx.basePath, input.request.url, candidate, input.fallbackRedirect),
        input.notice,
      );
      return redirectResponse(location, input.headers);
    }
    return jsonResponse(input.payload, input.status ?? 200, input.headers);
  }

  function errorResponse(
    request: Request,
    path: string,
    session: AuthSession | null,
    error: unknown,
  ): Response {
    const isApi = path === "/api" || path.startsWith("/api/");
    if (error instanceof HttpError) {
      if (isApi) {
        return jsonResponse({ error: error.code, message: error.message }, error.status);
      }
      return htmlResponse(
        errorPage({
          basePath: ctx.basePath,
          account: session?.account ?? null,
          status: error.status,
          title: httpTitle(error.status),
          message: error.message,
        }),
        error.status,
      );
    }

    console.error("[marketplace] unhandled error:", errorMessage(error));
    if (isApi) {
      return jsonResponse({ error: "internal_error", message: "Something went wrong." }, 500);
    }
    return htmlResponse(
      errorPage({
        basePath: ctx.basePath,
        account: session?.account ?? null,
        status: 500,
        title: "Something went wrong",
        message: "The marketplace hit an unexpected error. Try again.",
      }),
      500,
    );
  }

  async function dispatchApi(input: DispatchInput, parsed: ParsedBody): Promise<Response> {
    const { ctx: context, request, url, path, method, session } = input;
    const segments = path.split("/").filter((segment) => segment !== "");
    // segments[0] is "api"

    if (segments[1] === "health") {
      ensureMethod(method, ["GET", "HEAD"]);
      return jsonResponse({ ok: true, service: "marketplace", time: context.now().toISOString() });
    }

    if (segments[1] === "auth") {
      if (segments[2] === "request-code") {
        ensureMethod(method, ["POST"]);
        const credentials = readCredentials(parsed.data);
        const result = await requestCode(context, {
          email: credentials.email,
          role: credentials.role,
          ip: clientIp(request, context.trustProxy),
        });
        return respond({
          request,
          parsed,
          payload: {
            ok: true,
            email: result.account.email,
            role: result.account.role,
            expiresAt: result.expiresAt,
          },
          fallbackRedirect: `/login?email=${encodeURIComponent(result.account.email)}`,
          notice: "We sent a login code to your email.",
        });
      }
      if (segments[2] === "verify") {
        ensureMethod(method, ["POST"]);
        const credentials = readLoginCode(parsed.data);
        const result = verifyCode(context, {
          ...credentials,
          userAgent: request.headers.get("user-agent") ?? "",
        });
        return respond({
          request,
          parsed,
          payload: { account: publicAccount(result.account), expiresAt: result.expiresAt },
          fallbackRedirect: "/dashboard",
          notice: "You are signed in.",
          headers: { "set-cookie": sessionCookieFor(context, result.token) },
        });
      }
      if (segments[2] === "logout") {
        ensureMethod(method, ["POST"]);
        logout(context, request);
        return respond({
          request,
          parsed,
          payload: { ok: true },
          fallbackRedirect: "/",
          notice: "Signed out.",
          headers: { "set-cookie": clearedSessionCookie(context) },
        });
      }
      if (segments[2] === "sessions") {
        const account = requireAccount(session);
        if (session === null) throw unauthorized("Log in to manage sessions.", "unauthorized");
        const current = session;
        if (segments[3] === undefined) {
          ensureMethod(method, ["GET", "HEAD"]);
          return jsonResponse({ sessions: listSessions(context, account.id, current.sessionId) });
        }
        if (segments[3] === "revoke-others") {
          ensureMethod(method, ["POST"]);
          const revoked = revokeOtherSessions(context, account.id, current.sessionId);
          return respond({
            request,
            parsed,
            payload: { revoked },
            fallbackRedirect: "/dashboard",
            notice:
              revoked === 0
                ? "No other devices were signed in."
                : `Signed out ${revoked} other device${revoked === 1 ? "" : "s"}.`,
          });
        }
        if (segments[3] !== undefined && segments[4] === "revoke") {
          ensureMethod(method, ["POST"]);
          revokeSession(context, account.id, segments[3], current.sessionId);
          return respond({
            request,
            parsed,
            payload: { revoked: true },
            fallbackRedirect: "/dashboard",
            notice: "That device is signed out.",
          });
        }
        throw notFound("Unknown session endpoint.", "not_found");
      }
      if (segments[2] === "tokens") {
        const account = requireAccount(session);
        if (segments[3] === undefined) {
          if (method === "POST") {
            const created = createApiToken(context, account, parsed.data.label);
            return jsonResponse(
              {
                token: created.token,
                id: created.record.id,
                label: created.record.label,
                createdAt: created.record.createdAt,
              },
              201,
            );
          }
          ensureMethod(method, ["GET", "HEAD"]);
          const tokens = listApiTokens(context, account.id);
          return jsonResponse({ tokens, count: tokens.length });
        }
        if (segments[4] === undefined) {
          ensureMethod(method, ["DELETE"]);
          revokeApiToken(context, account.id, segments[3]);
          return jsonResponse({ revoked: true });
        }
        throw notFound("Unknown token endpoint.", "not_found");
      }

      throw notFound("Unknown auth endpoint.", "not_found");
    }

    if (segments[1] === "coders") {
      if (segments[2] === "profile") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        const coder = upsertCoderProfile(context, account, parsed.data);
        return respond({
          request,
          parsed,
          payload: { coder },
          fallbackRedirect: "/dashboard",
          notice: "Coder profile saved.",
        });
      }
      if (segments[2] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        const coders = listApprovedCoders(context, {
          skills: parseSkillsQuery(url),
          limit: parseLimit(url, 50),
        });
        return jsonResponse({ coders, count: coders.length });
      }
      throw notFound("Unknown coder endpoint.", "not_found");
    }

    if (segments[1] === "business" && segments[2] === "profile") {
      ensureMethod(method, ["POST"]);
      const account = requireAccount(session);
      const profile = upsertBusinessProfile(context, account, parsed.data);
      return respond({
        request,
        parsed,
        payload: { business: profile },
        fallbackRedirect: "/dashboard",
        notice: "Business profile saved.",
      });
    }

    if (segments[1] === "me" && segments[2] === "export") {
      ensureMethod(method, ["GET", "HEAD"]);
      const account = requireAccount(session);
      return jsonResponse(exportAccountData(context, account), 200, {
        "content-disposition": 'attachment; filename="codeitlab-account.json"',
      });
    }

    if (segments[1] === "me" && segments[2] === "delete") {
      ensureMethod(method, ["POST"]);
      const account = requireAccount(session);
      deleteAccount(context, account, parsed.data);
      return respond({
        request,
        parsed,
        payload: { deleted: true },
        fallbackRedirect: "/",
        notice:
          "Your account was deleted. The ledger keeps the money record without your personal data.",
      });
    }

    if (segments[1] === "saved-searches") {
      if (segments[2] === undefined) {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        createSavedSearch(context, account, parsed.data);
        return respond({
          request,
          parsed,
          payload: { saved: true },
          fallbackRedirect: "/jobs",
          notice: "Search saved. You will be told when new jobs match it.",
        });
      }
      if (segments[3] === "delete") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        deleteSavedSearch(context, account.id, segments[2]);
        return respond({
          request,
          parsed,
          payload: { deleted: true },
          fallbackRedirect: "/dashboard",
          notice: "Saved search removed.",
        });
      }
      throw notFound("Unknown saved-search endpoint.", "not_found");
    }

    if (segments[1] === "coder-alerts") {
      if (segments[2] === undefined) {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        createCoderAlert(context, account, parsed.data);
        return respond({
          request,
          parsed,
          payload: { watching: true },
          fallbackRedirect: "/dashboard",
          notice: "Watching. You will be told when a coder who fits is approved.",
        });
      }
      if (segments[3] === "delete") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        deleteCoderAlert(context, account.id, segments[2]);
        return respond({
          request,
          parsed,
          payload: { deleted: true },
          fallbackRedirect: "/dashboard",
          notice: "Coder alert removed.",
        });
      }
      throw notFound("Unknown coder-alert endpoint.", "not_found");
    }

    if (segments[1] === "jobs") {
      if (segments[2] === undefined) {
        if (method === "POST") {
          const account = requireAccount(session);
          const job = createJob(context, account, parsed.data);
          // "Hire again" from a settled engagement: post a fresh job and put it
          // in front of the same coder in one step. A failed invite (already
          // invited, coder paused) must not undo the published job.
          const repeatId =
            typeof parsed.data.repeatEngagementId === "string"
              ? parsed.data.repeatEngagementId.trim()
              : "";
          const repeat = repeatSourceFor(context, account.id, repeatId);
          if (repeat !== null) {
            try {
              inviteCoder(context, account, job.id, {
                coderId: repeat.coderId,
                message: "You worked with us before — this is the same kind of work. Have a look.",
              });
            } catch {
              // The job is published either way; the business can invite again.
            }
          }
          return respond({
            request,
            parsed,
            payload: { job },
            status: 201,
            fallbackRedirect: `/jobs/${job.id}`,
            notice:
              repeat === null
                ? "Job published."
                : "Job published and your previous coder was invited.",
          });
        }
        ensureMethod(method, ["GET", "HEAD"]);
        const rawCategory = url.searchParams.get("category") ?? "";
        const category = (JOB_CATEGORIES as readonly string[]).includes(rawCategory)
          ? (rawCategory as JobCategory)
          : "";
        const minBudget = Number(url.searchParams.get("minBudget") ?? "");
        const jobs = listOpenJobs(context, parseLimit(url, 50), {
          query: url.searchParams.get("q") ?? "",
          category,
          minBudgetCents:
            Number.isFinite(minBudget) && minBudget > 0 ? Math.round(minBudget * 100) : 0,
        });
        return jsonResponse({ jobs, count: jobs.length });
      }

      const jobId = segments[2];
      if (segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        const job = getJob(context, jobId);
        if (job === null) throw notFound("Job not found.", "job_not_found");
        return jsonResponse({ job });
      }
      if (segments[3] === "matches") {
        ensureMethod(method, ["GET", "HEAD"]);
        const account = requireAccount(session);
        const job = getJob(context, jobId);
        if (job === null) throw notFound("Job not found.", "job_not_found");
        if (job.businessId !== account.id) {
          throw new HttpError(
            403,
            "forbidden",
            "Only the business that posted this job can see matches.",
          );
        }
        const matches = rankCoders(context, job, parseLimit(url, 10));
        return jsonResponse({ jobId: job.id, matches, count: matches.length });
      }
      if (segments[3] === "invite") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        consumeRateLimit(
          context,
          `invite:${account.id}`,
          context.rateLimits.invitePerHour,
          "Too many invitations in the last hour. Wait before trying again.",
        );
        const invite = inviteCoder(context, account, jobId, parsed.data);
        return respond({
          request,
          parsed,
          payload: { invite },
          fallbackRedirect: `/jobs/${jobId}`,
          notice: "Invitation sent. The coder still chooses whether to apply.",
        });
      }
      if (segments[3] === "close" || segments[3] === "reopen") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        const job =
          segments[3] === "close"
            ? closeJob(context, account, jobId)
            : reopenJob(context, account, jobId);
        return respond({
          request,
          parsed,
          payload: { job },
          fallbackRedirect: "/dashboard",
          notice:
            segments[3] === "close"
              ? "Job closed. It is no longer listed and accepts no applications."
              : "Job reopened. It is listed again and accepts applications.",
        });
      }
      if (segments[3] === "interests") {
        if (method === "POST") {
          const account = requireAccount(session);
          const interest = addInterest(context, account, jobId, parsed.data);
          return respond({
            request,
            parsed,
            payload: { interest },
            status: 201,
            fallbackRedirect: `/jobs/${jobId}`,
            notice: "Application sent.",
          });
        }
        ensureMethod(method, ["GET", "HEAD"]);
        const account = requireAccount(session);
        const interests = listInterests(context, account, jobId);
        return jsonResponse({ jobId, interests, count: interests.length });
      }
      throw notFound("Unknown job endpoint.", "not_found");
    }

    if (segments[1] === "engagements") {
      if (segments[2] === undefined) {
        if (method === "POST") {
          const account = requireAccount(session);
          const engagement = await createEngagement(context, account, parsed.data);
          return respond({
            request,
            parsed,
            payload: { engagement },
            status: 201,
            fallbackRedirect: `/jobs/${engagement.jobId}`,
            notice: "Escrow charged and engagement requested.",
          });
        }
        ensureMethod(method, ["GET", "HEAD"]);
        const account = requireAccount(session);
        const engagements = listEngagements(context, account).map((engagement) =>
          engagementListItem(context, account, engagement),
        );
        return jsonResponse({ engagements, count: engagements.length });
      }

      const engagementId = segments[2];
      const action = segments[3];
      if (action === "messages") {
        const account = requireAccount(session);
        if (method === "POST") {
          const message = postEngagementMessage(context, account, engagementId, parsed.data);
          return respond({
            request,
            parsed,
            payload: { message },
            status: 201,
            fallbackRedirect: "/dashboard",
            notice: "Message sent.",
          });
        }
        ensureMethod(method, ["GET", "HEAD"]);
        const messages = listEngagementMessages(
          context,
          account,
          engagementId,
          url.searchParams.get("after") ?? undefined,
        );
        return jsonResponse({ messages, count: messages.length });
      }
      if (action === "rating") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        const rating = rateEngagement(context, account, engagementId, parsed.data);
        return respond({
          request,
          parsed,
          payload: { rating },
          fallbackRedirect: "/dashboard",
          notice: "Rating saved — thank you for making the directory more useful.",
        });
      }
      if (action !== undefined && ENGAGEMENT_ACTIONS.has(action as EngagementAction)) {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        const engagement = await transitionEngagement(
          context,
          account,
          engagementId,
          action as EngagementAction,
          action === "deliver"
            ? { note: parsed.data.deliveryNote, evidence: parsed.data.deliveryEvidence }
            : undefined,
        );
        return respond({
          request,
          parsed,
          payload: { engagement },
          fallbackRedirect: "/dashboard",
          notice: ACTION_NOTICES[action as EngagementAction],
        });
      }
      throw notFound("Unknown engagement endpoint.", "not_found");
    }

    if (segments[1] === "quests" && segments[2] === undefined) {
      ensureMethod(method, ["GET", "HEAD"]);
      const account = requireAccount(session);
      return jsonResponse(questsFor(context, account));
    }

    if (segments[1] === "notifications") {
      const account = requireAccount(session);
      if (segments[2] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        const notifications = listNotifications(context, account.id, parseLimit(url, 20));
        return jsonResponse({
          notifications,
          unread: unreadNotificationCount(context, account.id),
        });
      }
      if (segments[2] === "preferences") {
        ensureMethod(method, ["POST"]);
        const raw = parsed.data.emailNotifications;
        const enabled = raw === true || raw === "on" || raw === "1" || raw === "true";
        setEmailNotificationPreference(context, account.id, enabled);
        return respond({
          request,
          parsed,
          payload: { emailNotifications: enabled },
          fallbackRedirect: "/dashboard",
          notice: enabled
            ? "Email notifications are on for invitations, deliveries, approvals and disputes."
            : "Email notifications are off.",
        });
      }
      if (segments[2] === "read") {
        ensureMethod(method, ["POST"]);
        const marked = markNotificationsRead(context, account.id);
        return respond({
          request,
          parsed,
          payload: { marked },
          fallbackRedirect: "/dashboard",
          notice: marked === 0 ? "Nothing new." : "Activity marked as read.",
        });
      }
      throw notFound("Unknown notification endpoint.", "not_found");
    }

    if (segments[1] === "reports" && segments[2] === undefined) {
      ensureMethod(method, ["POST"]);
      const account = requireAccount(session);
      const report = createReport(context, account, {
        targetKind: parsed.data.targetKind,
        targetId: parsed.data.targetId,
        reason: parsed.data.reason,
        detail: parsed.data.detail,
      });
      return respond({
        request,
        parsed,
        payload: { report },
        status: 201,
        fallbackRedirect:
          report.targetKind === "job" ? `/jobs/${report.targetId}` : `/coders/${report.targetId}`,
        notice: "Report sent. An operator will review it and you will hear back.",
      });
    }

    if (segments[1] === "push") {
      if (segments[2] === "key" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        return jsonResponse({
          enabled: context.push !== null,
          publicKey: context.push?.publicKey ?? "",
        });
      }
      if (segments[2] === "subscribe") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        const endpoint = parsed.data.endpoint;
        const keys = parsed.data.keys;
        if (typeof endpoint !== "string" || typeof keys !== "object" || keys === null) {
          throw badRequest(
            "A push subscription needs an endpoint and keys.",
            "invalid_subscription",
          );
        }
        const keyRecord = keys as Record<string, unknown>;
        const p256dh = keyRecord.p256dh;
        const auth = keyRecord.auth;
        let parsedEndpoint: URL;
        try {
          parsedEndpoint = new URL(endpoint);
        } catch {
          throw badRequest("The push endpoint must be a URL.", "invalid_subscription");
        }
        if (parsedEndpoint.protocol !== "https:" && parsedEndpoint.protocol !== "http:") {
          throw badRequest("The push endpoint must be http(s).", "invalid_subscription");
        }
        const decodeKey = (value: unknown, bytes: number, name: string): string => {
          if (typeof value !== "string" || value === "") {
            throw badRequest(`Missing ${name} key.`, "invalid_subscription");
          }
          const decoded = Buffer.from(value, "base64url");
          if (decoded.byteLength !== bytes) {
            throw badRequest(`${name} key has the wrong length.`, "invalid_subscription");
          }
          return value;
        };
        savePushSubscription(context, account.id, {
          endpoint,
          p256dh: decodeKey(p256dh, 65, "p256dh"),
          auth: decodeKey(auth, 16, "auth"),
        });
        return jsonResponse({ ok: true }, 201);
      }
      if (segments[2] === "unsubscribe") {
        ensureMethod(method, ["POST"]);
        const account = requireAccount(session);
        if (typeof parsed.data.endpoint !== "string") {
          throw badRequest("Which endpoint should be removed?", "invalid_subscription");
        }
        const removed = removePushSubscription(context, account.id, parsed.data.endpoint);
        return jsonResponse({ removed });
      }
      throw notFound("Unknown push endpoint.", "not_found");
    }

    if (segments[1] === "admin") {
      if (segments[2] === "auto-release" && segments[3] === "run") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const result = await runAutoRelease(context);
        return respond({
          request,
          parsed,
          payload: result,
          fallbackRedirect: "/admin",
          notice:
            result.days === 0
              ? "Auto-release is disabled (MARKETPLACE_AUTO_RELEASE_DAYS=0)."
              : `Released ${result.released} engagement${result.released === 1 ? "" : "s"}${result.failed === 0 ? "." : `; ${result.failed} failed and will retry.`}`,
        });
      }
      if (segments[2] === "ledger.csv" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        const rows = queryAll<{
          id: string;
          createdAt: string;
          engagementId: string;
          kind: string;
          amountCents: number;
          currency: string;
          note: string;
        }>(
          context.db,
          `SELECT id, created_at AS createdAt, engagement_id AS engagementId, kind,
                  amount_cents AS amountCents, currency, note
           FROM ledger_entries ORDER BY created_at ASC, rowid ASC`,
        );
        const csv = toCsv(
          ["entry_id", "created_at", "engagement_id", "kind", "amount_cents", "currency", "note"],
          rows.map((row) => [
            row.id,
            row.createdAt,
            row.engagementId,
            row.kind,
            Number(row.amountCents),
            row.currency,
            row.note,
          ]),
        );
        return new Response(csv, {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": 'attachment; filename="codeitlab-ledger.csv"',
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
          },
        });
      }
      if (segments[2] === "backup" && segments[3] === "run") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        if (context.dbPath === ":memory:") {
          throw conflict(
            "This process uses an in-memory database, so there is nothing to back up.",
            "in_memory_database",
          );
        }
        const result = backupDatabase(context.dbPath, context.backupDir, context.now());
        recordAdminAction(context, {
          action: "backup.run",
          targetId: result.path,
          detail: `${String(result.bytes)} bytes, schema ${String(result.schemaVersion)}, integrity ${result.integrity}`,
        });
        return respond({
          request,
          parsed,
          payload: result,
          status: result.integrity === "ok" ? 200 : 500,
          fallbackRedirect: "/admin",
          notice:
            result.integrity === "ok"
              ? `Backup written to ${result.path} and verified.`
              : `Backup is not usable: ${result.integrity}`,
        });
      }
      if (segments[2] === "reconcile" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        return jsonResponse(reconcileLedger(context));
      }
      if (segments[2] === "accounts" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        const query = url.searchParams.get("q") ?? "";
        return jsonResponse({ query, accounts: searchAccounts(context, query) });
      }
      if (
        segments[2] === "accounts" &&
        segments[3] !== undefined &&
        segments[4] === "revoke-sessions"
      ) {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const target = findAccountById(context, segments[3]);
        if (target === undefined) throw notFound("No such account.", "account_not_found");
        const revoked = revokeAllSessions(context, target.id);
        recordAdminAction(context, {
          action: "account.sessions_revoked",
          targetId: target.id,
          detail: `${revoked} session${revoked === 1 ? "" : "s"}`,
        });
        return jsonResponse({ accountId: target.id, revoked });
      }
      if (segments[2] === "job-alerts" && segments[3] === "run") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const result = runJobAlerts(context);
        return respond({
          request,
          parsed,
          payload: result,
          fallbackRedirect: "/admin",
          notice:
            result.notified === 0
              ? "No saved search had new matches."
              : `Notified ${result.notified} saved search${result.notified === 1 ? "" : "es"}.`,
        });
      }
      if (segments[2] === "coder-alerts" && segments[3] === "run") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const result = runCoderAlerts(context);
        return respond({
          request,
          parsed,
          payload: result,
          fallbackRedirect: "/admin",
          notice:
            result.notified === 0
              ? "No coder alert had new matches."
              : `Notified ${result.notified} coder alert${result.notified === 1 ? "" : "s"}.`,
        });
      }
      if (segments[2] === "reminders" && segments[3] === "run") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const result = runDeliveryReminders(context);
        return respond({
          request,
          parsed,
          payload: result,
          fallbackRedirect: "/admin",
          notice:
            result.reminded === 0
              ? "No deliveries are waiting on a review right now."
              : `Sent ${result.reminded} waiting-delivery reminder${result.reminded === 1 ? "" : "s"}.`,
        });
      }
      if (segments[2] === "accounts" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        const query = url.searchParams.get("q") ?? "";
        return jsonResponse({ query, accounts: searchAccounts(context, query) });
      }
      if (
        segments[2] === "accounts" &&
        segments[3] !== undefined &&
        (segments[4] === "suspend" || segments[4] === "unsuspend")
      ) {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        if (segments[4] === "suspend") {
          const reason = typeof parsed.data.reason === "string" ? parsed.data.reason.trim() : "";
          if (reason.length < 3) {
            throw badRequest("Give a reason of at least 3 characters.", "reason_required");
          }
          const result = suspendAccount(context, segments[3], reason);
          return respond({
            request,
            parsed,
            payload: result,
            fallbackRedirect: "/admin",
            notice: "Account suspended and every device signed out.",
          });
        }
        const result = unsuspendAccount(context, segments[3]);
        return respond({
          request,
          parsed,
          payload: result,
          fallbackRedirect: "/admin",
          notice: "Account restored. The person can sign in again.",
        });
      }
      if (segments[2] === "ledger" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        return jsonResponse(adminLedger(context));
      }
      if (segments[2] === "disputes" && segments[3] !== undefined && segments[4] === "resolve") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const engagement = await resolveDispute(
          context,
          segments[3],
          parsed.data.outcome,
          parsed.data.note,
        );
        return respond({
          request,
          parsed,
          payload: { engagement },
          fallbackRedirect: "/admin",
          notice:
            engagement.resolutionOutcome === "refunded"
              ? "Dispute resolved: escrow refunded to the business."
              : "Dispute resolved: escrow released to the coder.",
        });
      }
      if (segments[2] === "assisted" && segments[3] === "jobs" && segments[4] !== undefined) {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const jobId = segments[4];
        if (segments[5] === "scope") {
          const scope = saveAssistedScope(context, jobId, parsed.data.note);
          return respond({
            request,
            parsed,
            payload: { scope },
            fallbackRedirect: "/admin",
            notice: "Scope note saved and the business was notified.",
          });
        }
        if (segments[5] === "shortlist") {
          const coderIds = setShortlist(context, jobId, parsed.data.coderIds);
          return respond({
            request,
            parsed,
            payload: { coderIds },
            fallbackRedirect: "/admin",
            notice: "Shortlist saved; the business and the coders were notified.",
          });
        }
        throw notFound("Unknown assisted job endpoint.", "not_found");
      }
      if (segments[2] === "assisted" && segments[3] !== undefined && segments[4] === "review") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const engagement = reviewAssistedDelivery(context, segments[3], parsed.data.note);
        return respond({
          request,
          parsed,
          payload: { engagement },
          fallbackRedirect: "/admin",
          notice: "Review recorded. Escrow still moves only on approval or a dispute decision.",
        });
      }
      if (segments[2] === "mail" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        return jsonResponse(mailOutboxStatus(context));
      }
      if (segments[2] === "mail" && segments[3] === "drain") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        return jsonResponse(await drainMail(context));
      }
      if (segments[2] === "reports" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        const status = url.searchParams.get("status");
        const reports = listReports(context, {
          status: status === "resolved" || status === "all" ? status : "open",
          limit: parseLimit(url, 50),
        });
        return jsonResponse({ reports, count: reports.length, open: openReportCount(context) });
      }
      if (segments[2] === "reports" && segments[3] !== undefined && segments[4] === "resolve") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const report = resolveReport(
          context,
          segments[3],
          parsed.data.resolution,
          parsed.data.note,
        );
        return respond({
          request,
          parsed,
          payload: { report },
          fallbackRedirect: "/admin",
          notice:
            report.resolution === "dismissed"
              ? "Report dismissed; the reporter was notified."
              : "Report resolved; the target was actioned and the reporter was notified.",
        });
      }
      if (segments[2] === "push" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        return jsonResponse(pushStatus(context));
      }
      if (segments[2] === "push" && segments[3] === "drain") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        return jsonResponse(await drainPush(context));
      }
      if (segments[2] === "outbox" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        return jsonResponse(outboxStatus(context));
      }
      if (segments[2] === "outbox" && segments[3] === "drain") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        return jsonResponse(await drainOutbox(context));
      }
      if (segments[2] === "audit" && segments[3] === undefined) {
        ensureMethod(method, ["GET", "HEAD"]);
        requireAdmin(context, request, url);
        const entries = listAdminAudit(context, parseLimit(url, 100));
        return jsonResponse({ entries, count: entries.length });
      }
      if (segments[2] === "coders" && segments[3] !== undefined && segments[4] === "approve") {
        ensureMethod(method, ["POST"]);
        requireAdmin(context, request, url);
        const coder = approveCoder(context, segments[3]);
        recordAdminAction(context, {
          action: "coder.approve",
          targetId: coder.id,
          detail: `Approved ${coder.displayName}`,
        });
        return respond({
          request,
          parsed,
          payload: { coder },
          fallbackRedirect: "/admin",
          notice: `${coder.displayName} approved.`,
        });
      }
      throw notFound("Unknown admin endpoint.", "not_found");
    }

    throw notFound("Unknown API endpoint.", "not_found");
  }

  /**
   * Payment-provider webhook. The raw body is read before any parsing because
   * the signature covers the exact bytes; the event is stored once and a replay
   * is acknowledged as a duplicate instead of being processed twice.
   */
  async function handlePaymentWebhook(request: Request): Promise<Response> {
    if (ctx.webhookSecret === "") {
      throw new HttpError(
        503,
        "webhook_disabled",
        "Set PAYMENTS_WEBHOOK_SECRET to accept payment webhooks.",
      );
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      throw new HttpError(413, "payload_too_large", "Request body is too large.");
    }
    const header = request.headers.get("stripe-signature") ?? "";
    const valid = verifyWebhookSignature({
      payload: raw,
      header,
      secret: ctx.webhookSecret,
      nowSeconds: Math.floor(ctx.now().getTime() / 1000),
    });
    if (!valid) {
      throw new HttpError(400, "invalid_signature", "Invalid webhook signature.");
    }
    const event = parseWebhookEvent(raw);
    const result = recordWebhookEvent(ctx, {
      provider: ctx.payments.name,
      event,
      payload: raw,
    });
    return jsonResponse({ received: true, duplicate: result.duplicate, eventId: event.id });
  }

  async function dispatch(input: DispatchInput): Promise<Response> {
    const { ctx: context, url, path, method, session } = input;
    const isGet = method === "GET" || method === "HEAD";
    const segments = path.split("/").filter((segment) => segment !== "");

    if (path === "/health") {
      ensureMethod(method, ["GET", "HEAD"]);
      // The schema version is the cheapest readiness signal: a load balancer that
      // sees a new build answer with an old migration has a database problem, not
      // a network one.
      const schema = queryOne<{ version: number | null }>(
        context.db,
        "SELECT MAX(version) AS version FROM schema_migrations",
      );
      return jsonResponse({
        ok: true,
        service: "marketplace",
        time: context.now().toISOString(),
        schemaVersion: Number(schema?.version ?? 0),
      });
    }

    if (path === "/robots.txt") {
      ensureMethod(method, ["GET", "HEAD"]);
      return new Response(renderRobotsTxt(context.basePath, context.baseUrl), {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    if (path === "/sitemap.xml") {
      ensureMethod(method, ["GET", "HEAD"]);
      const hrefs = [
        "/",
        "/jobs",
        "/coders",
        "/how-it-works",
        "/numbers",
        "/security",
        ...listOpenJobs(context, 500).map((job) => `/jobs/${job.id}`),
        ...listApprovedCoders(context, { limit: 100 }).map((coder) => `/coders/${coder.id}`),
      ].map((href) => pageUrl(context.basePath, href));
      return new Response(renderSitemap(hrefs, context.baseUrl), {
        status: 200,
        headers: {
          "content-type": "application/xml; charset=utf-8",
          "cache-control": "public, max-age=600",
        },
      });
    }

    if (path === "/.well-known/security.txt") {
      ensureMethod(method, ["GET", "HEAD"]);
      return new Response(renderSecurityTxt(context), {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=3600",
        },
      });
    }

    if (path === "/security") {
      ensureMethod(method, ["GET", "HEAD"]);
      return htmlResponse(
        layout({
          basePath: context.basePath,
          baseUrl: context.baseUrl,
          canonicalPath: "/security",
          title: "Security policy",
          account: session?.account ?? null,
          content: renderSecurityPolicy(context),
        }),
      );
    }

    if (path === "/styles.css") {
      ensureMethod(method, ["GET", "HEAD"]);
      return new Response(stylesCss(), {
        status: 200,
        headers: {
          "content-type": "text/css; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    // Installable app shell: static-only assets, no account HTML in any cache.
    if (path === "/manifest.webmanifest") {
      ensureMethod(method, ["GET", "HEAD"]);
      return new Response(renderManifest(context), {
        status: 200,
        headers: {
          "content-type": "application/manifest+json; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    if (path === "/icon.svg") {
      ensureMethod(method, ["GET", "HEAD"]);
      return new Response(PWA_ICON_SVG, {
        status: 200,
        headers: {
          "content-type": "image/svg+xml; charset=utf-8",
          "cache-control": "public, max-age=86400",
        },
      });
    }

    if (path === "/app.js") {
      ensureMethod(method, ["GET", "HEAD"]);
      return new Response(renderAppScript(context), {
        status: 200,
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    if (path === "/sw.js") {
      ensureMethod(method, ["GET", "HEAD"]);
      return new Response(renderServiceWorker(context), {
        status: 200,
        headers: {
          // The worker must be revalidated so a new version can take over.
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
          "service-worker-allowed": pageUrl(context.basePath, "/"),
        },
      });
    }

    if (path === "/offline") {
      ensureMethod(method, ["GET", "HEAD"]);
      return htmlResponse(renderOfflinePage(context));
    }

    if (
      segments[0] === "api" &&
      segments[1] === "payments" &&
      segments[2] === "webhook" &&
      segments[3] === undefined
    ) {
      ensureMethod(method, ["POST"]);
      return handlePaymentWebhook(input.request);
    }

    if (segments[0] === "api") {
      return dispatchApi(input, await readBody(input.request));
    }

    if (!isGet) throw new HttpError(405, "method_not_allowed", "Use GET.");

    if (path === "/") return htmlResponse(renderHome(context, session?.account ?? null, url));
    if (path === "/coders")
      return htmlResponse(renderCoders(context, session?.account ?? null, url));
    if (path === "/report")
      return htmlResponse(renderReport(context, session?.account ?? null, url));
    if (path === "/numbers")
      return htmlResponse(renderNumbers(context, session?.account ?? null, url));
    const coderProfileMatch = /^\/coders\/([^/]+)$/u.exec(path);
    if (coderProfileMatch !== null && coderProfileMatch[1] !== undefined) {
      const row = findCoderRowById(context, coderProfileMatch[1]);
      if (row === undefined) throw notFound("Coder not found.", "coder_not_found");
      const profile = toCoderProfile(row);
      const isOwner = session?.account?.id === profile.accountId;
      if (!profile.approved && !isOwner) throw notFound("Coder not found.", "coder_not_found");
      return htmlResponse(renderCoderProfile(context, session?.account ?? null, url, profile));
    }
    if (path === "/jobs") return htmlResponse(renderJobs(context, session?.account ?? null, url));
    if (path === "/how-it-works")
      return htmlResponse(renderHowItWorks(context, session?.account ?? null, url));
    if (path === "/join") return htmlResponse(renderJoin(context, session?.account ?? null, url));
    if (path === "/login") return htmlResponse(renderLogin(context, session?.account ?? null, url));
    if (path === "/dashboard") {
      return htmlResponse(
        renderDashboard(context, session?.account ?? null, url, session?.sessionId ?? ""),
      );
    }

    if (
      segments[0] === "engagements" &&
      segments[1] !== undefined &&
      segments[2] === "receipt" &&
      segments[3] === undefined
    ) {
      const account = requireAccount(session);
      const engagement = getEngagement(context, segments[1]);
      // Participants only, and a 404 rather than a 403 so a stranger cannot
      // confirm that an engagement id exists. `listEngagements` already answers
      // "is this mine" for both roles (the coder side is joined through the
      // profile, the business side by account id).
      const mine =
        engagement !== null &&
        listEngagements(context, account).some((item) => item.id === engagement.id);
      if (engagement === null || !mine) {
        throw notFound("Engagement not found.", "engagement_not_found");
      }
      const job = getJob(context, engagement.jobId);
      const coderRow = findCoderRowById(context, engagement.coderId);
      const coder = coderRow === undefined ? null : toCoderProfile(coderRow);
      const business = getBusinessProfile(context, engagement.businessId);
      const coderAccount = coder === null ? undefined : findAccountById(context, coder.accountId);
      const businessAccount = findAccountById(context, engagement.businessId);
      return htmlResponse(
        renderReceipt({
          ctx: context,
          account,
          engagement,
          jobTitle: job?.title ?? "Job removed",
          businessName: business?.companyName || businessAccount?.email || "Business account",
          coderName: coder?.displayName || coderAccount?.email || "Coder account",
          ledger: ledgerForEngagement(context, engagement.id),
        }),
      );
    }

    if (segments[0] === "jobs" && segments[1] !== undefined && segments[2] === undefined) {
      const job = getJob(context, segments[1]);
      if (job === null) throw notFound("Job not found.", "job_not_found");
      return htmlResponse(renderJob(context, session?.account ?? null, url, job));
    }

    if (path === "/admin") {
      try {
        requireAdmin(context, input.request, url);
      } catch (error) {
        if (error instanceof HttpError && error.code === "admin_unauthorized") {
          return htmlResponse(renderAdminGate(context, session?.account ?? null), 401);
        }
        throw error;
      }
      // Trade the ?token= once for a short-lived HttpOnly cookie, so the token
      // is not repeated in every form action in the page.
      return htmlResponse(
        renderAdmin(context, session?.account ?? null, adminLedger(context), url),
        200,
        {
          "set-cookie": adminCookieHeader(context),
          "referrer-policy": "no-referrer",
          "x-robots-tag": "noindex, nofollow",
        },
      );
    }

    throw notFound("Page not found.", "not_found");
  }

  /** Every response leaves through here, so no handler can forget the headers. */
  function withSecurityHeaders(response: Response): Response {
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(securityHeaders(ctx))) {
      if (!headers.has(key)) headers.set(key, value);
    }
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  const handler = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const path = stripBasePath(url.pathname, ctx.basePath);
    const method = request.method.toUpperCase();
    let session: AuthSession | null = null;
    try {
      // Reject a cross-site form post before it can touch a handler.
      assertSameOrigin(ctx, request);
      session = requestSession(ctx, request, path);
      return withSecurityHeaders(await dispatch({ ctx, url, path, method, session, request }));
    } catch (error) {
      return withSecurityHeaders(errorResponse(request, path, session, error));
    }
  };

  return Object.assign(handler, {
    db,
    async sweep(): Promise<SweepSummary> {
      const reminders = runDeliveryReminders(ctx).reminded;
      const alerts = runJobAlerts(ctx).notified;
      const coderAlerts = runCoderAlerts(ctx).notified;
      const release = await runAutoRelease(ctx);
      return {
        reminders,
        alerts,
        coderAlerts,
        released: release.released,
        failed: release.failed,
      };
    },
    close: () => {
      if (closed) return;
      closed = true;
      db.close();
    },
  });
}

function httpTitle(status: number): string {
  switch (status) {
    case 400:
      return "Check the form";
    case 401:
      return "Sign in required";
    case 403:
      return "Not allowed";
    case 404:
      return "Not found";
    case 405:
      return "Method not allowed";
    case 409:
      return "That action is not available";
    case 413:
      return "Request too large";
    case 415:
      return "Unsupported request";
    case 429:
      return "Slow down";
    default:
      return "Something went wrong";
  }
}
