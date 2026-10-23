import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  BrainIcon,
  ClapperboardIcon,
  CpuIcon,
  NetworkIcon,
  RefreshCwIcon,
  RouteIcon,
  ShieldIcon,
  TerminalSquareIcon,
} from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  useCodeitlabIntegrations,
  useCodeitlabMemory,
  useCodeitlabNexus,
  useCodeitlabNexusRefresh,
  useCodeitlabPolicy,
  useCodeitlabRea,
  useCodeitlabRouting,
  useCodeitlabStudio,
} from "../../codeitlab/api";
import {
  findIntegration,
  integrationStateLabel,
  integrationStateVariant,
} from "../../codeitlab/integrations/model";
import { IntegrationMark } from "./IntegrationMarks";
import { useCodeitlabEffectsSettings } from "../../codeitlab/effectsSettings";
import {
  CodeitlabCard,
  CodeitlabSectionHeading,
  CodeitlabSourceNote,
  CodeitlabStat,
} from "./CodeitlabPrimitives";

const LAB_LINKS = [
  { id: "shorts" as const, label: "Shorts", to: "/settings/codeitlab/shorts" as const },
  { id: "crew" as const, label: "Crew", to: "/settings/codeitlab/crew" as const },
  { id: "search" as const, label: "Search", to: "/settings/codeitlab/search" as const },
];

export function CodeitlabOverviewPage() {
  const nexus = useCodeitlabNexus();
  const memory = useCodeitlabMemory();
  const routing = useCodeitlabRouting();
  const policy = useCodeitlabPolicy();
  const rea = useCodeitlabRea();
  const effects = useCodeitlabEffectsSettings();
  const integrations = useCodeitlabIntegrations();
  const studio = useCodeitlabStudio();
  const refreshNexus = useCodeitlabNexusRefresh();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const local = [nexus, memory, routing, policy, rea].some((view) => view.source === "local");

  const handleRefreshNexus = async () => {
    setRefreshing(true);
    const catalog = await refreshNexus();
    setRefreshing(false);
    setRefreshMessage(
      catalog === null
        ? "Refresh needs the CodeitLab RPC; the local preview catalog is shown for now."
        : `Catalog refreshed at ${new Date(catalog.generatedAt).toLocaleTimeString()}.`,
    );
  };

  const onlineProviders = nexus.data.providers.filter((provider) => provider.available).length;

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="overview">
      <CodeitlabSourceNote source={local ? "local" : "server"} />
      <CodeitlabSectionHeading
        eyebrow="Status"
        title="Everything the harness knows about itself"
        description="Live counts from the connected environment, or the typed preview adapter while server wiring lands."
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => void handleRefreshNexus()}
          >
            <RefreshCwIcon className="size-3.5" />
            Refresh Nexus
          </Button>
        }
      />
      {refreshMessage === null ? null : (
        <p className="text-xs text-muted-foreground" role="status">
          {refreshMessage}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CodeitlabStat
          label="Nexus providers"
          value={`${onlineProviders}/${nexus.data.providers.length}`}
          hint={`${nexus.data.skills.length} skills · ${nexus.data.mcpServers.length} MCP servers`}
        />
        <CodeitlabStat
          label="Memory"
          value={memory.stats.total.toLocaleString()}
          hint={`${memory.stats.project} project · ${memory.stats.global} global`}
        />
        <CodeitlabStat
          label="Routing"
          value={routing.data.mode}
          hint={`${routing.data.providers.length} providers · ${routing.data.omniRouteModels.length} OmniRoute models`}
        />
        <CodeitlabStat
          label="Policy"
          value={policy.data.profile}
          hint={`${policy.data.appliedTo.length} applied · ${policy.data.unsupported.length} unsupported`}
        />
        <CodeitlabStat
          label="REA"
          value={rea.data.installed ? (rea.data.version ?? "installed") : "not installed"}
          hint={`${rea.data.health.filter((check) => check.ok).length}/${rea.data.health.length} health checks passing`}
        />
        <CodeitlabStat
          label="Effects"
          value={effects.threeD === "off" ? "3D off" : `3D ${effects.threeD}`}
          hint={`${effects.maxFps} fps cap · SFX ${effects.sfxEnabled ? `${Math.round(effects.sfxVolume * 100)}%` : "muted"}`}
        />
      </div>

      <div className="flex flex-col gap-3" data-codeitlab-labs>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">
              LABS // WHITELABEL SURFACES
            </p>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              Our own branded surfaces, each powered by a separate open-source engine — plus Studio
              for decks and video. Open one to configure or use it.
            </p>
          </div>
          <Badge size="sm" variant="outline">
            4 surfaces
          </Badge>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {LAB_LINKS.map((lab) => {
            const status = findIntegration(integrations.data.integrations, lab.id);
            const state = status?.state ?? null;
            return (
              <Link
                key={lab.id}
                to={lab.to}
                className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/50 px-3 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                data-lab={lab.id}
                data-lab-state={state ?? "unknown"}
              >
                <span className="flex items-center gap-2">
                  <IntegrationMark id={lab.id} className="size-5 text-codeitlab-green" />
                  <span className="font-display text-sm font-medium text-foreground">
                    {lab.label}
                  </span>
                </span>
                <span>
                  <Badge
                    size="sm"
                    variant={state === null ? "outline" : integrationStateVariant(state)}
                  >
                    {state === null ? "unknown" : integrationStateLabel(state)}
                  </Badge>
                </span>
              </Link>
            );
          })}
          <Link
            to="/studio"
            className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/50 px-3 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-lab="studio"
            data-lab-state={studio.source}
          >
            <span className="flex items-center gap-2">
              <ClapperboardIcon className="size-5 text-codeitlab-green" />
              <span className="font-display text-sm font-medium text-foreground">Studio</span>
            </span>
            <span>
              <Badge size="sm" variant={studio.source === "server" ? "success" : "outline"}>
                {studio.source === "server" ? "server" : "local"}
              </Badge>
            </span>
          </Link>
        </div>
      </div>

      <CodeitlabCard>
        <div className="flex flex-col divide-y divide-border/50">
          <OverviewRow
            icon={<NetworkIcon className="size-4 text-codeitlab-cyan" />}
            title="Nexus"
            description="Unified ACP catalog: providers, skills, sessions, and MCP servers merged and deduped."
            badge={
              nexus.data.warnings.length > 0
                ? { label: `${nexus.data.warnings.length} warning`, variant: "warning" }
                : { label: "healthy", variant: "success" }
            }
            to="/settings/codeitlab/nexus"
          />
          <OverviewRow
            icon={<BrainIcon className="size-4 text-codeitlab-green" />}
            title="Memory"
            description="Durable facts, preferences, decisions, conventions, and gotchas recalled into turns."
            badge={{
              label: `${memory.stats.total} entries`,
              variant: "info",
            }}
            to="/settings/codeitlab/memory"
          />
          <OverviewRow
            icon={<RouteIcon className="size-4 text-codeitlab-cyan" />}
            title="Routing"
            description="Quota, smartness, and speed weights across providers, plus OmniRoute virtual models."
            badge={{
              label: routing.data.mode === "auto" ? "auto-route on" : routing.data.mode,
              variant: routing.data.mode === "manual" ? "outline" : "success",
            }}
            to="/settings/codeitlab/routing"
          />
          <OverviewRow
            icon={<ShieldIcon className="size-4 text-codeitlab-green" />}
            title="Uncensored"
            description="A policy profile that changes only the instructions CodeitLab adds to a turn."
            badge={{ label: policy.data.profile, variant: "outline" }}
            to="/settings/codeitlab/uncensored"
          />
          <OverviewRow
            icon={<TerminalSquareIcon className="size-4 text-codeitlab-cyan" />}
            title="REA"
            description="Reverse-engineering and analysis agents exposed as MCP tools and a skill."
            badge={
              rea.data.installed
                ? { label: "installed", variant: "success" }
                : { label: "not installed", variant: "error" }
            }
            to="/settings/codeitlab/rea"
          />
          <OverviewRow
            icon={<CpuIcon className="size-4 text-codeitlab-green" />}
            title="Effects"
            description="3D ambient scenes and WebAudio SFX, with per-device persistence and mute controls."
            badge={{
              label: effects.threeD === "off" && !effects.sfxEnabled ? "all off" : "enabled",
              variant: effects.threeD === "off" && !effects.sfxEnabled ? "outline" : "success",
            }}
            to="/settings/codeitlab/effects"
          />
        </div>
      </CodeitlabCard>

      <div className="grid gap-3 lg:grid-cols-2">
        <CodeitlabCard>
          <div className="px-4 pt-4">
            <p className="codeitlab-mono-label text-muted-foreground">Recent routing decisions</p>
          </div>
          <ul className="mt-2 divide-y divide-border/50">
            {routing.history.slice(0, 4).map((decision) => (
              <li key={decision.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge size="sm" variant="info">
                    {decision.taskClass}
                  </Badge>
                  <span className="font-mono text-xs text-foreground">{decision.model}</span>
                  <span className="text-2xs text-muted-foreground">
                    {decision.providerInstanceId}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{decision.reason}</p>
              </li>
            ))}
          </ul>
        </CodeitlabCard>
        <CodeitlabCard>
          <div className="px-4 pt-4">
            <p className="codeitlab-mono-label text-muted-foreground">Nexus warnings</p>
          </div>
          {nexus.data.warnings.length === 0 ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              No catalog warnings. Providers, skills, and MCP servers ingested cleanly.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-border/50">
              {nexus.data.warnings.map((warning) => (
                <li key={warning} className="px-4 py-3 text-xs text-warning-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </CodeitlabCard>
      </div>
    </div>
  );
}

function OverviewRow({
  icon,
  title,
  description,
  badge,
  to,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly description: string;
  readonly badge: {
    readonly label: string;
    readonly variant: "success" | "warning" | "info" | "outline" | "error";
  };
  readonly to:
    | "/settings/codeitlab/nexus"
    | "/settings/codeitlab/memory"
    | "/settings/codeitlab/routing"
    | "/settings/codeitlab/uncensored"
    | "/settings/codeitlab/rea"
    | "/settings/codeitlab/effects";
}) {
  return (
    <Link
      to={to}
      className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <Badge className="shrink-0" size="sm" variant={badge.variant}>
        {badge.label}
      </Badge>
    </Link>
  );
}
