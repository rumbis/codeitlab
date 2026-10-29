import {
  engagementIsActive,
  type CodeItLabDeliveryDraft,
  type CodeItLabDeliveryHandoff,
  type CodeItLabDeliveryResult,
  type CodeItLabEngagement,
  type CodeItLabEngagementAction,
  type CodeItLabEngagementApplyToJobInput,
  type CodeItLabEngagementApplyToJobResult,
  type CodeItLabEngagementBridge,
  type CodeItLabEngagementConfigureInput,
  type CodeItLabEngagementMessage,
  type CodeItLabEngagementMessageResult,
  type CodeItLabEngagementMessages,
  type CodeItLabEngagementTransitionResult,
  type CodeItLabProfilePublishInput,
  type CodeItLabProfilePublishResult,
  type EngagementStatus,
  type EnvironmentId,
} from "@codeitlab/contracts";
import { WS_METHODS } from "@codeitlab/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "@codeitlab/client-runtime/state/runtime";
import { useState } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentQuery } from "../state/query";
import { useAtomCommand } from "../state/use-atom-command";

/**
 * Client half of the marketplace bridge. The marketplace is a separate
 * deployment the user runs; the server owns the HTTP calls, the token and the
 * opt-in, so this module only asks it what it already knows and renders that.
 * Nothing here decides money: the panel reads engagements, posts messages to the
 * thread the marketplace owns, and asks it to move a status along. Every
 * transition is a request — the marketplace can still refuse it.
 */

/** Poll interval for a usable, opted-in bridge. The page pauses it while hidden. */
export const ENGAGEMENT_POLL_INTERVAL_MS = 15_000;

export const codeitlabEngagementBridgeQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:bridge",
    tag: WS_METHODS.codeitlabEngagementsBridge,
    staleTimeMs: 15_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabEngagementListQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:list",
    tag: WS_METHODS.codeitlabEngagementsList,
    staleTimeMs: 15_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabEngagementMessagesQuery = createEnvironmentRpcQueryAtomFamily(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:messages",
    tag: WS_METHODS.codeitlabEngagementsMessages,
    staleTimeMs: 5_000,
    idleTtlMs: 120_000,
  },
);

export const codeitlabEngagementPostMessageCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:post-message",
    tag: WS_METHODS.codeitlabEngagementsPostMessage,
  },
);

export const codeitlabEngagementConfigureCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:configure",
    tag: WS_METHODS.codeitlabEngagementsConfigure,
  },
);

export const codeitlabEngagementDeliveryDraftCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:delivery-draft",
    tag: WS_METHODS.codeitlabEngagementsDeliveryDraft,
  },
);

export const codeitlabEngagementDeliverCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:deliver",
    tag: WS_METHODS.codeitlabEngagementsDeliver,
  },
);

export const codeitlabEngagementTransitionCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:transition",
    tag: WS_METHODS.codeitlabEngagementsTransition,
  },
);

export const codeitlabEngagementDeliveryHandoffCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:delivery-handoff",
    tag: WS_METHODS.codeitlabEngagementsDeliveryHandoff,
  },
);

export interface CodeItLabEngagementThreadView {
  /** The thread's own bridge: a refused thread can be read-only while the list is not. */
  readonly bridge: CodeItLabEngagementBridge | null;
  readonly messages: ReadonlyArray<CodeItLabEngagementMessage>;
  readonly fetchedAt: string | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly refresh: () => void;
}

export interface CodeItLabEngagementsView {
  /** The list's bridge when it answered, otherwise the standalone bridge query. */
  readonly bridge: CodeItLabEngagementBridge | null;
  readonly engagements: ReadonlyArray<CodeItLabEngagement>;
  readonly fetchedAt: string | null;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly refreshBridge: () => void;
  readonly refreshList: () => void;
  readonly thread: CodeItLabEngagementThreadView;
  readonly postMessage: (
    engagementId: string,
    body: string,
  ) => Promise<CodeItLabEngagementMessageResult | null>;
  /** Accept, start, approve, cancel or dispute; the marketplace decides what is legal. */
  readonly transition: (
    engagementId: string,
    action: CodeItLabEngagementAction,
  ) => Promise<CodeItLabEngagementTransitionResult | null>;
  readonly configure: (
    input: CodeItLabEngagementConfigureInput,
  ) => Promise<CodeItLabEngagementBridge | null>;
}

/**
 * One hook for the whole panel: the bridge, the engagement list and the thread
 * of the selected engagement. Refusals come back as a result with a reason, not
 * an exception, because the panel shows them verbatim.
 */
export function useCodeItLabEngagements(engagementId: string | null): CodeItLabEngagementsView {
  const environmentId = usePrimaryEnvironmentId();
  const bridgeQuery = useEnvironmentQuery(
    environmentId === null ? null : codeitlabEngagementBridgeQuery({ environmentId, input: {} }),
  );
  const listQuery = useEnvironmentQuery(
    environmentId === null ? null : codeitlabEngagementListQuery({ environmentId, input: {} }),
  );
  const threadQuery = useEnvironmentQuery(
    environmentId === null || engagementId === null
      ? null
      : codeitlabEngagementMessagesQuery({ environmentId, input: { engagementId } }),
  );
  const postMessageCommand = useAtomCommand(codeitlabEngagementPostMessageCommand, {
    reportFailure: false,
  });
  const configureCommand = useAtomCommand(codeitlabEngagementConfigureCommand, {
    reportFailure: false,
  });
  const transitionCommand = useAtomCommand(codeitlabEngagementTransitionCommand, {
    reportFailure: false,
  });

  const list = listQuery.data;
  const threadMessages: CodeItLabEngagementMessages | null = threadQuery.data;
  const refreshList = listQuery.refresh;
  const refreshThread = threadQuery.refresh;
  const refreshBridge = bridgeQuery.refresh;

  return {
    bridge: bridgeQuery.data ?? list?.bridge ?? null,
    engagements: list?.engagements ?? [],
    fetchedAt: list?.fetchedAt ?? null,
    isPending: listQuery.isPending || bridgeQuery.isPending,
    error: listQuery.error ?? bridgeQuery.error,
    refreshBridge,
    refreshList,
    thread: {
      bridge: threadMessages?.bridge ?? null,
      messages: threadMessages?.messages ?? [],
      fetchedAt: threadMessages?.fetchedAt ?? null,
      isPending: threadQuery.isPending,
      error: threadQuery.error,
      refresh: refreshThread,
    },
    postMessage: async (id, body) => {
      if (environmentId === null) return null;
      const result = await postMessageCommand({
        environmentId,
        input: { engagementId: id, body, evidence: [] },
      });
      if (result._tag !== "Success") return null;
      // The marketplace is the record; refresh both views so the panel cannot
      // show a thread that disagrees with the list.
      refreshList();
      refreshThread();
      return result.value;
    },
    transition: async (id, action) => {
      if (environmentId === null) return null;
      const result = await transitionCommand({
        environmentId,
        input: { engagementId: id, action },
      });
      if (result._tag !== "Success") return null;
      // The status and the next step both move with the transition, so the list
      // and the thread would otherwise disagree with what just happened.
      refreshList();
      refreshThread();
      return result.value;
    },
    configure: async (input) => {
      if (environmentId === null) return null;
      const result = await configureCommand({ environmentId, input });
      if (result._tag !== "Success") return null;
      refreshBridge();
      refreshList();
      return result.value;
    },
  };
}

export interface CodeItLabEngagementDeliveryView {
  readonly bridge: CodeItLabEngagementBridge | null;
  readonly engagements: ReadonlyArray<CodeItLabEngagement>;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly draft: CodeItLabDeliveryDraft | null;
  readonly draftPending: boolean;
  readonly handoff: CodeItLabDeliveryHandoff | null;
  readonly handoffPending: boolean;
  readonly deliverPending: boolean;
  readonly lastResult: CodeItLabDeliveryResult | null;
  readonly loadDraft: (
    engagementId: string,
    jobTitle: string,
    amountLabel: string,
  ) => Promise<CodeItLabDeliveryDraft | null>;
  readonly loadHandoff: (
    engagementId: string,
    jobTitle: string,
    amountLabel: string,
  ) => Promise<CodeItLabDeliveryHandoff | null>;
  readonly deliver: (
    engagementId: string,
    note: string,
    evidence: ReadonlyArray<string>,
  ) => Promise<CodeItLabDeliveryResult | null>;
  readonly refresh: () => void;
}

/**
 * The delivery flow behind the composer dialog. Drafting is a one-shot command,
 * not a cached query: a draft describes one thread's git state at the moment the
 * coder asked for it, and the dialog only mounts while it is open, so mounting
 * this hook is what loads the bridge and the list. Nothing is sent until
 * `deliver` is called.
 */
export function useEngagementDelivery(threadId: string): CodeItLabEngagementDeliveryView {
  const environmentId = usePrimaryEnvironmentId();
  const bridgeQuery = useEnvironmentQuery(
    environmentId === null ? null : codeitlabEngagementBridgeQuery({ environmentId, input: {} }),
  );
  const listQuery = useEnvironmentQuery(
    environmentId === null ? null : codeitlabEngagementListQuery({ environmentId, input: {} }),
  );
  const draftCommand = useAtomCommand(codeitlabEngagementDeliveryDraftCommand, {
    reportFailure: false,
  });
  const deliverCommand = useAtomCommand(codeitlabEngagementDeliverCommand, {
    reportFailure: false,
  });
  const handoffCommand = useAtomCommand(codeitlabEngagementDeliveryHandoffCommand, {
    reportFailure: false,
  });
  const [draft, setDraft] = useState<CodeItLabDeliveryDraft | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const [handoff, setHandoff] = useState<CodeItLabDeliveryHandoff | null>(null);
  const [handoffPending, setHandoffPending] = useState(false);
  const [deliverPending, setDeliverPending] = useState(false);
  const [lastResult, setLastResult] = useState<CodeItLabDeliveryResult | null>(null);

  const list = listQuery.data;
  const refreshList = listQuery.refresh;
  const refreshBridge = bridgeQuery.refresh;

  return {
    bridge: bridgeQuery.data ?? list?.bridge ?? null,
    engagements: list?.engagements ?? [],
    isPending: listQuery.isPending || bridgeQuery.isPending,
    error: listQuery.error ?? bridgeQuery.error,
    draft,
    draftPending,
    handoff,
    handoffPending,
    deliverPending,
    lastResult,
    loadDraft: async (engagementId, jobTitle, amountLabel) => {
      if (environmentId === null) return null;
      setDraftPending(true);
      setLastResult(null);
      const result = await draftCommand({
        environmentId,
        input: { engagementId, threadId, jobTitle, amountLabel },
      });
      setDraftPending(false);
      if (result._tag !== "Success") {
        setDraft(null);
        return null;
      }
      setDraft(result.value);
      return result.value;
    },
    loadHandoff: async (engagementId, jobTitle, amountLabel) => {
      if (environmentId === null) return null;
      setHandoffPending(true);
      const result = await handoffCommand({
        environmentId,
        input: { engagementId, threadId, jobTitle, amountLabel },
      });
      setHandoffPending(false);
      if (result._tag !== "Success") {
        setHandoff(null);
        return null;
      }
      setHandoff(result.value);
      return result.value;
    },
    deliver: async (engagementId, note, evidence) => {
      if (environmentId === null) return null;
      setDeliverPending(true);
      const result = await deliverCommand({
        environmentId,
        input: { engagementId, note, evidence },
      });
      setDeliverPending(false);
      if (result._tag !== "Success") return null;
      setLastResult(result.value);
      // The marketplace owns the status change; re-read the list so the badge
      // and the next-step sentence move to delivered instead of lying.
      refreshList();
      if (!result.value.delivered) refreshBridge();
      return result.value;
    },
    refresh: () => {
      refreshBridge();
      refreshList();
    },
  };
}

export type EngagementBadgeVariant = "info" | "warning" | "success" | "secondary" | "error";

const ENGAGEMENT_STATUS: Readonly<
  Record<EngagementStatus, { readonly label: string; readonly variant: EngagementBadgeVariant }>
> = {
  requested: { label: "Requested", variant: "info" },
  accepted: { label: "Accepted", variant: "info" },
  in_progress: { label: "In progress", variant: "warning" },
  delivered: { label: "Delivered", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  paid_out: { label: "Paid out", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
  disputed: { label: "Disputed", variant: "error" },
};

export function engagementStatusLabel(status: EngagementStatus): string {
  return ENGAGEMENT_STATUS[status].label;
}

export function engagementStatusVariant(status: EngagementStatus): EngagementBadgeVariant {
  return ENGAGEMENT_STATUS[status].variant;
}

export function engagementRoleLabel(role: CodeItLabEngagement["role"]): string {
  return role === "coder" ? "Coder" : "Business";
}

/**
 * How the counterpart relates to this account. A coder works for the business
 * that hired them; a business hired the coder. Saying it backwards is the kind
 * of lie this panel exists to avoid.
 */
export function engagementCounterpartLabel(
  engagement: Pick<CodeItLabEngagement, "role" | "counterpartName">,
): string {
  return engagement.role === "coder"
    ? "working for " + engagement.counterpartName
    : "hired " + engagement.counterpartName;
}

function updatedAtMs(engagement: CodeItLabEngagement): number {
  const ms = Date.parse(engagement.updatedAt);
  return Number.isFinite(ms) ? ms : 0;
}

/** Active work first, then settled work, each newest first. */
export function sortEngagementsForPanel(
  engagements: ReadonlyArray<CodeItLabEngagement>,
): ReadonlyArray<CodeItLabEngagement> {
  return [...engagements].sort((left, right) => {
    const active =
      Number(engagementIsActive(right.status)) - Number(engagementIsActive(left.status));
    return active === 0 ? updatedAtMs(right) - updatedAtMs(left) : active;
  });
}

export function formatEngagementTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "time not reported";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(ms);
}

/** Polling and sending both need the same honest answer: can this bridge talk? */
export function engagementBridgeIsUsable(bridge: CodeItLabEngagementBridge | null): boolean {
  return bridge !== null && bridge.enabled && !bridge.readOnly;
}

export const codeitlabEngagementApplyToJobCommand = createEnvironmentRpcCommand(
  connectionAtomRuntime,
  {
    label: "codeitlab:engagements:apply-to-job",
    tag: WS_METHODS.codeitlabEngagementsApplyToJob,
  },
);

/**
 * Applying is a one-shot command, not a query: the marketplace owns the job's
 * state, so the panel only needs the answer for the click that asked for it.
 */
export function useCodeItLabEngagementApplyToJob(environmentId: EnvironmentId | null) {
  const applyCommand = useAtomCommand(codeitlabEngagementApplyToJobCommand, {
    reportFailure: false,
  });
  return async (
    input: CodeItLabEngagementApplyToJobInput,
  ): Promise<CodeItLabEngagementApplyToJobResult | null> => {
    if (environmentId === null) return null;
    const result = await applyCommand({ environmentId, input });
    return result._tag === "Success" ? result.value : null;
  };
}
export const codeitlabProfilePublishCommand = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "codeitlab:profile:publish",
  tag: WS_METHODS.codeitlabProfilePublish,
});

/**
 * Publishing copies the profile to the marketplace once, on the click that asks
 * for it. Nothing retries behind the user, so a refusal is reported verbatim.
 */
export function useCodeItLabProfilePublish(environmentId: EnvironmentId | null) {
  const publishCommand = useAtomCommand(codeitlabProfilePublishCommand, {
    reportFailure: false,
  });
  return async (
    input: CodeItLabProfilePublishInput,
  ): Promise<CodeItLabProfilePublishResult | null> => {
    if (environmentId === null) return null;
    const result = await publishCommand({ environmentId, input });
    return result._tag === "Success" ? result.value : null;
  };
}
