import {
  engagementAvailableActions,
  engagementMessageProblem,
  formatEngagementAmount,
  isHttpUrl,
  normalizeMarketplaceUrl,
  type CodeItLabEngagement,
  type CodeItLabEngagementAction,
  type CodeItLabEngagementBridge,
  type CodeItLabEngagementConfigureInput,
} from "@codeitlab/contracts";
import { ExternalLinkIcon, RefreshCwIcon, SendIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  engagementBridgeIsUsable,
  engagementCounterpartLabel,
  engagementRoleLabel,
  engagementStatusLabel,
  engagementStatusVariant,
  ENGAGEMENT_POLL_INTERVAL_MS,
  formatEngagementTime,
  sortEngagementsForPanel,
  useCodeItLabEngagements,
  type CodeItLabEngagementThreadView,
} from "../../codeitlab/engagements";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import {
  CodeItLabCard,
  CodeItLabEmptyBlock,
  CodeItLabLoadingRows,
  CodeItLabSectionHeading,
} from "./CodeItLabPrimitives";

/**
 * Engagements are work the marketplace already tracks: this panel reads them,
 * posts messages and moves them along the states the marketplace allows. It
 * holds no money and invents no engagement, and it never decides which
 * transitions are legal — the buttons below only offer what this side could do
 * next, and the marketplace still refuses anything it disagrees with.
 */
export function CodeItLabEngagementsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bridgeNotice, setBridgeNotice] = useState<string | null>(null);
  const [threadNotice, setThreadNotice] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<CodeItLabEngagementAction | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const view = useCodeItLabEngagements(selectedId);
  const { bridge, engagements, error, fetchedAt, isPending, refreshBridge, refreshList, thread } =
    view;

  const sorted = sortEngagementsForPanel(engagements);
  const selected = sorted.find((entry) => entry.id === selectedId) ?? null;
  const activeBridge = thread.bridge ?? bridge;
  const readOnly = !engagementBridgeIsUsable(activeBridge);
  const polling = engagementBridgeIsUsable(bridge);
  const marketplaceUrl = bridge !== null && isHttpUrl(bridge.url) ? bridge.url : null;
  const messageProblem = engagementMessageProblem(draft);
  const refreshThread = thread.refresh;

  // Poll only when the user opted in and the bridge answered usable. A hidden
  // tab is a paused tab: the marketplace does not need the traffic, and the
  // first visible tick catches up.
  useEffect(() => {
    if (!polling) return;
    const tick = () => {
      if (document.hidden) return;
      refreshList();
      refreshThread();
    };
    const interval = window.setInterval(tick, ENGAGEMENT_POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [polling, refreshList, refreshThread]);

  const refreshAll = () => {
    refreshBridge();
    refreshList();
    refreshThread();
  };

  const saveBridge = async (input: CodeItLabEngagementConfigureInput) => {
    setSaving(true);
    setBridgeNotice(null);
    const next = await view.configure(input);
    setSaving(false);
    if (next === null) {
      setBridgeNotice("Could not save the bridge; the server did not answer.");
      return;
    }
    setBridgeNotice(next.readOnly ? "Saved. " + next.reason : "Saved the marketplace bridge.");
  };

  const toggleEnabled = async (enabled: boolean) => {
    if (bridge === null) return;
    setSaving(true);
    setBridgeNotice(null);
    const next = await view.configure({ url: bridge.url, enabled });
    setSaving(false);
    if (next === null) {
      setBridgeNotice("Could not change the bridge; the server did not answer.");
      return;
    }
    setBridgeNotice(
      enabled
        ? "The bridge is on; the panel reads and polls every 15 seconds."
        : "The bridge is off. The URL and token stay saved.",
    );
  };

  const move = async (id: string, action: CodeItLabEngagementAction) => {
    setTransitioning(action);
    setActionNotice(null);
    const result = await view.transition(id, action);
    setTransitioning(null);
    if (result === null) {
      setActionNotice("The marketplace did not answer, so nothing changed.");
      return;
    }
    if (!result.transitioned) {
      setActionNotice(result.reason);
      return;
    }
    // The new status arrives from the refreshed list rather than from a guess here.
    setActionNotice("The marketplace recorded the change.");
  };

  const send = async () => {
    if (selectedId === null) return;
    if (readOnly || messageProblem !== "") return;
    setSending(true);
    setThreadNotice(null);
    const result = await view.postMessage(selectedId, draft.trim());
    setSending(false);
    if (result === null) {
      setThreadNotice("The marketplace did not answer, so nothing was sent.");
      return;
    }
    if (!result.posted) {
      setThreadNotice(result.reason);
      return;
    }
    setDraft("");
    setThreadNotice("Sent to the marketplace thread.");
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="engagements">
      <CodeItLabSectionHeading
        eyebrow="CodeItLab // engagements"
        title="Engagements"
        description="Work you hired or were hired for, read from your own marketplace deployment. The marketplace owns the status, the amount and the release; this panel reads them and posts messages to the thread it already keeps."
        action={
          <Button onClick={refreshAll} size="sm" type="button" variant="outline">
            <RefreshCwIcon aria-hidden />
            Refresh
          </Button>
        }
      />

      <BridgeCard
        bridge={bridge}
        error={error}
        isPending={isPending}
        key={(bridge?.url ?? "") + "|" + String(bridge?.enabled ?? false)}
        notice={bridgeNotice}
        onRetry={refreshBridge}
        onSave={(input) => void saveBridge(input)}
        onToggleEnabled={(enabled) => void toggleEnabled(enabled)}
        saving={saving}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="codeitlab-engagements-list" className="flex flex-col gap-3">
          <h2
            className="font-display text-sm font-semibold text-foreground"
            id="codeitlab-engagements-list"
          >
            Engagements
          </h2>
          {isPending && engagements.length === 0 ? (
            <CodeItLabLoadingRows label="Loading engagements" />
          ) : null}
          {error !== null ? (
            <p className="text-xs text-warning-foreground" role="alert">
              {error}
            </p>
          ) : null}
          {engagements.length === 0 && !isPending ? (
            <CodeItLabEmptyBlock
              action={
                marketplaceUrl === null ? undefined : (
                  <a
                    className="text-xs underline underline-offset-2"
                    href={marketplaceUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open the marketplace
                  </a>
                )
              }
              description="Engagements appear here once your marketplace deployment tracks one. This panel never invents one."
              title="Nothing hired yet"
            />
          ) : (
            <CodeItLabCard>
              {fetchedAt === null ? null : (
                <p className="border-b border-border/40 px-4 py-2 text-2xs tabular-nums text-muted-foreground">
                  read at {formatEngagementTime(fetchedAt)}
                </p>
              )}
              <ul>
                {sorted.map((engagement) => (
                  <EngagementRow
                    engagement={engagement}
                    key={engagement.id}
                    onSelect={(id) => {
                      setThreadNotice(null);
                      // A refusal belongs to the engagement that produced it.
                      setActionNotice(null);
                      setSelectedId((current) => (current === id ? null : id));
                    }}
                    selected={engagement.id === selectedId}
                  />
                ))}
              </ul>
            </CodeItLabCard>
          )}
        </section>

        <section aria-labelledby="codeitlab-engagement-thread" className="flex flex-col gap-3">
          <h2
            className="font-display text-sm font-semibold text-foreground"
            id="codeitlab-engagement-thread"
          >
            Thread
          </h2>
          {selected === null ? (
            <CodeItLabEmptyBlock
              description="Open an engagement to read its thread and reply to the other side. Nothing is sent until the bridge is configured and turned on."
              title="No engagement selected"
            />
          ) : (
            <CodeItLabCard>
              <div className="flex flex-col gap-2 border-b border-border/50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {selected.jobTitle}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <Badge size="sm" variant="outline">
                        {engagementRoleLabel(selected.role)}
                      </Badge>
                      <span>{engagementCounterpartLabel(selected)}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatEngagementAmount(selected.amountCents, selected.currency)}
                    </span>
                    <Badge size="sm" variant={engagementStatusVariant(selected.status)}>
                      {engagementStatusLabel(selected.status)}
                    </Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Next: {selected.nextStep}</p>
                {readOnly ? null : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {engagementAvailableActions(selected.role, selected.status).map((entry) => (
                      <Button
                        disabled={transitioning !== null}
                        key={entry.action}
                        onClick={() => void move(selected.id, entry.action)}
                        size="sm"
                        variant={entry.action === "approve" ? "default" : "outline"}
                      >
                        {transitioning === entry.action ? "Working…" : entry.label}
                      </Button>
                    ))}
                  </div>
                )}
                {actionNotice === null ? null : (
                  <p className="mt-2 text-xs text-muted-foreground" role="status">
                    {actionNotice}
                  </p>
                )}
              </div>

              <ThreadBody thread={thread} />

              <div className="border-t border-border/50 px-4 py-3">
                {readOnly ? (
                  <p className="mb-2 text-xs text-warning-foreground" data-engagement-readonly>
                    {activeBridge?.reason ?? "The marketplace bridge is read-only."}
                  </p>
                ) : null}
                <Textarea
                  aria-label="Message"
                  disabled={readOnly}
                  onChange={(event) => setDraft(event.currentTarget.value)}
                  placeholder="Write to the other side of this engagement"
                  value={draft}
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-2xs text-muted-foreground">
                    {readOnly
                      ? "The marketplace owns this thread; nothing is sent while the bridge is read-only."
                      : messageProblem === ""
                        ? "Posted to the marketplace thread, not to a local one."
                        : messageProblem}
                  </span>
                  <Button
                    disabled={readOnly || messageProblem !== "" || sending}
                    onClick={() => void send()}
                    size="sm"
                    type="button"
                  >
                    <SendIcon aria-hidden />
                    {sending ? "Sending…" : "Send"}
                  </Button>
                </div>
                {threadNotice === null ? null : (
                  <p className="mt-2 text-xs text-muted-foreground" role="status">
                    {threadNotice}
                  </p>
                )}
              </div>
            </CodeItLabCard>
          )}
        </section>
      </div>

      <p className="text-xs text-muted-foreground">
        This app does not hold money, does not mediate and does not decide a release. Amounts,
        statuses and next steps are what the configured marketplace returned.
      </p>
    </div>
  );
}

function BridgeCard({
  bridge,
  error,
  isPending,
  notice,
  onRetry,
  onSave,
  onToggleEnabled,
  saving,
}: {
  readonly bridge: CodeItLabEngagementBridge | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly notice: string | null;
  readonly onRetry: () => void;
  readonly onSave: (input: CodeItLabEngagementConfigureInput) => void;
  readonly onToggleEnabled: (enabled: boolean) => void;
  readonly saving: boolean;
}) {
  const [url, setUrl] = useState(bridge?.url ?? "");
  const [token, setToken] = useState("");
  const [optIn, setOptIn] = useState(bridge?.enabled ?? false);
  const [formError, setFormError] = useState<string | null>(null);

  const badge =
    bridge === null
      ? { label: "Checking", variant: "secondary" as const }
      : bridge.readOnly
        ? { label: "Read-only", variant: "warning" as const }
        : { label: "Connected", variant: "success" as const };

  const save = () => {
    const trimmedUrl = url.trim();
    if (trimmedUrl !== "" && normalizeMarketplaceUrl(trimmedUrl) === "") {
      setFormError("The marketplace URL must start with http:// or https://.");
      return;
    }
    setFormError(null);
    onSave({
      url: trimmedUrl,
      enabled: optIn,
      ...(token.trim() === "" ? {} : { token: token.trim() }),
    });
  };

  return (
    <CodeItLabCard>
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 px-4 py-3">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-foreground">Marketplace bridge</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your own deployment holds the engagements and the token. The app reads them and posts
            messages; it never moves money.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge size="sm" variant={badge.variant}>
            {badge.label}
          </Badge>
          <Button
            aria-label="Refresh the marketplace bridge"
            onClick={onRetry}
            size="icon-xs"
            type="button"
            variant="ghost"
          >
            <RefreshCwIcon aria-hidden />
          </Button>
        </div>
      </div>

      {bridge === null && isPending ? (
        <div className="px-4 py-3">
          <CodeItLabLoadingRows label="Loading the marketplace bridge" rows={2} />
        </div>
      ) : null}

      {bridge === null && error !== null ? (
        <p className="px-4 py-3 text-xs text-warning-foreground" role="alert">
          {error}
        </p>
      ) : null}

      {bridge !== null && bridge.readOnly ? (
        <p
          className="border-b border-border/40 px-4 py-3 text-xs text-warning-foreground"
          data-engagement-bridge-reason
        >
          {bridge.reason}
        </p>
      ) : null}

      {bridge !== null && !bridge.readOnly ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 px-4 py-3">
          <a
            className="min-w-0 truncate text-xs underline underline-offset-2"
            href={bridge.url}
            rel="noreferrer"
            target="_blank"
          >
            {bridge.url}
          </a>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            Read and post
            <Switch
              aria-label="Read and post to the marketplace"
              checked={bridge.enabled}
              onCheckedChange={onToggleEnabled}
            />
          </span>
        </div>
      ) : null}

      <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Deployment URL
          <Input
            aria-label="Marketplace deployment URL"
            onChange={(event) => setUrl(event.currentTarget.value)}
            placeholder="https://acme.example/market"
            value={url}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          API token
          <Input
            aria-label="Marketplace API token"
            autoComplete="off"
            onChange={(event) => setToken(event.currentTarget.value)}
            placeholder="Paste the token from your marketplace"
            type="password"
            value={token}
          />
        </label>
        <span className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
          Opt in to reading and posting
          <Switch
            aria-label="Opt in to reading and posting"
            checked={optIn}
            onCheckedChange={setOptIn}
          />
        </span>
      </div>
      {formError === null ? null : (
        <p className="px-4 pb-2 text-xs text-warning-foreground" role="alert">
          {formError}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
        <Button disabled={saving} onClick={save} size="sm" type="button">
          {saving ? "Saving…" : "Save bridge"}
        </Button>
        <span className="text-2xs text-muted-foreground">
          The token is stored by the server and never shown again; leave it empty to keep the stored
          one.
        </span>
      </div>
      {notice === null ? null : (
        <p className="px-4 pb-3 text-xs text-muted-foreground" role="status">
          {notice}
        </p>
      )}
    </CodeItLabCard>
  );
}

function EngagementRow({
  engagement,
  onSelect,
  selected,
}: {
  readonly engagement: CodeItLabEngagement;
  readonly onSelect: (id: string) => void;
  readonly selected: boolean;
}) {
  return (
    <li
      className="flex flex-col gap-2 border-t border-border/40 px-4 py-3 first:border-t-0"
      data-engagement-id={engagement.id}
      data-engagement-status={engagement.status}
      data-selected={selected ? "true" : undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{engagement.jobTitle}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge size="sm" variant="outline">
              {engagementRoleLabel(engagement.role)}
            </Badge>
            <span>{engagementCounterpartLabel(engagement)}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {formatEngagementAmount(engagement.amountCents, engagement.currency)}
          </span>
          <Badge size="sm" variant={engagementStatusVariant(engagement.status)}>
            {engagementStatusLabel(engagement.status)}
          </Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Next: {engagement.nextStep}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <time
          className="text-2xs tabular-nums text-muted-foreground"
          dateTime={engagement.updatedAt}
        >
          Updated {formatEngagementTime(engagement.updatedAt)}
        </time>
        <Button
          aria-label={(selected ? "Close" : "Open") + " the thread for " + engagement.jobTitle}
          onClick={() => onSelect(engagement.id)}
          size="xs"
          type="button"
          variant={selected ? "secondary" : "outline"}
        >
          {selected ? "Close thread" : "Open thread"}
        </Button>
      </div>
    </li>
  );
}

function ThreadBody({ thread }: { readonly thread: CodeItLabEngagementThreadView }) {
  if (thread.isPending && thread.messages.length === 0) {
    return (
      <div className="px-4 py-3">
        <CodeItLabLoadingRows label="Loading the thread" rows={2} />
      </div>
    );
  }
  if (thread.messages.length === 0) {
    return (
      <p className="px-4 py-4 text-xs text-muted-foreground">
        No messages on this thread yet. The first one you send appears here.
      </p>
    );
  }
  return (
    <ul>
      {thread.messages.map((message) => (
        <li
          className="flex flex-col gap-1 border-t border-border/40 px-4 py-3 first:border-t-0"
          data-message-id={message.id}
          key={message.id}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-foreground">{message.authorName}</span>
            <Badge size="sm" variant="secondary">
              {engagementRoleLabel(message.authorRole)}
            </Badge>
            <time
              className="text-2xs tabular-nums text-muted-foreground"
              dateTime={message.createdAt}
            >
              {formatEngagementTime(message.createdAt)}
            </time>
          </div>
          <p className="whitespace-pre-wrap text-sm text-foreground">{message.body}</p>
          {message.evidence.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {message.evidence.map((link) => (
                <li key={link}>
                  <a
                    className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
                    href={link}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLinkIcon aria-hidden className="size-3" />
                    {link}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
