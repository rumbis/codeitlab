import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, PackagePlusIcon, RefreshCwIcon } from "lucide-react";

import { ProviderInstanceId } from "@t3tools/contracts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useCodeitlabAgents } from "../../codeitlab/agents";
import type { AgentHealth } from "../../codeitlab/agents.logic";
import {
  AGENT_TIER_LABELS,
  FREEMIUM_KIND_LABELS,
  agentAvailability,
  detectRegionCountry,
  type AgentAvailability,
  type AgentTier,
  type FreemiumKind,
} from "../../codeitlab/freemiumAgents";
import { playCodeitlabSfx, unlockCodeitlabAudio } from "../../codeitlab/audio";
import { AcpRegistryAgentIcon } from "../settings/AcpRegistryIcon";
import {
  CodeitlabCard,
  CodeitlabLoadingRows,
  CodeitlabSectionHeading,
  CodeitlabSourceNote,
} from "./CodeitlabPrimitives";

const KIND_BADGE_VARIANT: Record<FreemiumKind, "success" | "warning" | "info" | "secondary"> = {
  "free-tier": "success",
  "free-credits": "warning",
  "byo-key": "info",
  "open-source": "secondary",
};

const HEALTH_BADGE: Record<
  AgentHealth,
  { readonly label: string; readonly variant: "success" | "warning" | "error" | "outline" }
> = {
  ready: { label: "Ready", variant: "success" },
  "sign-in": { label: "Sign in needed", variant: "warning" },
  attention: { label: "Needs attention", variant: "error" },
  disabled: { label: "Disabled", variant: "outline" },
};

function providersSearch(instanceId: string | null) {
  return instanceId === null ? {} : { instanceId: ProviderInstanceId.make(instanceId) };
}

const KIND_FILTERS: ReadonlyArray<{
  readonly value: FreemiumKind | "all";
  readonly label: string;
}> = [
  { value: "all", label: "All" },
  { value: "free-tier", label: FREEMIUM_KIND_LABELS["free-tier"] },
];

/** Locale detection is intentionally read once per mount. */
function detectCountry(): string | null {
  if (typeof navigator === "undefined") return null;
  return detectRegionCountry();
}

interface AgentCardProps {
  readonly id: string;
  readonly tier: AgentTier;
  readonly name: string;
  readonly summary: string;
  readonly version: string | null;
  readonly icon: string | null;
  readonly badgeLabel: string;
  readonly badgeVariant: "success" | "warning" | "info" | "secondary";
  readonly note: string;
  readonly caveat?: string | undefined;
  readonly docsUrl: string | null;
  readonly availability?: AgentAvailability | undefined;
  readonly country: string | null;
  readonly installed: boolean;
  readonly instanceId: string | null;
  readonly installing: boolean;
  readonly health: AgentHealth | null;
  readonly healthMessage: string | null;
  readonly installDisabled: boolean;
  readonly onInstall: () => void;
}

function AgentCard(props: AgentCardProps) {
  const availability = agentAvailability(props, props.country);
  return (
    <CodeitlabCard
      className="flex flex-col gap-3 p-4"
      data-agent-id={props.id}
      data-agent-tier={props.tier}
      data-agent-installed={props.installed ? "true" : "false"}
    >
      <div className="flex items-start gap-3">
        <AcpRegistryAgentIcon icon={props.icon} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-foreground">{props.name}</h3>
            <Badge size="sm" variant={props.badgeVariant}>
              {props.badgeLabel}
            </Badge>
            {props.version === null ? null : (
              <span className="text-2xs text-muted-foreground">v{props.version}</span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{props.summary}</p>
        </div>
      </div>

      <p className="text-xs text-foreground/90">{props.note}</p>
      {props.caveat === undefined ? null : (
        <p className="text-2xs text-muted-foreground">{props.caveat}</p>
      )}
      {availability === "unavailable" ? (
        <Badge size="sm" variant="warning" title={props.availability?.note ?? undefined}>
          Not available in your region
        </Badge>
      ) : availability === "reported-unavailable" ? (
        <Badge size="sm" variant="warning" title={props.availability?.note ?? undefined}>
          Reported unavailable in your region
        </Badge>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {props.installed ? (
          <>
            <Badge
              size="sm"
              variant={props.health === null ? "success" : HEALTH_BADGE[props.health].variant}
              title={props.healthMessage ?? undefined}
            >
              {props.health === null ? "Installed" : HEALTH_BADGE[props.health].label}
            </Badge>
            {props.health === "sign-in" ? (
              <Button
                size="sm"
                render={
                  <Link to="/settings/providers" search={providersSearch(props.instanceId)} />
                }
              >
                Sign in
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              render={<Link to="/settings/providers" search={providersSearch(props.instanceId)} />}
            >
              Manage
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            disabled={props.installDisabled}
            onClick={props.onInstall}
            data-agent-install
          >
            <PackagePlusIcon className="size-3.5" />
            {props.installing ? "Installing…" : "Install"}
          </Button>
        )}
        {props.docsUrl === null ? null : (
          <Button
            size="sm"
            variant="ghost"
            render={<a href={props.docsUrl} target="_blank" rel="noreferrer" />}
          >
            <ExternalLinkIcon className="size-3.5" />
            Docs
          </Button>
        )}
      </div>
    </CodeitlabCard>
  );
}

export function CodeitlabAgentsPage() {
  const agents = useCodeitlabAgents();
  const [error, setError] = useState<string | null>(null);
  const [tier, setTier] = useState<AgentTier>("freemium");
  /**
   * The objective of this page is "try an agent without a card": free-only
   * mode hides the premium tab and the unverified rest of the registry, and
   * offers a one-click way to turn their provider instances off so the model
   * picker cannot route a prompt to a paid agent by accident.
   */
  const [freeOnly, setFreeOnly] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<FreemiumKind | "all">("all");
  const [regionOnly, setRegionOnly] = useState(false);
  const [country] = useState(detectCountry);
  // The settings update that flips a card to Installed lands one render after
  // the install RPC resolves; keep the success visible until then.
  const [justInstalled, setJustInstalled] = useState<ReadonlySet<string>>(new Set());
  const inRegion = (entry: { readonly availability?: AgentAvailability | undefined }) =>
    !regionOnly || agentAvailability(entry, country) !== "unavailable";
  const visibleFreemium = agents.agents
    .filter((agent) => filter === "all" || agent.kind === filter)
    .filter(inRegion);
  const visiblePremium = agents.premiumAgents.filter(inRegion);

  const install = async (agentId: string) => {
    unlockCodeitlabAudio();
    const result = await agents.install(agentId);
    if (result.ok) {
      setError(null);
      setJustInstalled((current) => new Set(current).add(agentId));
      playCodeitlabSfx("success");
      return;
    }
    setError(result.message);
    playCodeitlabSfx("error");
  };

  const loading = agents.isPending && agents.source === "local";
  const installedCount = (agent: { readonly id: string; readonly installed: boolean }) =>
    agent.installed || justInstalled.has(agent.id);

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="agents">
      <CodeitlabSourceNote source={agents.source} />
      <CodeitlabSectionHeading
        eyebrow="Agents // free to start"
        title="Install a free coding agent in one click"
        description="Only agents with a free model or a free-tier subscription are shown: every card below can run without a card. Premium and unverified agents stay one click away when you turn Free only off. CodeitLab downloads the agent, adds it as a provider and enables it, all locally."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              unlockCodeitlabAudio();
              agents.refresh();
            }}
            disabled={agents.source !== "server"}
          >
            <RefreshCwIcon className="size-3.5" />
            Refresh catalog
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {(["freemium", "premium"] as const).map((value) => {
          const count = value === "freemium" ? agents.agents.length : agents.premiumAgents.length;
          if (value === "premium" && freeOnly) return null;
          return (
            <Button
              key={value}
              size="xs"
              variant={tier === value ? "secondary" : "ghost-muted"}
              aria-pressed={tier === value}
              data-agents-tab={value}
              onClick={() => setTier(value)}
            >
              {AGENT_TIER_LABELS[value]} ({count})
            </Button>
          );
        })}
        <Button
          size="xs"
          variant={freeOnly ? "secondary" : "ghost-muted"}
          aria-pressed={freeOnly}
          data-agents-free-only
          onClick={() => {
            setFreeOnly((current) => !current);
            setNotice(null);
            if (freeOnly) setTier("freemium");
          }}
        >
          Free only
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {country === null ? null : (
          <Badge size="sm" variant="outline" data-agents-region>
            Region: {country}
          </Badge>
        )}
        <Button
          size="xs"
          variant={regionOnly ? "secondary" : "ghost-muted"}
          aria-pressed={regionOnly}
          onClick={() => setRegionOnly((current) => !current)}
        >
          Available in my region
        </Button>
        <span>Region comes from the browser locale; vendor terms decide availability.</span>
      </div>

      {freeOnly ? (
        <Alert variant="info" data-agents-free-only-banner>
          <AlertTitle>Only agents with a free model or free tier are shown</AlertTitle>
          <AlertDescription>
            <span className="block">
              {agents.premiumAgents.length} premium agents and {agents.otherAgents.length}{" "}
              unverified registry agents are hidden. Their providers stay in settings until you turn
              them off.
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-2">
              <Button size="xs" variant="secondary" onClick={() => setFreeOnly(false)}>
                Show premium agents
              </Button>
              <Button
                size="xs"
                variant="outline"
                disabled={agents.premiumInstanceCount === 0}
                data-agents-disable-premium
                onClick={() => {
                  void agents.disablePremiumAgents().then((outcome) => {
                    if (!outcome.ok) {
                      setNotice(outcome.message ?? "Could not disable premium providers.");
                      return;
                    }
                    playCodeitlabSfx("success");
                    setNotice(
                      outcome.disabled === 0
                        ? "No premium provider was enabled; nothing to turn off."
                        : `Turned off ${outcome.disabled} premium provider${outcome.disabled === 1 ? "" : "s"}. Only free agents are available now.`,
                    );
                  });
                }}
              >
                Disable premium providers ({agents.premiumInstanceCount})
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {notice === null ? null : (
        <Alert variant="success" data-agents-notice>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {tier === "freemium" ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_FILTERS.map((option) => (
            <Button
              key={option.value}
              size="xs"
              variant={filter === option.value ? "secondary" : "ghost-muted"}
              aria-pressed={filter === option.value}
              onClick={() => setFilter(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge size="sm" variant="outline">
          {agents.agents.length} freemium
        </Badge>
        <Badge size="sm" variant="outline">
          {agents.premiumAgents.length} premium
        </Badge>
        <Badge size="sm" variant={agents.installedCount > 0 ? "success" : "secondary"}>
          {agents.installedCount} installed
        </Badge>
        <span>Notes come from each vendor; model limits and plan terms still apply.</span>
      </div>

      {error === null ? null : (
        <Alert variant="error" data-agents-error>
          <AlertTitle>Install failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {agents.canInstall || agents.source !== "local" ? null : (
        <Alert variant="info">
          <AlertTitle>Connect an environment</AlertTitle>
          <AlertDescription>
            Installs run on a connected computer. Connect one to download agents here.
          </AlertDescription>
        </Alert>
      )}
      {agents.error === null ? null : (
        <Alert variant="warning">
          <AlertTitle>Registry unavailable</AlertTitle>
          <AlertDescription>
            The official ACP registry could not be reached, so versions and installs are paused.
            {` ${agents.error}`}
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <CodeitlabLoadingRows rows={4} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {tier === "freemium"
            ? visibleFreemium.map((agent) => {
                const installed = installedCount(agent);
                return (
                  <AgentCard
                    key={agent.id}
                    id={agent.id}
                    tier="freemium"
                    name={agent.name}
                    summary={agent.summary}
                    version={agent.version}
                    icon={agent.icon}
                    badgeLabel={FREEMIUM_KIND_LABELS[agent.kind]}
                    badgeVariant={KIND_BADGE_VARIANT[agent.kind]}
                    note={agent.freeNote}
                    caveat={agent.caveat}
                    docsUrl={agent.docsUrl}
                    availability={agent.availability}
                    country={country}
                    installed={installed}
                    instanceId={agent.instanceId}
                    installing={agent.installing}
                    health={agent.health}
                    healthMessage={agent.healthMessage}
                    installDisabled={!agents.canInstall || agent.installing || installed}
                    onInstall={() => void install(agent.id)}
                  />
                );
              })
            : visiblePremium.map((agent) => {
                const installed = installedCount(agent);
                return (
                  <AgentCard
                    key={agent.id}
                    id={agent.id}
                    tier="premium"
                    name={agent.name}
                    summary={agent.summary}
                    version={agent.version}
                    icon={agent.icon}
                    badgeLabel={AGENT_TIER_LABELS.premium}
                    badgeVariant="info"
                    note={agent.premiumNote}
                    docsUrl={agent.docsUrl}
                    availability={agent.availability}
                    country={country}
                    installed={installed}
                    instanceId={agent.instanceId}
                    installing={agent.installing}
                    health={agent.health}
                    healthMessage={agent.healthMessage}
                    installDisabled={!agents.canInstall || agent.installing || installed}
                    onInstall={() => void install(agent.id)}
                  />
                );
              })}
        </div>
      )}

      {freeOnly || agents.otherAgents.length === 0 ? null : (
        <div className="flex flex-col gap-3">
          <CodeitlabSectionHeading
            eyebrow="Registry // everything else"
            title="More ACP agents"
            description="The rest of the official ACP registry, installed with the same one-click flow. These are not verified as free to start; check the vendor's docs."
          />
          <CodeitlabCard>
            <div className="flex flex-col divide-y divide-border/50">
              {agents.otherAgents.map((agent) => {
                const installed = installedCount(agent);
                return (
                  <div
                    key={agent.id}
                    className="flex min-w-0 items-center gap-3 px-4 py-2.5"
                    data-agent-id={agent.id}
                    data-agent-installed={installed ? "true" : "false"}
                  >
                    <AcpRegistryAgentIcon icon={agent.icon} className="size-7" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="truncate text-sm font-medium text-foreground">
                          {agent.name}
                        </h3>
                        {agent.version === null ? null : (
                          <span className="text-2xs text-muted-foreground">v{agent.version}</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{agent.summary}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {agent.docsUrl === null ? null : (
                        <Button
                          size="icon-xs"
                          variant="ghost-muted"
                          aria-label={`About ${agent.name}`}
                          render={<a href={agent.docsUrl} target="_blank" rel="noreferrer" />}
                        >
                          <ExternalLinkIcon />
                        </Button>
                      )}
                      {installed ? (
                        <Badge
                          size="sm"
                          variant={
                            agent.health === null ? "success" : HEALTH_BADGE[agent.health].variant
                          }
                          title={agent.healthMessage ?? undefined}
                        >
                          {agent.health === null ? "Installed" : HEALTH_BADGE[agent.health].label}
                        </Badge>
                      ) : null}
                      {agent.health === "sign-in" ? (
                        <Button
                          size="xs"
                          render={
                            <Link
                              to="/settings/providers"
                              search={providersSearch(agent.instanceId)}
                            />
                          }
                        >
                          Sign in
                        </Button>
                      ) : null}
                      {installed ? null : (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={!agents.canInstall || agent.installing}
                          onClick={() => void install(agent.id)}
                          data-agent-install
                        >
                          {agent.installing ? "Installing…" : "Install"}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CodeitlabCard>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Need something else? Every agent in the official ACP registry can be installed from{" "}
        <Link to="/settings/providers" className="underline underline-offset-2">
          Providers → Add provider
        </Link>
        .
      </p>
    </div>
  );
}
