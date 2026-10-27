import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * The bridge between the app and the user's own marketplace deployment.
 *
 * The app does not hold money, does not mediate and does not decide a release:
 * it reads the engagements the marketplace already tracks and posts messages to
 * the engagement thread the marketplace already owns. Everything here is a
 * shape or a pure rule, so the same values mean the same thing on both sides.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));
const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const EngagementStatus = Schema.Literals([
  "requested",
  "accepted",
  "in_progress",
  "delivered",
  "approved",
  "paid_out",
  "cancelled",
  "disputed",
]);
export type EngagementStatus = typeof EngagementStatus.Type;

export const EngagementRole = Schema.Literals(["coder", "business"]);
export type EngagementRole = typeof EngagementRole.Type;

/** A link the marketplace stores next to a message or a delivery. */
export const ENGAGEMENT_MAX_MESSAGE_LENGTH = 4_000;
export const ENGAGEMENT_MAX_EVIDENCE = 10;

export const CodeItLabEngagement = Schema.Struct({
  id: Schema.String,
  jobTitle: Schema.String,
  /** Which side of this engagement the configured account is on. */
  role: EngagementRole,
  counterpartName: Schema.String,
  status: EngagementStatus,
  amountCents: Schema.Number,
  currency: Schema.String,
  /** One sentence: what the account should do next, derived from role + status. */
  nextStep: Schema.String,
  updatedAt: Schema.String,
});
export type CodeItLabEngagement = typeof CodeItLabEngagement.Type;

/**
 * Whether the bridge can talk to the marketplace right now. `readOnly` is the
 * honest state of a bridge with no URL, no token, or a deployment that does not
 * answer: the panel still renders what it has, and says why it cannot send.
 */
export const CodeItLabEngagementBridge = Schema.Struct({
  url: Schema.String,
  configured: Schema.Boolean,
  tokenPresent: Schema.Boolean,
  enabled: Schema.Boolean,
  readOnly: Schema.Boolean,
  /** Empty when the bridge is usable; otherwise the sentence the UI shows. */
  reason: Schema.String,
});
export type CodeItLabEngagementBridge = typeof CodeItLabEngagementBridge.Type;

export const CodeItLabEngagementList = Schema.Struct({
  bridge: CodeItLabEngagementBridge,
  engagements: Schema.Array(CodeItLabEngagement),
  fetchedAt: Schema.String,
});
export type CodeItLabEngagementList = typeof CodeItLabEngagementList.Type;

export const CodeItLabEngagementMessage = Schema.Struct({
  id: Schema.String,
  engagementId: Schema.String,
  authorRole: EngagementRole,
  authorName: Schema.String,
  body: Schema.String,
  evidence: Schema.Array(Schema.String),
  createdAt: Schema.String,
});
export type CodeItLabEngagementMessage = typeof CodeItLabEngagementMessage.Type;

export const CodeItLabEngagementMessages = Schema.Struct({
  engagementId: Schema.String,
  bridge: CodeItLabEngagementBridge,
  messages: Schema.Array(CodeItLabEngagementMessage),
  fetchedAt: Schema.String,
});
export type CodeItLabEngagementMessages = typeof CodeItLabEngagementMessages.Type;

export const CodeItLabEngagementMessagesInput = Schema.Struct({
  engagementId: Schema.String,
  /** Cursor: return only messages newer than this id. */
  after: Schema.optional(Schema.String),
});
export type CodeItLabEngagementMessagesInput = typeof CodeItLabEngagementMessagesInput.Type;

export const CodeItLabEngagementMessageInput = Schema.Struct({
  engagementId: Schema.String,
  body: Schema.String,
  evidence: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeItLabEngagementMessageInput = typeof CodeItLabEngagementMessageInput.Type;

export const CodeItLabEngagementMessageResult = Schema.Struct({
  posted: Schema.Boolean,
  message: Schema.NullOr(CodeItLabEngagementMessage),
  bridge: CodeItLabEngagementBridge,
  /** Empty when posted; the reason the marketplace refused otherwise. */
  reason: Schema.String,
});
export type CodeItLabEngagementMessageResult = typeof CodeItLabEngagementMessageResult.Type;

export const CodeItLabEngagementConfigureInput = Schema.Struct({
  /** Base URL of the user's marketplace deployment, e.g. https://acme.example/market. */
  url: Schema.String,
  /** New token; omit to keep the stored one. An empty string clears it. */
  token: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
});
export type CodeItLabEngagementConfigureInput = typeof CodeItLabEngagementConfigureInput.Type;

export const CodeItLabMarketplaceSettings = Schema.Struct({
  /** Base URL of the deployment this account uses. Empty until configured. */
  url: TrimmedDefault(""),
  /** Opt-in: polling and sending are off until the user turns the bridge on. */
  enabled: BooleanDefault(false),
});
export type CodeItLabMarketplaceSettings = typeof CodeItLabMarketplaceSettings.Type;

/**
 * Base URL normalisation. The value ends up in fetch calls, so only http(s) is
 * accepted and a trailing slash is dropped; anything else becomes empty (the
 * bridge then reports "not configured" instead of failing at send time).
 */
export function normalizeMarketplaceUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "";
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
  const path = parsed.pathname.replace(/\/+$/u, "");
  return parsed.origin + path;
}

export function isHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/** Cents to a stable, locale-free label: the amount the marketplace charged. */
export function formatEngagementAmount(cents: number, currency: string): string {
  const safe = Number.isFinite(cents) ? Math.round(cents) : 0;
  const whole = (safe / 100).toFixed(2);
  return whole + " " + (currency.trim() === "" ? "USD" : currency.trim().toUpperCase());
}

/**
 * The one next step for this side of the engagement. A client-side derivation of
 * the marketplace state machine, kept here so the panel and the docs agree.
 */
export function engagementNextStep(role: EngagementRole, status: EngagementStatus): string {
  if (status === "cancelled") return "This engagement was cancelled; nothing to do.";
  if (status === "disputed") return "A dispute is open; the marketplace decides the outcome.";
  if (role === "coder") {
    switch (status) {
      case "requested":
        return "Accept or decline the request.";
      case "accepted":
        return "Start the work when you are ready.";
      case "in_progress":
        return "Deliver the work with a note and evidence.";
      case "delivered":
        return "Wait for the business to review the delivery.";
      case "approved":
      case "paid_out":
        return "Paid out; the work is complete.";
    }
  }
  switch (status) {
    case "requested":
      return "Waiting for the coder to accept.";
    case "accepted":
      return "The coder accepted; work has not started yet.";
    case "in_progress":
      return "The coder is working; review the delivery when it arrives.";
    case "delivered":
      return "Review the delivery, then approve or open a dispute.";
    case "approved":
    case "paid_out":
      return "Approved and paid out; leave a rating if you want.";
  }
  return "Nothing to do.";
}

/** Active work: what belongs at the top of the panel. */
export function engagementIsActive(status: EngagementStatus): boolean {
  return (
    status === "requested" ||
    status === "accepted" ||
    status === "in_progress" ||
    status === "delivered"
  );
}

/** Trimmed body length check, shared so the UI can disable send before a round-trip. */
export function engagementMessageProblem(body: string): string {
  const trimmed = body.trim();
  if (trimmed === "") return "Write a message first.";
  if (trimmed.length > ENGAGEMENT_MAX_MESSAGE_LENGTH) {
    return "A message can be at most " + ENGAGEMENT_MAX_MESSAGE_LENGTH + " characters.";
  }
  return "";
}

/** The marketplace caps a delivery note at 2000 characters and 5 evidence links. */
export const DELIVERY_NOTE_MAX_LENGTH = 2_000;
export const DELIVERY_MAX_EVIDENCE = 5;
/** A draft lists the first files in full and counts the rest, so the note stays short. */
export const DELIVERY_MAX_FILE_LINES = 20;

export const CodeItLabDeliveryFile = Schema.Struct({
  path: Schema.String,
  insertions: Schema.Number,
  deletions: Schema.Number,
});
export type CodeItLabDeliveryFile = typeof CodeItLabDeliveryFile.Type;

/**
 * What the app can prove about a thread's work: the files git reports as changed,
 * their line counts, and the branch they sit on. The note and the handoff are
 * composed from these facts only — nothing about test results is invented, which
 * is why evidence links stay empty until the user adds them.
 */
export const CodeItLabDeliveryDraft = Schema.Struct({
  engagementId: Schema.String,
  threadId: Schema.String,
  threadTitle: Schema.String,
  /** A short delivery note, ready to review. */
  note: Schema.String,
  /** A longer client-facing explanation, ready to review. */
  handoff: Schema.String,
  files: Schema.Array(CodeItLabDeliveryFile),
  fileCount: Schema.Number,
  insertions: Schema.Number,
  deletions: Schema.Number,
  branch: Schema.NullOr(Schema.String),
  /** Empty when there is work to attach; otherwise why there is nothing to show. */
  reason: Schema.String,
});
export type CodeItLabDeliveryDraft = typeof CodeItLabDeliveryDraft.Type;

export const CodeItLabDeliveryDraftInput = Schema.Struct({
  engagementId: Schema.String,
  threadId: Schema.String,
  /** Display text the panel already has; the draft never invents either. */
  jobTitle: Schema.optional(Schema.String),
  amountLabel: Schema.optional(Schema.String),
});
export type CodeItLabDeliveryDraftInput = typeof CodeItLabDeliveryDraftInput.Type;

/**
 * "Explain this delivery to the client": the model rewrites the deterministic
 * handoff as a note the business can read, and the coder reviews it before
 * anything is sent. The result carries the draft it came from, so the panel can
 * show the files and evidence next to the text.
 */
export const CodeItLabDeliveryHandoffInput = Schema.Struct({
  engagementId: Schema.String,
  threadId: Schema.String,
  jobTitle: Schema.optional(Schema.String),
  amountLabel: Schema.optional(Schema.String),
  /** The composer's selection; omitted, the thread's own model is used. */
  modelSelection: Schema.optional(
    Schema.Struct({ instanceId: Schema.String, model: Schema.String }),
  ),
});
export type CodeItLabDeliveryHandoffInput = typeof CodeItLabDeliveryHandoffInput.Type;

export const CodeItLabDeliveryHandoff = Schema.Struct({
  engagementId: Schema.String,
  threadId: Schema.String,
  /** One line the client reads first. */
  summary: Schema.String,
  /** Markdown: what was built, how it runs, what it cost, what was NOT done. */
  body: Schema.String,
  /** False when no model answered and the deterministic handoff is all there is. */
  generated: Schema.Boolean,
  model: Schema.NullOr(Schema.String),
  /** Why the deterministic handoff was used; empty when a model wrote the text. */
  reason: Schema.String,
  draft: CodeItLabDeliveryDraft,
});
export type CodeItLabDeliveryHandoff = typeof CodeItLabDeliveryHandoff.Type;

export const CodeItLabDeliveryInput = Schema.Struct({
  engagementId: Schema.String,
  note: Schema.String,
  evidence: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type CodeItLabDeliveryInput = typeof CodeItLabDeliveryInput.Type;

export const CodeItLabDeliveryResult = Schema.Struct({
  delivered: Schema.Boolean,
  engagement: Schema.NullOr(CodeItLabEngagement),
  bridge: CodeItLabEngagementBridge,
  reason: Schema.String,
});
export type CodeItLabDeliveryResult = typeof CodeItLabDeliveryResult.Type;

export const CodeItLabEngagementApplyToJobInput = Schema.Struct({
  jobId: Schema.String,
  message: Schema.optional(Schema.String),
});
export type CodeItLabEngagementApplyToJobInput = typeof CodeItLabEngagementApplyToJobInput.Type;

export const CodeItLabEngagementApplyToJobResult = Schema.Struct({
  applied: Schema.Boolean,
  reason: Schema.optional(Schema.String),
});
export type CodeItLabEngagementApplyToJobResult = typeof CodeItLabEngagementApplyToJobResult.Type;

/** Trimmed note check, shared so the review form can block a send before a round-trip. */
export function deliveryNoteProblem(note: string): string {
  const trimmed = note.trim();
  if (trimmed === "")
    return "Write a delivery note first; the business reads this before approving.";
  if (trimmed.length > DELIVERY_NOTE_MAX_LENGTH) {
    return "A delivery note can be at most " + DELIVERY_NOTE_MAX_LENGTH + " characters.";
  }
  return "";
}

/** Evidence links are the user's proof: only full http(s) URLs, deduped, at most five. */
export function deliveryEvidenceProblem(evidence: ReadonlyArray<string>): string {
  const seen = new Set<string>();
  for (const entry of evidence) {
    const trimmed = entry.trim();
    if (trimmed === "") continue;
    if (!isHttpUrl(trimmed)) return "Evidence must be full http(s) URLs.";
    seen.add(trimmed);
  }
  if (seen.size > DELIVERY_MAX_EVIDENCE) {
    return "A delivery can list at most " + DELIVERY_MAX_EVIDENCE + " evidence links.";
  }
  return "";
}

const deliveryFileLines = (files: ReadonlyArray<CodeItLabDeliveryFile>): string => {
  const shown = files.slice(0, DELIVERY_MAX_FILE_LINES);
  const lines = shown.map(
    (file) =>
      "- " + file.path + " (+" + String(file.insertions) + " −" + String(file.deletions) + ")",
  );
  if (files.length > shown.length) {
    lines.push("- … and " + String(files.length - shown.length) + " more file(s)");
  }
  return lines.join("\n");
};

const deliverySummaryLine = (input: {
  readonly fileCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly branch: string | null;
}): string =>
  String(input.fileCount) +
  " file(s) changed on " +
  (input.branch === null || input.branch === "" ? "the working tree" : input.branch) +
  ", +" +
  String(input.insertions) +
  " −" +
  String(input.deletions);

/** The short note: what changed and where to look. Facts only. */
export function deliveryDraftNote(input: {
  readonly jobTitle: string;
  readonly threadTitle: string;
  readonly files: ReadonlyArray<CodeItLabDeliveryFile>;
  readonly fileCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly branch: string | null;
}): string {
  const heading = input.jobTitle.trim() === "" ? input.threadTitle.trim() : input.jobTitle.trim();
  const lines = [
    "Delivered: " + (heading === "" ? "the work in this thread" : heading),
    "",
    "Changed " + deliverySummaryLine(input) + ".",
  ];
  if (input.files.length > 0) lines.push("", deliveryFileLines(input.files));
  lines.push(
    "",
    "Evidence: add a link to the pull request, a staging deploy or a test run before sending — the app does not record test results.",
  );
  return lines.join("\n").slice(0, DELIVERY_NOTE_MAX_LENGTH);
}

/**
 * The client-facing handoff: what was built, how it runs, what it cost, what was
 * NOT done. Cost comes from the marketplace's amount; "not done" stays a prompt
 * because the app cannot know what the coder left out.
 */
export function deliveryHandoffNote(input: {
  readonly jobTitle: string;
  readonly threadTitle: string;
  readonly files: ReadonlyArray<CodeItLabDeliveryFile>;
  readonly fileCount: number;
  readonly insertions: number;
  readonly deletions: number;
  readonly branch: string | null;
  readonly amountLabel?: string;
}): string {
  const heading = input.jobTitle.trim() === "" ? input.threadTitle.trim() : input.jobTitle.trim();
  const lines = [
    "What was built",
    (heading === "" ? "The work in this thread." : heading + ".") +
      " " +
      (input.fileCount === 0
        ? "No file changes are recorded in this thread's working tree."
        : "It touches " + deliverySummaryLine(input) + "."),
  ];
  if (input.files.length > 0) lines.push("", deliveryFileLines(input.files));
  lines.push(
    "",
    "How it runs",
    input.branch === null || input.branch === ""
      ? "The work is in the working tree; add a link to where the business can run or review it."
      : "The work is on " + input.branch + "; add a link to the pull request or a running deploy.",
    "",
    "What it cost",
    (input.amountLabel === undefined || input.amountLabel === ""
      ? "The marketplace holds the agreed amount."
      : "The agreed amount is " + input.amountLabel + ", held by the marketplace.") +
      " This note does not change it.",
    "",
    "What was NOT done",
    "- List anything you left out; the app cannot know.",
    "",
    "Drafted from the thread's git state and reviewed before sending.",
  );
  return lines.join("\n").slice(0, DELIVERY_NOTE_MAX_LENGTH);
}
