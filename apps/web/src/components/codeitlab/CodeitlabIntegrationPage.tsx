import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, RefreshCwIcon, TerminalIcon } from "lucide-react";

import type {
  CodeitlabIntegrationAction,
  CodeitlabIntegrationId,
  CodeitlabIntegrationStatus,
} from "@t3tools/contracts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { playCodeitlabSfx, unlockCodeitlabAudio } from "../../codeitlab/audio";
import { useCodeitlabIntegrations } from "../../codeitlab/api";
import {
  findIntegration,
  findIntegrationAction,
  findSetupCommand,
  formatIntegrationLatency,
  INTEGRATION_SURFACE_LABELS,
  integrationStateLabel,
  integrationStateVariant,
  integrationWiredCount,
  normalizeBaseUrlInput,
  wiredChipVariant,
} from "../../codeitlab/integrations/model";
import {
  CodeitlabCard,
  CodeitlabEmptyBlock,
  CodeitlabLoadingRows,
  CodeitlabSourceNote,
} from "./CodeitlabPrimitives";
import { IntegrationMark } from "./IntegrationMarks";
import { CodeitlabShortsJobs } from "./CodeitlabShortsJobs";

const DEFAULT_BASE_URL_PLACEHOLDERS: Partial<Record<CodeitlabIntegrationId, string>> = {
  shorts: "http://127.0.0.1:8000",
  crew: "http://127.0.0.1:5173",
};

function SetupCommand({
  action,
  copied,
  onCopy,
}: {
  readonly action: CodeitlabIntegrationAction;
  readonly copied: boolean;
  readonly onCopy: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-3">
      <p className="codeitlab-mono-label text-muted-foreground">
        {action.kind === "install" ? "SELF-HOST" : "SETUP"}
      </p>
      <code className="break-all font-mono text-xs text-foreground">{action.value}</code>
      {action.hint === undefined ? null : (
        <p className="text-xs text-muted-foreground">{action.hint}</p>
      )}
      <div>
        <Button size="sm" variant="outline" onClick={onCopy} aria-label="Copy setup command">
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? "Copied" : "Copy command"}
        </Button>
      </div>
    </div>
  );
}

function BaseUrlEditor({
  status,
  busy,
  onSave,
}: {
  readonly status: CodeitlabIntegrationStatus;
  readonly busy: boolean;
  readonly onSave: (baseUrl: string) => void;
}) {
  const [draft, setDraft] = useState(status.baseUrl ?? "");
  const normalized = normalizeBaseUrlInput(draft);
  const dirty = normalized !== normalizeBaseUrlInput(status.baseUrl ?? "");
  const placeholder = DEFAULT_BASE_URL_PLACEHOLDERS[status.id] ?? "https://example.com";

  return (
    <form
      className="flex flex-col gap-2 border-t border-border/50 px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty) onSave(normalized);
      }}
      data-integration-base-url-form
    >
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Base URL
        <Input
          size="sm"
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={`${status.name} base URL`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" type="submit" disabled={busy || !dirty}>
          Save
        </Button>
        <span className="text-2xs text-muted-foreground">
          {dirty
            ? `Will save ${normalized.length === 0 ? "no override (use the default)" : normalized}`
            : "Saved value is in use."}
        </span>
      </div>
    </form>
  );
}

export function CodeitlabIntegrationPage({ id }: { readonly id: CodeitlabIntegrationId }) {
  const integrations = useCodeitlabIntegrations();
  const status = findIntegration(integrations.data.integrations, id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (key: string, value: string) => {
    unlockCodeitlabAudio();
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard access can be denied (unfocused window, no permission); the
      // value stays visible on screen so the user can still select it.
      return;
    }
    setCopied(key);
    playCodeitlabSfx("click");
    window.setTimeout(() => {
      setCopied((current) => (current === key ? null : current));
    }, 2000);
  };

  const update = async (patch: { enabled?: boolean; baseUrl?: string }) => {
    unlockCodeitlabAudio();
    setBusy(true);
    setMessage(null);
    setActionError(null);
    try {
      const result = await integrations.set({ id, ...patch });
      setMessage(
        result === null
          ? "This needs the integrations RPC; the preview state below is unchanged."
          : "Saved.",
      );
      playCodeitlabSfx("success");
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not save the change.");
      playCodeitlabSfx("error");
    }
    setBusy(false);
  };

  const name = status?.name ?? id;
  const repoAction = status === null ? null : findIntegrationAction(status.actions, "repo");
  const setupCommand = status === null ? null : findSetupCommand(status.actions);
  const otherActions =
    status === null
      ? []
      : status.actions.filter((action) => action.id !== "repo" && action.id !== setupCommand?.id);
  const latency = status === null ? null : formatIntegrationLatency(status.latencyMs);
  const wiredCount = integrationWiredCount(integrations.data.wired);

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page={id}>
      <CodeitlabSourceNote source={integrations.source} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-codeitlab-green/25 bg-codeitlab-green/6 text-codeitlab-green">
            <IntegrationMark id={id} className="size-9" />
          </span>
          <div className="min-w-0">
            <p className="codeitlab-mono-label text-codeitlab-green/80">
              {INTEGRATION_SURFACE_LABELS[id]}
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground">
              {name}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {status?.tagline ??
                "Whitelabel CodeitLab surface backed by a separate open-source engine."}
            </p>
          </div>
        </div>
        {status === null ? null : (
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span data-integration-state={status.state}>
                <Badge size="sm" variant={integrationStateVariant(status.state)}>
                  {integrationStateLabel(status.state)}
                </Badge>
              </span>
              {latency === null ? null : (
                <span className="font-mono text-2xs text-muted-foreground">{latency}</span>
              )}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              {status.enabled ? "Enabled" : "Disabled"}
              <Switch
                aria-label={`Enable ${status.name}`}
                checked={status.enabled}
                disabled={busy}
                onCheckedChange={(checked) => void update({ enabled: checked })}
              />
            </label>
          </div>
        )}
      </div>

      {integrations.error === null ? null : (
        <Alert variant="error" data-integration-error>
          <AlertTitle>{name} status unavailable</AlertTitle>
          <AlertDescription>
            <p>{integrations.error}</p>
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={() => integrations.refresh()}>
                <RefreshCwIcon className="size-3.5" />
                Retry
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {actionError === null ? null : (
        <Alert variant="error" data-integration-action-error>
          <AlertTitle>Change not saved</AlertTitle>
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {message === null ? null : (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}

      {integrations.isPending && integrations.source === "local" ? (
        <CodeitlabLoadingRows rows={3} />
      ) : status === null ? (
        <CodeitlabEmptyBlock
          title={`${name} is not in this build`}
          description="The server did not return this integration. Refresh once the integrations RPC answers."
          action={
            <Button size="sm" variant="outline" onClick={() => integrations.refresh()}>
              <RefreshCwIcon className="size-3.5" />
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <CodeitlabCard data-integration-detail>
            <div className="flex flex-col gap-2 px-4 py-4">
              <p className="codeitlab-mono-label text-muted-foreground">STATUS DETAIL</p>
              <p className="text-sm text-foreground">
                {status.detail ?? "The server did not add a detail line for this state."}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                <Badge size="sm" variant="outline">
                  {status.engine}
                </Badge>
                <span>{status.configured ? "configured" : "not configured"}</span>
                <span>·</span>
                <span>{status.reachable ? "reachable" : "not reachable"}</span>
                {status.baseUrl === undefined ? null : (
                  <>
                    <span>·</span>
                    <code className="break-all font-mono">{status.baseUrl}</code>
                  </>
                )}
              </div>
            </div>
            {status.state === "unreachable" ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-4 py-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => integrations.refresh()}
                  data-integration-retry
                >
                  <RefreshCwIcon className="size-3.5" />
                  Retry connection
                </Button>
                <span className="text-2xs text-muted-foreground">
                  Checks the URL again; the detail above comes from the last probe.
                </span>
              </div>
            ) : null}
          </CodeitlabCard>

          {id === "search" ? (
            <CodeitlabCard data-integration-setup>
              <div className="flex flex-col gap-2 px-4 py-4">
                <p className="codeitlab-mono-label text-muted-foreground">HOW IT WORKS</p>
                <p className="text-sm text-foreground">
                  Search has no base URL. It ships as a CLI plus a skill: enabling it writes the
                  Search skill into the catalog, so agents can search the web and X without being
                  asked.
                </p>
              </div>
              {setupCommand === null ? (
                <p className="mx-4 mb-4 text-xs text-muted-foreground">
                  The server did not send a setup command for Search.
                </p>
              ) : (
                <div className="px-4 pb-4">
                  <SetupCommand
                    action={setupCommand}
                    copied={copied === "setup"}
                    onCopy={() => void copy("setup", setupCommand.value)}
                  />
                </div>
              )}
            </CodeitlabCard>
          ) : (
            <CodeitlabCard data-integration-controls>
              <div className="flex items-center justify-between gap-2 px-4 pt-4">
                <div>
                  <h3 className="font-display text-sm font-semibold text-foreground">Connection</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Point CodeitLab at your own {status.engine} instance. Nothing is bundled; the
                    engine runs where you host it.
                  </p>
                </div>
              </div>
              <div className="px-4 pt-3">
                <BaseUrlEditor
                  key={`${status.id}:${status.baseUrl ?? ""}`}
                  status={status}
                  busy={busy}
                  onSave={(baseUrl) => void update({ baseUrl })}
                />
              </div>
              {setupCommand === null ? null : (
                <div className="px-4 pb-4" data-integration-setup>
                  <SetupCommand
                    action={setupCommand}
                    copied={copied === "setup"}
                    onCopy={() => void copy("setup", setupCommand.value)}
                  />
                </div>
              )}
            </CodeitlabCard>
          )}

          {status.id === "shorts" ? <CodeitlabShortsJobs status={status} /> : null}

          {otherActions.length === 0 ? null : (
            <CodeitlabCard data-integration-actions>
              <div className="flex flex-col gap-2 px-4 py-4">
                <p className="codeitlab-mono-label text-muted-foreground">ACTIONS</p>
                <div className="flex flex-wrap items-center gap-2">
                  {otherActions.map((action) =>
                    action.kind === "link" ? (
                      <Button
                        key={action.id}
                        size="sm"
                        variant="outline"
                        render={<a href={action.value} target="_blank" rel="noreferrer noopener" />}
                        data-integration-action={action.id}
                      >
                        <ExternalLinkIcon className="size-3.5" />
                        {action.label}
                      </Button>
                    ) : (
                      <Button
                        key={action.id}
                        size="sm"
                        variant="outline"
                        onClick={() => void copy(`action:${action.id}`, action.value)}
                        data-integration-action={action.id}
                      >
                        {copied === `action:${action.id}` ? (
                          <CheckIcon className="size-3.5" />
                        ) : (
                          <TerminalIcon className="size-3.5" />
                        )}
                        {copied === `action:${action.id}` ? "Copied" : action.label}
                      </Button>
                    ),
                  )}
                </div>
                {otherActions.some((action) => action.hint !== undefined) ? (
                  <ul className="mt-1 flex flex-col gap-1 text-2xs text-muted-foreground">
                    {otherActions.map((action) =>
                      action.hint === undefined ? null : (
                        <li key={`${action.id}:hint`}>
                          <span className="font-medium text-foreground">{action.label}:</span>{" "}
                          {action.hint}
                        </li>
                      ),
                    )}
                  </ul>
                ) : null}
              </div>
            </CodeitlabCard>
          )}

          <CodeitlabCard data-integration-attribution>
            <div className="flex flex-col gap-2 px-4 py-4">
              <p className="text-sm text-foreground">
                Powered by <span className="font-semibold">{status.engine}</span>
                {repoAction === null ? null : (
                  <>
                    {" — "}
                    <a
                      className="text-codeitlab-cyan underline underline-offset-2 hover:text-codeitlab-green"
                      href={repoAction.value}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {repoAction.label}
                    </a>
                  </>
                )}
              </p>
              <p className="max-w-3xl text-xs text-muted-foreground">
                {status.engine} is separate open-source software with its own maintainers and
                license. CodeitLab provides this branded surface, configuration, and agent wiring;
                it does not bundle or relicense the engine.
              </p>
              {repoAction?.hint === undefined ? null : (
                <p className="text-2xs text-muted-foreground">{repoAction.hint}</p>
              )}
            </div>
          </CodeitlabCard>

          {status.wired.length === 0 ? null : (
            <CodeitlabCard data-integration-surface-wired>
              <div className="flex flex-col gap-2 px-4 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="codeitlab-mono-label text-codeitlab-green/80">
                    WIRED BY THIS SURFACE
                  </p>
                  <Badge size="sm" variant="outline">
                    {status.wired.length}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  What {status.name} registered into the catalog while it is live.
                </p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {status.wired.map((entry) => (
                    <Badge key={`surface:${entry}`} size="sm" variant={wiredChipVariant(entry)}>
                      {entry}
                    </Badge>
                  ))}
                </div>
              </div>
            </CodeitlabCard>
          )}

          <CodeitlabCard data-integration-wired>
            <div className="flex flex-col gap-2 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="codeitlab-mono-label text-muted-foreground">
                  WIRED FOR AGENTS · WHOLE ENVIRONMENT
                </p>
                <Badge size="sm" variant="outline">
                  {wiredCount}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Everything the whole environment exposes to agents automatically — no prompt or
                manual tool selection needed.
              </p>
              {wiredCount === 0 ? (
                <p className="text-xs text-muted-foreground" data-integration-wired-empty>
                  Nothing is wired yet. Enable the integration so its agent surface is registered.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {integrations.data.wired.mcpServers.map((server) => (
                    <Badge key={`mcp:${server}`} size="sm" variant="info">
                      MCP · {server}
                    </Badge>
                  ))}
                  {integrations.data.wired.skills.map((skill) => (
                    <Badge key={`skill:${skill}`} size="sm" variant="secondary">
                      skill · {skill}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CodeitlabCard>
        </>
      )}
    </div>
  );
}
