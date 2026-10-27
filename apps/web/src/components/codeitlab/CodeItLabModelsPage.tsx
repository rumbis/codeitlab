import {
  MODEL_ENDPOINT_MODEL_LIMIT,
  modelEndpointDisplayLabel,
  modelEndpointSlug,
  normalizeModelEndpointBaseUrl,
  type CodeItLabModelEndpoint,
  type CodeItLabModelsSettings,
} from "@codeitlab/core/models";
import {
  summarizeModelEndpointProbe,
  type CodeItLabModelEndpointProbeResult,
} from "@codeitlab/core/modelEndpoints";
import { useAtomValue } from "@effect/atom-react";
import { ProviderInstanceId } from "@codeitlab/contracts";
import { makeWindow } from "@codeitlab/shared/usageFormat";
import { PlusIcon, RefreshCwIcon, ShieldCheckIcon, Trash2Icon } from "lucide-react";
import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";

import { cn } from "~/lib/utils";
import {
  useCodeItLabCredentials,
  useCodeItLabModelEndpointProbe,
  useCodeItLabRouting,
} from "../../codeitlab/api";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { usePrimarySettings, useUpdateEnvironmentModelPreferences } from "../../hooks/useSettings";
import {
  buildModelsInventory,
  buildModelsQuota,
  maskingLabel,
  maskingVariant,
  summarizeMasking,
  type ModelInventorySource,
} from "../../codeitlab/modelsInventory";
import {
  buildSessionUnderstanding,
  HEURISTIC_NOTE,
  NO_DECISION_REASON,
  sessionContextLabel,
} from "../../codeitlab/modelsSession";
import { codeitlabProviderName } from "../../codeitlab/providerLabels";
import { environmentPresentations } from "../../state/presentation";
import { useUsage } from "../../state/usage";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import {
  CodeItLabCard,
  CodeItLabEmptyBlock,
  CodeItLabLoadingRows,
  CodeItLabMeter,
  CodeItLabSectionHeading,
  CodeItLabSourceNote,
} from "./CodeItLabPrimitives";
import { CodeItLabContextPage } from "./CodeItLabContextPage";
import { CodeItLabRoutingPage } from "./CodeItLabRoutingPage";

export type CodeItLabModelsTab = "inventory" | "routing" | "context";

const MODELS_TABS = [
  { id: "inventory", label: "Inventory", to: "/settings/codeitlab/models" },
  { id: "routing", label: "Routing", to: "/settings/codeitlab/routing" },
  { id: "context", label: "Context", to: "/settings/codeitlab/context" },
] as const;

interface ProbeEntry {
  readonly result: CodeItLabModelEndpointProbeResult | null;
}

const EMPTY_FORM = { label: "", baseUrl: "", apiKeyEnv: "", modelIds: "" };

/**
 * One place for the three questions the picker could not answer: which models a
 * subscription actually exposes, how much quota is left, and which endpoints and
 * masking rules the user added. Nothing here routes a turn; the router owns
 * that, so the page only reads its catalog and health.
 */
export function CodeItLabModelsPage({
  tab = "inventory",
}: {
  readonly tab?: CodeItLabModelsTab;
} = {}) {
  const routing = useCodeItLabRouting();
  const credentials = useCodeItLabCredentials();
  const probe = useCodeItLabModelEndpointProbe();
  const { codeitlab, environmentId, update } = useCodeItLabSettingsWriter();
  // The picker filters with clientSettings.providerModelPreferences, so this page
  // reads and writes that same record instead of keeping a parallel list.
  const settings = usePrimarySettings();
  const updateModelPreferences = useUpdateEnvironmentModelPreferences(environmentId);
  const presentations = useAtomValue(environmentPresentations.presentationsWithProvidersAtom);
  // One stable window per mount: useUsage compares the window by identity, so a
  // fresh object on every render would loop through its kept-answer state.
  const [usageWindow] = useState(() => makeWindow(30));
  const usage = useUsage(usageWindow);
  const [nowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState<CodeItLabModelsSettings | null>(null);
  const modelsSettings = draft ?? codeitlab.models;
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [probing, setProbing] = useState<string | null>(null);
  const [probeResults, setProbeResults] = useState<Readonly<Record<string, ProbeEntry>>>({});

  const firewallReported = credentials.source === "server";
  const firewallEnabled = firewallReported && credentials.data.enabled;
  const hiddenModelsByInstance: Record<string, ReadonlyArray<string>> = {};
  for (const provider of routing.data.providers) {
    // The catalog carries the instance id as a plain string; the settings record
    // is keyed by the branded id, so re-brand it rather than casting.
    const instanceId = ProviderInstanceId.make(provider.providerInstanceId);
    hiddenModelsByInstance[provider.providerInstanceId] =
      settings.providerModelPreferences?.[instanceId]?.hiddenModels ?? [];
  }
  const inventory = buildModelsInventory({
    catalog: routing.data,
    health: routing.health,
    endpoints: modelsSettings.endpoints,
    hiddenModelsByInstance,
    firewallEnabled,
  });
  // A settings page is not inside a thread, so it has no honest source for the
  // active thread's usage or selection. Pass null for both and let the section
  // say where the per-thread number lives instead of inventing one.
  const session = buildSessionUnderstanding({
    catalog: routing.data,
    decision: routing.history[0] ?? null,
    context: null,
    selected: null,
    hiddenModelsByInstance,
    endpoints: modelsSettings.endpoints.map((endpoint) => ({
      id: endpoint.id,
      label: modelEndpointDisplayLabel(endpoint),
      models: endpoint.models,
    })),
    // Decisions record delegation themselves; this covers decisions made before
    // the flag existed, so an older row still credits the provider's router.
    delegatedProviderKinds: codeitlab.routing?.delegatedProviderKinds ?? [],
  });
  const masking = summarizeMasking({
    firewallReported,
    firewallEnabled,
    endpoints: modelsSettings.endpoints,
  });
  const quotaAccounts = buildModelsQuota({
    nowMs,
    accounts: usage.environments.flatMap((environment) => {
      const providers = presentations.get(environment.environmentId)?.serverConfig?.providers ?? [];
      return providers.map((provider) => ({
        id: String(environment.environmentId) + ":" + String(provider.instanceId),
        label:
          environment.label +
          " · " +
          codeitlabProviderName(provider.displayName ?? provider.instanceId),
        // Only the account label the provider reports is a plan name; the auth
        // type ("api-key") says how it signs in, not what was bought.
        plan: provider.auth.label ?? null,
        windows: (provider.usageLimits?.windows ?? []).map((window) => ({
          id: window.id,
          kind: window.kind,
          label: window.label,
          usedPercent: window.usedPercent,
          resetsAt: window.resetsAt ?? null,
        })),
        unavailable: provider.usageLimits?.unavailable ?? null,
        connected: environment.isConnected,
        error: environment.error,
      }));
    }),
  });

  const saveModels = (next: CodeItLabModelsSettings) => {
    setDraft(next);
    update({ models: next });
  };

  const toggleModel = (source: ModelInventorySource, model: string, hidden: boolean) => {
    // Only provider instances are in the picker; endpoint rows have no toggle.
    if (source.kind !== "provider") return;
    void updateModelPreferences({
      setModelsHidden: [{ provider: ProviderInstanceId.make(source.id), model, hidden }],
    });
    setNotice(
      hidden
        ? "Hid “" + model + "” in the model picker. A thread that already selects it still answers."
        : "Showing “" + model + "” in the model picker again.",
    );
  };

  const addEndpoint = () => {
    const label = form.label.trim();
    const validation = normalizeModelEndpointBaseUrl(form.baseUrl);
    if (!validation.ok) {
      setFormError(validation.reason);
      return;
    }
    if (label === "") {
      setFormError("Give the endpoint a name; the name becomes its id.");
      return;
    }
    const id = modelEndpointSlug(label);
    const replaced = modelsSettings.endpoints.some((endpoint) => endpoint.id === id);
    const typedIds = form.modelIds
      .split(/[\s,]+/)
      .map((modelId) => modelId.trim())
      .filter((modelId) => modelId !== "");
    const models = [...new Set(typedIds)].slice(0, MODEL_ENDPOINT_MODEL_LIMIT);
    const endpoint: CodeItLabModelEndpoint = {
      id,
      label,
      baseUrl: validation.baseUrl,
      apiKeyEnv: form.apiKeyEnv.trim(),
      models,
      enabled: true,
      maskPrompts: true,
    };
    saveModels({
      ...modelsSettings,
      endpoints: [...modelsSettings.endpoints.filter((candidate) => candidate.id !== id), endpoint],
    });
    setForm(EMPTY_FORM);
    setFormError(null);
    setNotice(
      (replaced ? "Replaced " : "Added ") +
        label +
        " (" +
        id +
        "). " +
        (models.length === 0
          ? "No model ids yet: use Fetch models to ask it."
          : models.length + " model ids saved."),
    );
  };

  const removeEndpoint = (endpoint: CodeItLabModelEndpoint) => {
    saveModels({
      ...modelsSettings,
      endpoints: modelsSettings.endpoints.filter((candidate) => candidate.id !== endpoint.id),
    });
    setNotice("Removed " + modelEndpointDisplayLabel(endpoint) + ".");
  };

  const setEndpointEnabled = (endpoint: CodeItLabModelEndpoint, enabled: boolean) => {
    saveModels({
      ...modelsSettings,
      endpoints: modelsSettings.endpoints.map((candidate) =>
        candidate.id === endpoint.id ? { ...candidate, enabled } : candidate,
      ),
    });
    setNotice(
      (enabled ? "Enabled " : "Disabled ") +
        modelEndpointDisplayLabel(endpoint) +
        (enabled ? "." : ". Its models stay listed but cannot be selected."),
    );
  };

  const setEndpointMasking = (endpoint: CodeItLabModelEndpoint, maskPrompts: boolean) => {
    saveModels({
      ...modelsSettings,
      endpoints: modelsSettings.endpoints.map((candidate) =>
        candidate.id === endpoint.id ? { ...candidate, maskPrompts } : candidate,
      ),
    });
    setNotice(
      maskPrompts
        ? "Masking on for " + modelEndpointDisplayLabel(endpoint) + "."
        : "Masking off for " +
            modelEndpointDisplayLabel(endpoint) +
            ": its prompts leave this machine as written.",
    );
  };

  const fetchModels = async (endpoint: CodeItLabModelEndpoint) => {
    setProbing(endpoint.id);
    const result = await probe({ baseUrl: endpoint.baseUrl, apiKeyEnv: endpoint.apiKeyEnv });
    setProbing(null);
    setProbeResults((previous) => ({ ...previous, [endpoint.id]: { result } }));
  };

  const saveDiscoveredModels = (
    endpoint: CodeItLabModelEndpoint,
    result: CodeItLabModelEndpointProbeResult,
  ) => {
    const models = result.models.slice(0, MODEL_ENDPOINT_MODEL_LIMIT);
    saveModels({
      ...modelsSettings,
      endpoints: modelsSettings.endpoints.map((candidate) =>
        candidate.id === endpoint.id ? { ...candidate, models: [...models] } : candidate,
      ),
    });
    setNotice(
      "Saved " + models.length + " model ids for " + modelEndpointDisplayLabel(endpoint) + ".",
    );
  };

  return (
    <div
      className="flex flex-col gap-6"
      data-codeitlab-models-tab={tab}
      data-codeitlab-page="models"
    >
      <nav aria-label="Models sections" className="flex flex-wrap gap-1">
        {MODELS_TABS.map((entry) => {
          const active = entry.id === tab;
          return (
            <Link
              key={entry.id}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-[color,background-color,border-color] duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active
                  ? "border-codeitlab-green/40 bg-codeitlab-green/12 text-codeitlab-green"
                  : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              data-codeitlab-models-tab-link={entry.id}
              to={entry.to}
            >
              {entry.label}
            </Link>
          );
        })}
      </nav>

      {tab === "routing" ? <CodeItLabRoutingPage /> : null}
      {tab === "context" ? <CodeItLabContextPage /> : null}

      {tab === "inventory" ? (
        <>
          <CodeItLabSourceNote source={routing.source} />

          <CodeItLabSectionHeading
            description="Every model the providers behind your subscriptions advertise, the quota each account reports, and the OpenAI-compatible endpoints you added. Hiding a model only changes the picker; the router still knows about it."
            eyebrow="CodeItLab // models"
            title="Models and quota"
          />

          {notice === null ? null : (
            <p className="text-xs text-muted-foreground" role="status">
              {notice}
            </p>
          )}

          <section
            aria-labelledby="codeitlab-models-session"
            className="flex flex-col gap-3"
            data-codeitlab-session-understanding="true"
          >
            <CodeItLabSectionHeading
              description="What this app read from the newest prompt, joined onto the same model list below. The task class and the reason come from the router's own decision; the coverage line counts what providers advertise, not just what they list."
              eyebrow="CodeItLab // models · session"
              title="Session understanding"
            />
            <h2 className="sr-only" id="codeitlab-models-session">
              Session understanding
            </h2>
            <CodeItLabCard>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-4 py-3">
                <p className="text-sm font-medium tabular-nums text-foreground">
                  showing {session.shown} of {session.advertised} advertised
                </p>
                {session.chip === null ? null : (
                  <Badge size="sm" variant="info">
                    {session.chip.label}
                  </Badge>
                )}
              </div>
              <div className="border-b border-border/50 px-4 py-3">
                {session.chip === null ? (
                  <p className="text-xs text-muted-foreground">{NO_DECISION_REASON}</p>
                ) : (
                  <>
                    <p className="text-sm text-foreground">{session.chip.reason}</p>
                    <p className="mt-1 text-2xs text-muted-foreground">{HEURISTIC_NOTE}</p>
                  </>
                )}
              </div>
              {session.rows.length === 0 ? (
                <p className="border-b border-border/50 px-4 py-3 text-xs text-muted-foreground">
                  No model source has reported yet, so there is no row to explain.
                </p>
              ) : (
                <ul className="divide-y divide-border/40">
                  {session.rows.map((row) => (
                    <li
                      className="flex flex-col gap-1 px-4 py-2.5"
                      data-session-model={row.key}
                      key={row.key}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-foreground">{row.model}</span>
                        <span className="text-2xs text-muted-foreground">{row.providerLabel}</span>
                        {row.routerWouldPick ? (
                          <Badge size="sm" variant="success">
                            would pick now
                          </Badge>
                        ) : null}
                        {row.selected ? (
                          <Badge size="sm" variant="info">
                            selected
                          </Badge>
                        ) : null}
                        {row.selectable ? null : (
                          <Badge size="sm" variant="secondary">
                            not selectable
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{row.routerWhy}</p>
                      <p className="flex flex-wrap items-center gap-x-3 text-2xs tabular-nums text-muted-foreground">
                        <span>
                          {row.score === null
                            ? "score not reported"
                            : "score " + row.score.toFixed(2)}
                        </span>
                        {row.selected ? <span>context {sessionContextLabel(row)}</span> : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="border-t border-border/50 px-4 py-3 text-2xs text-muted-foreground">
                Context usage is shown per thread in the composer picker; this page does not read
                the active thread's usage.
              </p>
            </CodeItLabCard>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="codeitlab-models-every-model">
            <CodeItLabSectionHeading
              eyebrow="01 // inventory"
              title="Every model"
              description="One row per advertised model, whether or not the router probes it. Latency is what the speed probe measured, not a guess; a model the probe never covered says so."
            />
            <h2 className="sr-only" id="codeitlab-models-every-model">
              Every model
            </h2>
            {inventory.sources.length === 0 ? (
              <CodeItLabEmptyBlock
                title="No model source has reported yet"
                description="Providers appear here once a harness reports its model list, and custom endpoints appear once you add one below. Nothing is hidden while this is empty."
              />
            ) : (
              <CodeItLabCard>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 font-medium">Measured latency</th>
                        <th className="px-3 py-2 font-medium">Visibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventory.sources.map((source) => (
                        <Fragment key={source.kind + ":" + source.id}>
                          <tr className="border-b border-border/40 bg-muted/40">
                            <td className="px-3 py-2" colSpan={3}>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-display text-xs font-semibold text-foreground">
                                  {source.label}
                                </span>
                                <Badge size="sm" variant="outline">
                                  {source.countLabel}
                                </Badge>
                                {source.kind === "endpoint" ? (
                                  <Badge size="sm" variant="info">
                                    Custom endpoint
                                  </Badge>
                                ) : null}
                                {source.available ? null : (
                                  <Badge size="sm" variant="secondary">
                                    Unavailable
                                  </Badge>
                                )}
                                {source.hiddenCount === 0 ? null : (
                                  <Badge size="sm" variant="secondary">
                                    {source.hiddenCount} hidden
                                  </Badge>
                                )}
                              </div>
                            </td>
                          </tr>
                          {source.rows.length === 0 ? (
                            <tr className="border-b border-border/40 last:border-0">
                              <td className="px-3 py-2 text-xs text-muted-foreground" colSpan={3}>
                                {source.kind === "endpoint"
                                  ? source.emptyReason
                                  : "This provider lists no models right now."}
                              </td>
                            </tr>
                          ) : (
                            source.rows.map((row) => (
                              <tr className="border-b border-border/40 last:border-0" key={row.key}>
                                <td className="max-w-72 px-3 py-2">
                                  <span className="block truncate font-mono text-xs text-foreground">
                                    {row.model}
                                  </span>
                                  {row.defaultModel ? (
                                    <span className="text-2xs text-muted-foreground">default</span>
                                  ) : null}
                                </td>
                                <td className="px-3 py-2 text-2xs tabular-nums text-muted-foreground">
                                  {row.probeFailed ? (
                                    <Badge size="sm" variant="warning">
                                      probe failed
                                    </Badge>
                                  ) : (
                                    row.latencyLabel
                                  )}
                                </td>
                                <td className="px-3 py-2">
                                  {row.pickable ? (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <Switch
                                          aria-label={
                                            (row.hidden ? "Show " : "Hide ") +
                                            row.model +
                                            " from " +
                                            source.label
                                          }
                                          checked={!row.hidden}
                                          onCheckedChange={(checked) =>
                                            toggleModel(source, row.model, !checked)
                                          }
                                        />
                                        <span className="text-2xs text-muted-foreground">
                                          {row.hidden ? "Hidden" : "Shown"}
                                        </span>
                                      </div>
                                      {row.hiddenReason === null ? null : (
                                        <p className="mt-0.5 max-w-64 text-2xs text-muted-foreground">
                                          {row.hiddenReason}
                                        </p>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-2xs text-muted-foreground">
                                      Not in the picker
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CodeItLabCard>
            )}
            <p className="text-xs text-muted-foreground">
              {inventory.totalModels} listed model{inventory.totalModels === 1 ? "" : "s"} ·{" "}
              {inventory.measuredCount} measured · {inventory.hiddenCount} hidden. A hidden model
              still answers when a thread already selects it, and a provider that advertises more
              than it lists keeps the rest available through its own picker.
            </p>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="codeitlab-models-quota">
            <CodeItLabSectionHeading
              eyebrow="02 // subscription"
              title="Subscription quota"
              description="Windows the provider reports for each signed-in account, with the reset time it gave. API-key accounts cannot report windows, so those rows say that instead of drawing an empty bar."
            />
            <h2 className="sr-only" id="codeitlab-models-quota">
              Subscription quota
            </h2>
            {usage.isPending && quotaAccounts.length === 0 ? (
              <CodeItLabLoadingRows label="Loading subscription quota" rows={2} />
            ) : quotaAccounts.length === 0 ? (
              <CodeItLabEmptyBlock
                title="No account reports quota yet"
                description="Quota comes from the provider accounts a connected environment reports. A custom endpoint or an API-key sign-in cannot report usage windows."
                action={
                  <Link className="text-xs underline underline-offset-2" to="/usage">
                    Open Usage and Limits
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {quotaAccounts.map((account) => (
                  <CodeItLabCard key={account.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border/50 px-4 py-3">
                      <div className="min-w-0">
                        <p className="codeitlab-mono-label text-muted-foreground">Account</p>
                        <p className="mt-1 truncate text-sm font-medium text-foreground">
                          {account.label}
                        </p>
                      </div>
                      <Badge size="sm" variant="secondary">
                        Plan: {account.planLabel}
                      </Badge>
                    </div>
                    {account.windows.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-muted-foreground">
                        {account.notReportedReason ?? "No usage windows reported."}
                      </p>
                    ) : (
                      <ul className="px-4 py-2">
                        {account.windows.map((window) => (
                          <li
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5"
                            key={window.id}
                          >
                            <span className="w-24 shrink-0 truncate text-xs text-foreground">
                              {window.label}
                            </span>
                            <CodeItLabMeter value={window.usedPercent / 100} />
                            <span className="text-2xs text-muted-foreground">
                              {window.resetLabel}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {account.windows.length > 0 && account.notReportedReason !== null ? (
                      <p className="px-4 pb-3 text-2xs text-muted-foreground">
                        {account.notReportedReason}
                      </p>
                    ) : null}
                  </CodeItLabCard>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Full limits, reset credits and pooled accounts live in{" "}
              <Link className="underline underline-offset-2" to="/usage">
                Usage → Limits
              </Link>
              .
            </p>
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="codeitlab-models-endpoints">
            <CodeItLabSectionHeading
              eyebrow="03 // gateways"
              title="Custom OpenAI-compatible endpoints"
              description="Anything that speaks the OpenAI API: a gateway, a local server, an aggregator. The key stays in an environment variable on the server; this page shows the variable name, never a value. An endpoint is registered and probed, not dispatched to: coding turns still run through a provider harness, so its models appear in this inventory without becoming turn targets. They are not in the model picker either, so their rows say so instead of offering a visibility switch."
            />
            <h2 className="sr-only" id="codeitlab-models-endpoints">
              Custom OpenAI-compatible endpoints
            </h2>
            <CodeItLabCard>
              <div className="border-b border-border/50 px-4 py-3">
                <p className="font-display text-sm font-semibold text-foreground">
                  Add an endpoint
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The base URL is checked here and again on the server. A public host needs https;
                  plain http is only accepted on this machine or the LAN.
                </p>
              </div>
              <div className="grid gap-3 px-4 py-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Name
                  <Input
                    aria-label="Endpoint name"
                    placeholder="My gateway"
                    value={form.label}
                    onChange={(event) => setForm({ ...form, label: event.currentTarget.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Base URL
                  <Input
                    aria-label="Endpoint base URL"
                    placeholder="https://api.example.com/v1"
                    value={form.baseUrl}
                    onChange={(event) => setForm({ ...form, baseUrl: event.currentTarget.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Key environment variable
                  <Input
                    aria-label="Key environment variable"
                    placeholder="MY_GATEWAY_KEY"
                    value={form.apiKeyEnv}
                    onChange={(event) => setForm({ ...form, apiKeyEnv: event.currentTarget.value })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Model ids (optional)
                  <Input
                    aria-label="Model ids"
                    placeholder="gpt-5.4, llama-3.3-70b"
                    value={form.modelIds}
                    onChange={(event) => setForm({ ...form, modelIds: event.currentTarget.value })}
                  />
                </label>
              </div>
              {formError === null ? null : (
                <p className="px-4 pb-2 text-xs text-warning-foreground" role="alert">
                  {formError}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2 px-4 pb-4">
                <Button size="sm" onClick={addEndpoint}>
                  <PlusIcon />
                  Add endpoint
                </Button>
                <span className="text-2xs text-muted-foreground">
                  Leave the model ids empty and use Fetch models once it is saved.
                </span>
              </div>
            </CodeItLabCard>

            {modelsSettings.endpoints.length === 0 ? (
              <CodeItLabEmptyBlock
                title="No custom endpoint yet"
                description="Add a gateway above and it appears in the model table with its own visibility rows. The built-in agents keep working without one."
              />
            ) : (
              <CodeItLabCard>
                <ul>
                  {modelsSettings.endpoints.map((endpoint) => {
                    const entry = probeResults[endpoint.id];
                    const label = modelEndpointDisplayLabel(endpoint);
                    const inventorySource = inventory.sources.find(
                      (source) => source.kind === "endpoint" && source.id === endpoint.id,
                    );
                    const endpointMasking =
                      inventorySource?.kind === "endpoint" ? inventorySource.masking : "off";
                    const probeResult = entry === undefined ? null : entry.result;
                    const discovered =
                      probeResult !== null && probeResult.reachable && probeResult.models.length > 0
                        ? probeResult
                        : null;
                    const probeLine =
                      entry === undefined
                        ? null
                        : probeResult === null
                          ? "No connected environment answered, so the endpoint was not asked."
                          : summarizeModelEndpointProbe(probeResult);
                    return (
                      <li
                        className="border-t border-border/40 px-4 py-3 first:border-t-0"
                        key={endpoint.id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{label}</p>
                              <Badge size="sm" variant="outline">
                                {inventorySource?.countLabel ?? "no model ids yet"}
                              </Badge>
                              <Badge size="sm" variant={maskingVariant(endpointMasking)}>
                                {maskingLabel(endpointMasking)}
                              </Badge>
                              {endpoint.enabled ? null : (
                                <Badge size="sm" variant="secondary">
                                  Disabled
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 break-all font-mono text-2xs text-muted-foreground">
                              {endpoint.baseUrl}
                            </p>
                            <p className="mt-0.5 text-2xs text-muted-foreground">
                              Key from{" "}
                              <span className="font-mono">
                                {endpoint.apiKeyEnv === ""
                                  ? "no variable (no key)"
                                  : endpoint.apiKeyEnv}
                              </span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Switch
                              aria-label={"Enable " + label}
                              checked={endpoint.enabled}
                              onCheckedChange={(checked) => setEndpointEnabled(endpoint, checked)}
                            />
                            <Button
                              disabled={probing === endpoint.id}
                              size="xs"
                              variant="outline"
                              onClick={() => void fetchModels(endpoint)}
                            >
                              <RefreshCwIcon />
                              {probing === endpoint.id ? "Fetching…" : "Fetch models"}
                            </Button>
                            <Button
                              aria-label={"Remove " + label}
                              size="icon-xs"
                              variant="ghost-destructive"
                              onClick={() => removeEndpoint(endpoint)}
                            >
                              <Trash2Icon />
                            </Button>
                          </div>
                        </div>
                        {probeLine === null ? null : (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
                            <span>{probeLine}</span>
                            {discovered === null ? null : (
                              <Button
                                size="micro"
                                variant="secondary"
                                onClick={() => saveDiscoveredModels(endpoint, discovered)}
                              >
                                Save {discovered.models.length} model ids
                              </Button>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CodeItLabCard>
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="codeitlab-models-masking">
            <CodeItLabSectionHeading
              eyebrow="04 // privacy"
              title="Privacy masking"
              description="What leaves this machine before a provider sees it. The status line is read from the credentials firewall, and a per-endpoint switch can opt that endpoint out of prompt masking."
            />
            <h2 className="sr-only" id="codeitlab-models-masking">
              Privacy masking
            </h2>
            <CodeItLabCard>
              <div className="flex flex-wrap items-start gap-3 border-b border-border/50 px-4 py-3">
                <Badge size="sm" variant={maskingVariant(masking.badge)}>
                  {maskingLabel(masking.badge)}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{masking.headline}</p>
                  <p className="mt-1 max-w-2xl text-xs text-muted-foreground">{masking.detail}</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <ShieldCheckIcon className="size-3.5" />
                  Masking is applied by the local credentials firewall.
                </span>
                <Link
                  className="text-xs underline underline-offset-2"
                  to="/settings/codeitlab/credentials"
                >
                  Open Privacy settings
                </Link>
              </div>
              {modelsSettings.endpoints.length === 0 ? (
                <p className="border-t border-border/50 px-4 py-3 text-xs text-muted-foreground">
                  No custom endpoint is configured. Built-in agents use the firewall above; add an
                  endpoint to give it its own masking choice.
                </p>
              ) : (
                <ul className="border-t border-border/50">
                  {modelsSettings.endpoints.map((endpoint) => {
                    const source = inventory.sources.find(
                      (candidate) => candidate.kind === "endpoint" && candidate.id === endpoint.id,
                    );
                    const badge = source?.kind === "endpoint" ? source.masking : masking.badge;
                    return (
                      <li
                        className="flex flex-wrap items-center justify-between gap-3 border-t border-border/40 px-4 py-2.5 first:border-t-0"
                        key={endpoint.id}
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="truncate text-xs text-foreground">
                            {modelEndpointDisplayLabel(endpoint)}
                          </span>
                          <Badge size="sm" variant={maskingVariant(badge)}>
                            {maskingLabel(badge)}
                          </Badge>
                        </div>
                        <span className="flex items-center gap-2 text-2xs text-muted-foreground">
                          Mask prompts
                          <Switch
                            aria-label={"Mask prompts for " + modelEndpointDisplayLabel(endpoint)}
                            checked={endpoint.maskPrompts}
                            onCheckedChange={(checked) => setEndpointMasking(endpoint, checked)}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CodeItLabCard>
          </section>
        </>
      ) : null}
    </div>
  );
}
