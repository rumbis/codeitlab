import { CodeItLabServiceError } from "@codeitlab/core";
import {
  deliveryDraftNote,
  deliveryEvidenceProblem,
  deliveryHandoffNote,
  deliveryNoteProblem,
  engagementMessageProblem,
  engagementNextStep,
  isHttpUrl,
  normalizeMarketplaceUrl,
  ENGAGEMENT_MAX_EVIDENCE,
  type CodeItLabDeliveryDraft,
  type CodeItLabDeliveryDraftInput,
  type CodeItLabDeliveryHandoff,
  type CodeItLabDeliveryHandoffInput,
  type CodeItLabDeliveryFile,
  type CodeItLabDeliveryInput,
  type CodeItLabDeliveryResult,
  type CodeItLabEngagement,
  type CodeItLabEngagementApplyToJobInput,
  type CodeItLabEngagementApplyToJobResult,
  type CodeItLabProfilePublishInput,
  type CodeItLabProfilePublishResult,
  type CodeItLabEngagementTransitionInput,
  type CodeItLabEngagementTransitionResult,
  type CodeItLabEngagementBridge,
  type CodeItLabEngagementConfigureInput,
  type CodeItLabEngagementList,
  type CodeItLabEngagementMessage,
  type CodeItLabEngagementMessageInput,
  type CodeItLabEngagementMessageResult,
  type CodeItLabEngagementMessages,
  type CodeItLabEngagementMessagesInput,
  type CodeItLabMarketplaceSettings,
} from "@codeitlab/core/engagements";
import { EngagementsService as EngagementsServiceTag } from "@codeitlab/core/services";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as GitManager from "../../git/GitManager.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ProjectionStoreV2 from "../../orchestration-v2/ProjectionStore.ts";
import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as TextGeneration from "../../textGeneration/TextGeneration.ts";

/**
 * The bridge to the user's own marketplace deployment.
 *
 * The app is a client of a service the user already runs: it reads engagements
 * and posts into the engagement thread with the URL and API token the user
 * configured. It never holds money, never changes an engagement status and never
 * decides a release — those stay on the marketplace. When the URL, the token or
 * the opt-in is missing, every read returns a read-only bridge with a reason so
 * the panel can explain itself instead of showing an empty list.
 */

const TOKEN_SECRET = "codeitlab.marketplace.token";
const REQUEST_TIMEOUT_MS = 10_000;

interface HttpJsonInput {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly token: string;
  readonly body?: unknown;
  readonly timeoutMs: number;
}

interface HttpJsonResult {
  readonly status: number;
  readonly text: string;
}

const serviceError = (operation: string, message: string, cause?: unknown) =>
  new CodeItLabServiceError({ operation, message, ...(cause === undefined ? {} : { cause }) });

/**
 * Exported so a test can drive the timeout with a fake client: the service
 * injects its HTTP call, so a hanging marketplace would otherwise be
 * untestable without a socket.
 */
export const makeHttpJson =
  (client: HttpClient.HttpClient) =>
  (input: HttpJsonInput): Effect.Effect<HttpJsonResult, CodeItLabServiceError> =>
    Effect.gen(function* () {
      const base =
        input.method === "GET"
          ? HttpClientRequest.get(input.url)
          : HttpClientRequest.post(input.url);
      const authorized = HttpClientRequest.bearerToken(input.token)(base);
      const request =
        input.body === undefined
          ? authorized
          : yield* HttpClientRequest.bodyJson(authorized, input.body);
      const response = yield* client.execute(request).pipe(Effect.timeout(input.timeoutMs));
      const text = yield* response.text;
      return { status: response.status, text } satisfies HttpJsonResult;
    }).pipe(
      Effect.mapError((cause) =>
        serviceError("engagements.request", "Could not reach the marketplace.", cause),
      ),
    );

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const text = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const number = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const messageOf = (body: unknown): string => {
  const record = asRecord(body);
  return text(record?.["message"], "");
};

const evidenceOf = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const toMessage = (value: unknown): CodeItLabEngagementMessage | null => {
  const record = asRecord(value);
  if (record === undefined) return null;
  const id = text(record["id"]);
  if (id === "") return null;
  const role = text(record["authorRole"]) === "business" ? "business" : "coder";
  return {
    id,
    engagementId: text(record["engagementId"]),
    authorRole: role,
    authorName: text(record["authorName"]),
    body: text(record["body"]),
    evidence: evidenceOf(record["evidence"]),
    createdAt: text(record["createdAt"]),
  };
};

const toEngagement = (value: unknown): CodeItLabEngagement | null => {
  const record = asRecord(value);
  if (record === undefined) return null;
  const id = text(record["id"]);
  if (id === "") return null;
  const role = text(record["role"]) === "business" ? "business" : "coder";
  const status = text(record["status"], "requested");
  const known = [
    "requested",
    "accepted",
    "in_progress",
    "delivered",
    "approved",
    "paid_out",
    "cancelled",
    "disputed",
  ] as const;
  const safeStatus = (known as ReadonlyArray<string>).includes(status)
    ? (status as (typeof known)[number])
    : "requested";
  return {
    id,
    jobTitle: text(record["jobTitle"], "Untitled engagement"),
    role,
    counterpartName: text(record["counterpartName"], "the other side"),
    status: safeStatus,
    amountCents: number(record["amountCents"]),
    currency: text(record["currency"], "USD"),
    nextStep: engagementNextStep(role, safeStatus),
    updatedAt: text(record["updatedAt"]),
  };
};

export interface EngagementsServiceDeps {
  readonly readSettings: Effect.Effect<CodeItLabMarketplaceSettings, CodeItLabServiceError>;
  readonly writeSettings: (
    next: CodeItLabMarketplaceSettings,
  ) => Effect.Effect<void, CodeItLabServiceError>;
  readonly readToken: Effect.Effect<string | null, CodeItLabServiceError>;
  readonly writeToken: (token: string | null) => Effect.Effect<void, CodeItLabServiceError>;
  readonly nowMs: Effect.Effect<number>;
  /**
   * A thread id to its working tree. The server resolves it from the project and
   * thread records, so a delivery draft never trusts a path from the client.
   */
  readonly resolveThreadWorkspace: (threadId: string) => Effect.Effect<
    {
      readonly cwd: string;
      readonly title: string;
      /** The thread's own selection, so a handoff can be written without asking. */
      readonly modelSelection?: { readonly instanceId: string; readonly model: string } | null;
    } | null,
    CodeItLabServiceError
  >;
  /**
   * Writes the client-facing handoff through the app's text generation. Omitted
   * in tests and in builds without a provider registry, where the deterministic
   * note is returned with a reason instead.
   */
  readonly generateHandoff?: (input: {
    readonly cwd: string;
    readonly engagementTitle: string;
    readonly deliveryNote: string;
    readonly amountLabel: string;
    readonly modelSelection: { readonly instanceId: string; readonly model: string };
  }) => Effect.Effect<{ readonly summary: string; readonly body: string }, CodeItLabServiceError>;
  /** The git facts behind a delivery: changed files, line counts, branch. */
  readonly readDeliveryFiles: (cwd: string) => Effect.Effect<
    {
      readonly isRepo: boolean;
      readonly files: ReadonlyArray<CodeItLabDeliveryFile>;
      readonly insertions: number;
      readonly deletions: number;
      readonly branch: string | null;
    },
    CodeItLabServiceError
  >;
  /** Overridable in tests so no test ever touches the network. */
  readonly httpJson?: (
    input: HttpJsonInput,
  ) => Effect.Effect<HttpJsonResult, CodeItLabServiceError>;
}

export const makeEngagementsService = (
  deps: EngagementsServiceDeps,
): EngagementsServiceTag["Service"] => {
  const httpJson = deps.httpJson;
  const request = (input: HttpJsonInput) =>
    httpJson === undefined
      ? Effect.fail(serviceError("engagements.request", "No HTTP client configured."))
      : httpJson(input);

  const bridgeFrom = (
    settings: CodeItLabMarketplaceSettings,
    token: string | null,
  ): CodeItLabEngagementBridge => {
    const url = normalizeMarketplaceUrl(settings.url);
    const configured = url !== "" && token !== null && token !== "";
    const enabled = settings.enabled;
    const readOnly = !configured || !enabled;
    const reason =
      url === ""
        ? "No marketplace URL is configured yet. Add the URL of your own deployment in Settings → CodeItLab → Engagements."
        : token === null || token === ""
          ? "Add an API token from your marketplace deployment; without it the app can only show this panel."
          : !enabled
            ? "The marketplace bridge is turned off. Turn it on to read engagements and send messages."
            : "";
    return {
      url,
      configured,
      tokenPresent: token !== null && token !== "",
      enabled,
      readOnly,
      reason,
    };
  };

  const context = Effect.gen(function* () {
    const settings = yield* deps.readSettings;
    const token = yield* deps.readToken;
    const nowMs = yield* deps.nowMs;
    return { settings, token, bridge: bridgeFrom(settings, token), nowMs };
  });

  const bridge = context.pipe(Effect.map((current) => current.bridge));

  /** The honest shortcut: a read-only bridge answers from local state, no request. */
  const readOnlyResult = <A>(bridge: CodeItLabEngagementBridge, fallback: A): A | null =>
    bridge.readOnly ? fallback : null;

  const list = Effect.gen(function* () {
    const current = yield* context;
    const fetchedAt = DateTime.formatIso(DateTime.makeUnsafe(current.nowMs));
    const short = readOnlyResult(current.bridge, {
      bridge: current.bridge,
      engagements: [],
      fetchedAt,
    } satisfies CodeItLabEngagementList);
    if (short !== null) return short;
    const token = current.token ?? "";
    const response = yield* request({
      method: "GET",
      url: current.bridge.url + "/api/engagements",
      token,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).pipe(
      Effect.catch((cause) =>
        Effect.succeed({ status: 0, text: "", cause } satisfies HttpJsonResult & {
          cause: unknown;
        }),
      ),
    );
    if (response.status === 0) {
      return {
        bridge: {
          ...current.bridge,
          readOnly: true,
          reason:
            "Could not reach " + current.bridge.url + "; the panel is read-only until it answers.",
        },
        engagements: [],
        fetchedAt,
      } satisfies CodeItLabEngagementList;
    }
    const body = parseJson(response.text);
    if (response.status !== 200) {
      return {
        bridge: {
          ...current.bridge,
          readOnly: true,
          reason:
            "The marketplace answered " +
            response.status +
            (messageOf(body) === "" ? "" : ": " + messageOf(body)) +
            ".",
        },
        engagements: [],
        fetchedAt,
      } satisfies CodeItLabEngagementList;
    }
    const rows = Array.isArray(asRecord(body)?.["engagements"])
      ? (asRecord(body)?.["engagements"] as ReadonlyArray<unknown>)
      : [];
    const engagements = rows
      .map(toEngagement)
      .filter((entry): entry is CodeItLabEngagement => entry !== null);
    return { bridge: current.bridge, engagements, fetchedAt } satisfies CodeItLabEngagementList;
  }).pipe(Effect.withSpan("Engagements.list"));

  const messages = Effect.fn("Engagements.messages")(function* (
    input: CodeItLabEngagementMessagesInput,
  ) {
    const current = yield* context;
    const fetchedAt = DateTime.formatIso(DateTime.makeUnsafe(current.nowMs));
    const engagementId = input.engagementId.trim();
    if (engagementId === "") {
      return yield* Effect.fail(
        serviceError("engagements.messages", "An engagement id is required."),
      );
    }
    if (current.bridge.readOnly) {
      return {
        engagementId,
        bridge: current.bridge,
        messages: [],
        fetchedAt,
      } satisfies CodeItLabEngagementMessages;
    }
    const query = input.after === undefined ? "" : "?after=" + encodeURIComponent(input.after);
    const token = current.token ?? "";
    const response = yield* request({
      method: "GET",
      url:
        current.bridge.url +
        "/api/engagements/" +
        encodeURIComponent(engagementId) +
        "/messages" +
        query,
      token,
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).pipe(Effect.catch(() => Effect.succeed({ status: 0, text: "" } satisfies HttpJsonResult)));
    const body = parseJson(response.text);
    if (response.status !== 200) {
      return {
        engagementId,
        bridge: {
          ...current.bridge,
          readOnly: true,
          reason:
            response.status === 0
              ? "Could not reach " + current.bridge.url + "."
              : "The marketplace refused this thread (" + response.status + ").",
        },
        messages: [],
        fetchedAt,
      } satisfies CodeItLabEngagementMessages;
    }
    const rows = Array.isArray(asRecord(body)?.["messages"])
      ? (asRecord(body)?.["messages"] as ReadonlyArray<unknown>)
      : [];
    return {
      engagementId,
      bridge: current.bridge,
      messages: rows
        .map(toMessage)
        .filter((entry): entry is CodeItLabEngagementMessage => entry !== null),
      fetchedAt,
    } satisfies CodeItLabEngagementMessages;
  });

  const postMessage = Effect.fn("Engagements.postMessage")(function* (
    input: CodeItLabEngagementMessageInput,
  ) {
    const current = yield* context;
    const engagementId = input.engagementId.trim();
    const problem = engagementMessageProblem(input.body);
    const evidence = input.evidence
      .filter((entry) => isHttpUrl(entry))
      .slice(0, ENGAGEMENT_MAX_EVIDENCE);
    const refusal = (reason: string): CodeItLabEngagementMessageResult => ({
      posted: false,
      message: null,
      bridge: current.bridge.readOnly
        ? current.bridge
        : { ...current.bridge, readOnly: true, reason },
      reason,
    });
    if (engagementId === "") return refusal("An engagement id is required.");
    if (problem !== "") return refusal(problem);
    if (current.bridge.readOnly) return refusal(current.bridge.reason);
    const token = current.token ?? "";
    const response = yield* request({
      method: "POST",
      url:
        current.bridge.url + "/api/engagements/" + encodeURIComponent(engagementId) + "/messages",
      token,
      body: { body: input.body.trim(), evidence },
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).pipe(Effect.catch(() => Effect.succeed({ status: 0, text: "" } satisfies HttpJsonResult)));
    if (response.status === 0) {
      return refusal("Could not reach " + current.bridge.url + "; nothing was sent.");
    }
    const body = parseJson(response.text);
    if (response.status !== 201) {
      return refusal(
        messageOf(body) === ""
          ? "The marketplace refused the message (" + response.status + ")."
          : messageOf(body),
      );
    }
    const message = toMessage(asRecord(body)?.["message"]);
    if (message === null) {
      return refusal("The marketplace accepted the message but returned nothing to show.");
    }
    return {
      posted: true,
      message,
      bridge: current.bridge,
      reason: "",
    } satisfies CodeItLabEngagementMessageResult;
  });

  const configure = Effect.fn("Engagements.configure")(function* (
    input: CodeItLabEngagementConfigureInput,
  ) {
    const current = yield* context;
    const url = normalizeMarketplaceUrl(input.url);
    if (input.url.trim() !== "" && url === "") {
      return yield* Effect.fail(
        serviceError(
          "engagements.configure",
          "The marketplace URL must start with http:// or https://.",
        ),
      );
    }
    const next: CodeItLabMarketplaceSettings = {
      url,
      enabled:
        input.enabled ??
        (url === "" ? false : current.settings.enabled || current.settings.url !== ""),
    };
    yield* deps.writeSettings(next);
    let token = current.token;
    if (input.token !== undefined) {
      const trimmed = input.token.trim();
      yield* deps.writeToken(trimmed === "" ? null : trimmed);
      token = trimmed === "" ? null : trimmed;
    }
    return bridgeFrom(next, token);
  });

  /**
   * What the app can prove about a thread's work, composed into a note the coder
   * reviews. Drafting never sends anything and never needs the bridge: reading a
   * local git working tree is not a network call.
   */
  const buildDraft = Effect.fn("Engagements.buildDeliveryDraft")(function* (
    input: CodeItLabDeliveryDraftInput,
  ) {
    const engagementId = input.engagementId.trim();
    if (engagementId === "") {
      return yield* Effect.fail(
        serviceError("engagements.draftDelivery", "An engagement id is required."),
      );
    }
    const threadId = input.threadId.trim();
    if (threadId === "") {
      return yield* Effect.fail(serviceError("engagements.draftDelivery", "A thread is required."));
    }
    const workspace = yield* deps.resolveThreadWorkspace(threadId);
    const finish = (
      draft: {
        readonly threadTitle: string;
        readonly files: ReadonlyArray<CodeItLabDeliveryFile>;
        readonly insertions: number;
        readonly deletions: number;
        readonly branch: string | null;
      },
      reason: string,
    ): { readonly draft: CodeItLabDeliveryDraft; readonly workspace: typeof workspace } => {
      const jobTitle = input.jobTitle?.trim() ?? "";
      const fileCount = draft.files.length;
      const facts = {
        jobTitle,
        threadTitle: draft.threadTitle,
        files: draft.files,
        fileCount,
        insertions: draft.insertions,
        deletions: draft.deletions,
        branch: draft.branch,
      };
      return {
        draft: {
          engagementId,
          threadId,
          threadTitle: draft.threadTitle,
          note: deliveryDraftNote(facts),
          handoff: deliveryHandoffNote({
            ...facts,
            amountLabel: input.amountLabel?.trim() ?? "",
          }),
          files: draft.files,
          fileCount,
          insertions: draft.insertions,
          deletions: draft.deletions,
          branch: draft.branch,
          reason,
        },
        workspace,
      };
    };
    if (workspace === null) {
      return finish(
        { threadTitle: "", files: [], insertions: 0, deletions: 0, branch: null },
        "That thread is not in a project on this machine, so there is no working tree to read.",
      );
    }
    const status = yield* deps.readDeliveryFiles(workspace.cwd);
    if (!status.isRepo) {
      return finish(
        { threadTitle: workspace.title, files: [], insertions: 0, deletions: 0, branch: null },
        "That thread's folder is not a git repository, so there is no diff to attach.",
      );
    }
    if (status.files.length === 0) {
      return finish(
        {
          threadTitle: workspace.title,
          files: [],
          insertions: status.insertions,
          deletions: status.deletions,
          branch: status.branch,
        },
        "No changed files in that thread's working tree yet.",
      );
    }
    return finish(
      {
        threadTitle: workspace.title,
        files: status.files,
        insertions: status.insertions,
        deletions: status.deletions,
        branch: status.branch,
      },
      "",
    );
  });

  const draftDelivery = Effect.fn("Engagements.draftDelivery")(function* (
    input: CodeItLabDeliveryDraftInput,
  ) {
    const { draft } = yield* buildDraft(input);
    return draft;
  });

  /**
   * "Explain this delivery to the client": a model turns the deterministic
   * handoff into a note the business can read. It only drafts — sending stays
   * the coder's decision — and when no model answers, the deterministic handoff
   * comes back with the reason instead of an error, because a draft that cannot
   * be explained is still a draft the coder can edit.
   */
  const deliveryHandoff = Effect.fn("Engagements.deliveryHandoff")(function* (
    input: CodeItLabDeliveryHandoffInput,
  ) {
    const { draft, workspace } = yield* buildDraft(input);
    const deterministic = (reason: string): CodeItLabDeliveryHandoff => ({
      engagementId: draft.engagementId,
      threadId: draft.threadId,
      summary:
        draft.threadTitle.trim() === ""
          ? "Delivery ready for review"
          : ("Delivery: " + draft.threadTitle.trim()).slice(0, 160),
      body: draft.handoff,
      generated: false,
      model: null,
      reason,
      draft,
    });

    if (deps.generateHandoff === undefined) {
      return deterministic(
        "This build has no text generation configured, so this is the deterministic handoff.",
      );
    }
    const selection = input.modelSelection ?? workspace?.modelSelection ?? null;
    if (selection === null) {
      return deterministic(
        "No model is selected for this thread, so this is the deterministic handoff.",
      );
    }
    if (workspace === null) {
      return deterministic(
        draft.reason === "" ? "That thread has no working tree to read." : draft.reason,
      );
    }
    const outcome = yield* deps
      .generateHandoff({
        cwd: workspace.cwd,
        engagementTitle: input.jobTitle?.trim() || draft.threadTitle.trim() || "this engagement",
        deliveryNote: draft.note,
        amountLabel: input.amountLabel?.trim() ?? "",
        modelSelection: selection,
      })
      .pipe(
        Effect.match({
          onFailure: (error) => ({ ok: false as const, error }),
          onSuccess: (value) => ({ ok: true as const, value }),
        }),
      );
    if (!outcome.ok) {
      return deterministic(outcome.error.message);
    }
    const generated = outcome.value;
    return {
      engagementId: draft.engagementId,
      threadId: draft.threadId,
      summary:
        generated.summary.trim() === "" ? "Delivery ready for review" : generated.summary.trim(),
      body: generated.body.trim().slice(0, 4_000),
      generated: true,
      model: selection.model,
      reason: "",
      draft,
    } satisfies CodeItLabDeliveryHandoff;
  });

  /**
   * Send the reviewed note and evidence to the marketplace. The marketplace owns
   * the state machine, so a refusal is reported rather than retried differently.
   */
  const deliver = Effect.fn("Engagements.deliver")(function* (input: CodeItLabDeliveryInput) {
    const current = yield* context;
    const engagementId = input.engagementId.trim();
    const problem = deliveryNoteProblem(input.note);
    const evidence = input.evidence.map((entry) => entry.trim()).filter((entry) => entry !== "");
    const evidenceProblem = deliveryEvidenceProblem(evidence);
    const refusal = (reason: string): CodeItLabDeliveryResult => ({
      delivered: false,
      engagement: null,
      bridge: current.bridge.readOnly
        ? current.bridge
        : { ...current.bridge, readOnly: true, reason },
      reason,
    });
    if (engagementId === "") return refusal("An engagement id is required.");
    if (problem !== "") return refusal(problem);
    if (evidenceProblem !== "") return refusal(evidenceProblem);
    if (current.bridge.readOnly) return refusal(current.bridge.reason);
    const token = current.token ?? "";
    const response = yield* request({
      method: "POST",
      url: current.bridge.url + "/api/engagements/" + encodeURIComponent(engagementId) + "/deliver",
      token,
      body: { deliveryNote: input.note.trim(), deliveryEvidence: evidence },
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).pipe(Effect.catch(() => Effect.succeed({ status: 0, text: "" } satisfies HttpJsonResult)));
    if (response.status === 0) {
      return refusal("Could not reach " + current.bridge.url + "; nothing was delivered.");
    }
    const body = parseJson(response.text);
    if (response.status !== 200) {
      return refusal(
        messageOf(body) === ""
          ? "The marketplace refused the delivery (" + response.status + ")."
          : messageOf(body),
      );
    }
    return {
      delivered: true,
      engagement: toEngagement(asRecord(body)?.["engagement"]),
      bridge: current.bridge,
      reason: "",
    } satisfies CodeItLabDeliveryResult;
  });

  /**
   * Apply to a job the business posted. The marketplace owns the job's state, so
   * a refusal is reported as a reason rather than retried differently.
   */
  const applyToJob = Effect.fn("Engagements.applyToJob")(function* (
    input: CodeItLabEngagementApplyToJobInput,
  ) {
    const current = yield* context;
    if (!current.settings.enabled || current.bridge.url === "") {
      return { applied: false, reason: "Marketplace not configured." };
    }
    if (current.token === null || current.token === "") {
      return { applied: false, reason: "Marketplace token not configured." };
    }
    const jobId = input.jobId.trim();
    if (jobId === "") {
      return { applied: false, reason: "A job id is required." };
    }
    const response = yield* request({
      method: "POST",
      url: current.bridge.url + "/api/jobs/" + encodeURIComponent(jobId) + "/apply",
      token: current.token,
      body: { message: input.message?.trim() ?? "" },
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).pipe(Effect.catch(() => Effect.succeed({ status: 0, text: "" } satisfies HttpJsonResult)));
    if (response.status === 0) {
      return { applied: false, reason: "Could not reach marketplace." };
    }
    if (response.status >= 200 && response.status < 300) {
      return { applied: true };
    }
    const body = parseJson(response.text);
    return {
      applied: false,
      reason:
        messageOf(body) === "" ? "Marketplace returned " + response.status + "." : messageOf(body),
    } satisfies CodeItLabEngagementApplyToJobResult;
  });

  /**
   * Copy the profile to the marketplace. The user has already decided this is
   * public by switching "show to businesses" on, so the app sends only what the
   * profile screen shows and lets the marketplace own the public row.
   */
  const publishProfile = Effect.fn("Engagements.publishProfile")(function* (
    input: CodeItLabProfilePublishInput,
  ) {
    if (!input.visibleToBusinesses) {
      return {
        published: false,
        reason: "The profile is private. Turn on showing it to businesses first.",
      } satisfies CodeItLabProfilePublishResult;
    }
    const current = yield* context;
    if (!current.settings.enabled || current.bridge.url === "") {
      return { published: false, reason: "Marketplace not configured." };
    }
    if (current.token === null || current.token === "") {
      return { published: false, reason: "Marketplace token not configured." };
    }
    const response = yield* request({
      method: "POST",
      url: current.bridge.url + "/api/coders/profile",
      token: current.token,
      body: {
        displayName: input.displayName,
        headline: input.headline,
        bio: input.bio,
        skills: input.skills.join(", "),
        interests: input.interests.join(", "),
        workHistory: input.workHistory
          .map((entry) => {
            const heading = [entry.role, entry.company === "" ? "" : "at " + entry.company]
              .filter((part) => part !== "")
              .join(" ");
            const period = entry.period === "" ? "" : " (" + entry.period + ")";
            const summary = entry.summary === "" ? "" : ": " + entry.summary;
            return heading + period + summary;
          })
          .join("\n"),
      },
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).pipe(Effect.catch(() => Effect.succeed({ status: 0, text: "" } satisfies HttpJsonResult)));
    if (response.status === 0) {
      return { published: false, reason: "Could not reach marketplace." };
    }
    if (response.status >= 200 && response.status < 300) {
      const body = asRecord(parseJson(response.text));
      const coder = asRecord(body?.["coder"]);
      const id = coder?.["id"];
      return {
        published: true,
        ...(typeof id === "string" && id !== ""
          ? { profileUrl: current.bridge.url + "/coders/" + encodeURIComponent(id) }
          : {}),
      } satisfies CodeItLabProfilePublishResult;
    }
    const body = parseJson(response.text);
    return {
      published: false,
      reason:
        messageOf(body) === "" ? "Marketplace returned " + response.status + "." : messageOf(body),
    } satisfies CodeItLabProfilePublishResult;
  });

  /**
   * Move an engagement along. The marketplace owns which transitions are legal
   * for which role, so a refusal is reported verbatim rather than guessed at
   * here: a coder cannot approve and a business cannot start, and only the
   * marketplace knows that.
   */
  const transition = Effect.fn("Engagements.transition")(function* (
    input: CodeItLabEngagementTransitionInput,
  ) {
    const current = yield* context;
    const engagementId = input.engagementId.trim();
    const refusal = (reason: string): CodeItLabEngagementTransitionResult => ({
      transitioned: false,
      engagement: null,
      bridge: current.bridge.readOnly
        ? current.bridge
        : { ...current.bridge, readOnly: true, reason },
      reason,
    });
    if (engagementId === "") return refusal("An engagement id is required.");
    if (current.bridge.readOnly) return refusal(current.bridge.reason);
    const response = yield* request({
      method: "POST",
      url:
        current.bridge.url +
        "/api/engagements/" +
        encodeURIComponent(engagementId) +
        "/" +
        input.action,
      token: current.token ?? "",
      body: {},
      timeoutMs: REQUEST_TIMEOUT_MS,
    }).pipe(Effect.catch(() => Effect.succeed({ status: 0, text: "" } satisfies HttpJsonResult)));
    if (response.status === 0) {
      return refusal("Could not reach " + current.bridge.url + "; nothing changed.");
    }
    const raw: unknown = parseJson(response.text);
    if (response.status !== 200) {
      const message = messageOf(raw);
      return refusal(
        message === "" ? "The marketplace refused the change (" + response.status + ")." : message,
      );
    }
    const engagement = toEngagement(asRecord(raw)?.["engagement"]);
    if (engagement === null) {
      return refusal("The marketplace accepted the change but returned nothing to show.");
    }
    return {
      transitioned: true,
      engagement,
      bridge: current.bridge,
      reason: "",
    } satisfies CodeItLabEngagementTransitionResult;
  });

  return EngagementsServiceTag.of({
    bridge,
    list,
    messages,
    postMessage,
    configure,
    draftDelivery,
    deliveryHandoff,
    deliver,
    transition,
    applyToJob,
    publishProfile,
  });
};

export const make = Effect.gen(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const httpClient = yield* HttpClient.HttpClient;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readSettings = settings.getSettings.pipe(
    Effect.map((current) => current.codeitlab.marketplace),
    Effect.mapError((cause) =>
      serviceError("engagements.bridge", "Could not read the marketplace settings.", cause),
    ),
  );
  const writeSettings = (next: CodeItLabMarketplaceSettings) =>
    settings.getSettings.pipe(
      Effect.flatMap((current) =>
        settings.updateSettings({ codeitlab: { ...current.codeitlab, marketplace: next } }),
      ),
      Effect.asVoid,
      Effect.mapError((cause) =>
        serviceError("engagements.configure", "Could not save the marketplace settings.", cause),
      ),
    );
  const readToken = secrets.get(TOKEN_SECRET).pipe(
    Effect.map((value) =>
      Option.isSome(value) && value.value.length > 0 ? decoder.decode(value.value) : null,
    ),
    Effect.mapError((cause) =>
      serviceError(
        "engagements.bridge",
        "Could not read the marketplace token from the vault.",
        cause,
      ),
    ),
  );
  const writeToken = (token: string | null) =>
    (token === null
      ? secrets.remove(TOKEN_SECRET)
      : secrets.set(TOKEN_SECRET, encoder.encode(token))
    ).pipe(
      Effect.mapError((cause) =>
        serviceError("engagements.configure", "Could not save the marketplace token.", cause),
      ),
    );

  const projections = yield* ProjectionStoreV2.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const git = yield* GitManager.GitManager;

  const workspaceError = (cause: unknown) =>
    serviceError(
      "engagements.draftDelivery",
      "Could not read that thread's project on this machine.",
      cause,
    );

  const resolveThreadWorkspace = Effect.fn("Engagements.resolveThreadWorkspace")(function* (
    threadId: string,
  ) {
    const shell = yield* projections
      .getThreadShell(threadId as never)
      .pipe(Effect.mapError(workspaceError));
    if (shell === null) return null;
    const project = yield* projects.get(shell.projectId).pipe(Effect.mapError(workspaceError));
    if (Option.isNone(project)) return null;
    return {
      cwd: shell.worktreePath ?? project.value.workspaceRoot,
      title: shell.title,
      modelSelection: {
        instanceId: shell.modelSelection.instanceId,
        model: shell.modelSelection.model,
      },
    };
  });

  const readDeliveryFiles = (cwd: string) =>
    git.localStatus({ cwd }).pipe(
      Effect.map((status) => ({
        isRepo: status.isRepo,
        files: status.workingTree.files.map((file) => ({
          path: file.path,
          insertions: file.insertions,
          deletions: file.deletions,
        })),
        insertions: status.workingTree.insertions,
        deletions: status.workingTree.deletions,
        branch: status.refName ?? null,
      })),
      Effect.mapError((cause) =>
        serviceError(
          "engagements.draftDelivery",
          "Could not read the changed files in that thread's working tree.",
          cause,
        ),
      ),
    );

  // Text generation is optional here: a focused test or an early boot without
  // a provider registry still gets a service, and the handoff falls back to the
  // deterministic note with a reason.
  const textGeneration = yield* Effect.serviceOption(TextGeneration.TextGeneration);

  return makeEngagementsService({
    readSettings,
    writeSettings,
    readToken,
    writeToken,
    nowMs: Clock.currentTimeMillis,
    resolveThreadWorkspace,
    readDeliveryFiles,
    httpJson: makeHttpJson(httpClient),
    ...(Option.isSome(textGeneration)
      ? {
          generateHandoff: (input: {
            readonly cwd: string;
            readonly engagementTitle: string;
            readonly deliveryNote: string;
            readonly amountLabel: string;
            readonly modelSelection: { readonly instanceId: string; readonly model: string };
          }) =>
            textGeneration.value
              .generateDeliveryHandoff({
                cwd: input.cwd,
                engagementTitle: input.engagementTitle,
                deliveryNote: input.deliveryNote,
                amountLabel: input.amountLabel,
                // The provider layer brands instance ids; the service keeps them as
                // plain strings so its contract stays in the core package.
                modelSelection:
                  input.modelSelection as TextGeneration.DeliveryHandoffGenerationInput["modelSelection"],
              })
              .pipe(
                Effect.mapError((cause) =>
                  serviceError(
                    "engagements.deliveryHandoff",
                    "The model could not write the handoff, so this is the deterministic one.",
                    cause,
                  ),
                ),
              ),
        }
      : {}),
  });
});

export const layer = Layer.effect(EngagementsServiceTag, make);
