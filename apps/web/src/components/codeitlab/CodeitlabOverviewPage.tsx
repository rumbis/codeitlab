import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowRightIcon,
  BrainIcon,
  CheckIcon,
  CircleIcon,
  ClapperboardIcon,
  CpuIcon,
  NetworkIcon,
  PackagePlusIcon,
  RefreshCwIcon,
  RouteIcon,
  ShieldIcon,
  StoreIcon,
  TerminalSquareIcon,
} from "lucide-react";

import { questBoardTask } from "../../codeitlab/board";
import { resolveMarketplaceUrl } from "../../codeitlab/marketplaceUrl";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import { toastManager } from "../ui/toast";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  useCodeitlabCredentials,
  useCodeitlabIntegrations,
  useCodeitlabMemory,
  useCodeitlabNexus,
  useCodeitlabNexusRefresh,
  useCodeitlabPolicy,
  useCodeitlabQuests,
  useCodeitlabRea,
  useCodeitlabRouting,
  useCodeitlabStudio,
  useCodeitlabTasks,
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

// The marketplace is a separate service; the app only links out to it. The URL
// comes from the build env so a self-hosted marketplace works without a fork.
const MARKETPLACE_URL = resolveMarketplaceUrl(import.meta.env.VITE_CODEITLAB_MARKETPLACE_URL);

/**
 * Quest ids come from the server as data, so the routes are pinned here where
 * the router can type-check them. Keep in sync with `@codeitlab/core/quests`.
 */
const QUEST_ROUTES = {
  agent: "/settings/codeitlab/agents",
  models: "/settings/codeitlab/routing",
  memory: "/settings/codeitlab/memory",
  evidence: "/settings/codeitlab/rea",
  deck: "/studio",
  video: "/studio",
  engine: "/settings/codeitlab/shorts",
  remote: "/settings/codeitlab/remote",
  keys: "/settings/codeitlab/credentials",
} as const;

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
  const credentials = useCodeitlabCredentials();
  const quests = useCodeitlabQuests();
  const board = useCodeitlabTasks();
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const refreshNexus = useCodeitlabNexusRefresh();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const local = [nexus, memory, routing, policy, rea, quests].some(
    (view) => view.source === "local",
  );

  const addQuestToBoard = (
    quest: { readonly title: string; readonly lesson: string },
    href: string,
  ) => {
    const task = questBoardTask(quest, href, new Date());
    const settingsTasks = codeitlab.board.tasks;
    update({ board: { ...codeitlab.board, tasks: [...settingsTasks, task] } });
    void board.upsert(task);
    toastManager.add({
      type: "info",
      title: "Added to the board",
      description: "It waits in Pending until you start it.",
    });
  };

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
      <CodeitlabCard data-codeitlab-quests>
        <div className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="codeitlab-mono-label text-codeitlab-green/80">YOUR PATH</p>
              <h3 className="mt-1 font-display text-lg font-semibold text-foreground">
                {quests.data.levelLabel} · {quests.data.done}/{quests.data.total} quests
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                {quests.data.next === null
                  ? "Everything is unlocked. Pick the next thing to build."
                  : quests.data.next.detail}
              </p>
            </div>
            <Badge size="sm" variant="outline">
              {quests.data.levelLabel}
            </Badge>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Quest progress"
            aria-valuemin={0}
            aria-valuemax={quests.data.total}
            aria-valuenow={quests.data.done}
          >
            <div
              className="h-full rounded-full bg-codeitlab-green transition-[width] duration-300"
              style={{
                width: `${quests.data.total === 0 ? 0 : Math.round((quests.data.done / quests.data.total) * 100)}%`,
              }}
            />
          </div>
          {quests.data.next === null ? null : (
            <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 bg-background/40 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{quests.data.next.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{quests.data.next.lesson}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    addQuestToBoard(quests.data.next!, QUEST_ROUTES[quests.data.next!.id])
                  }
                  type="button"
                >
                  Add as board task
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link to={QUEST_ROUTES[quests.data.next.id]} />}
                >
                  Open
                  <ArrowRightIcon className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
          <details className="group">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              All quests — each one teaches the part of the app it opens
            </summary>
            <ul className="mt-3 flex flex-col gap-2">
              {quests.data.quests.map((quest) => (
                <li key={quest.id} className="flex items-start gap-2 text-xs">
                  {quest.done ? (
                    <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-codeitlab-green" />
                  ) : (
                    <CircleIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <Link
                      to={QUEST_ROUTES[quest.id]}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      {quest.title}
                    </Link>
                    {quest.done ? null : <p className="text-muted-foreground">{quest.lesson}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </CodeitlabCard>
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
        <CodeitlabStat
          label="Privacy"
          value={credentials.data.enabled ? "firewall on" : "firewall off"}
          hint={`${credentials.data.maskedValues.toLocaleString()} values masked · ${credentials.data.mode} mode`}
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
            5 surfaces
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
          <a
            href={MARKETPLACE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card/50 px-3 py-3 transition-colors hover:bg-accent/40 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            data-lab="market"
            data-lab-state="external"
          >
            <span className="flex items-center gap-2">
              <StoreIcon className="size-5 text-codeitlab-green" />
              <span className="font-display text-sm font-medium text-foreground">Marketplace</span>
            </span>
            <span>
              <Badge size="sm" variant="outline">
                paid work
              </Badge>
            </span>
          </a>
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
            icon={<PackagePlusIcon className="size-4 text-codeitlab-green" />}
            title="Agents"
            description="Curated ACP agents with a real free path, installed in one click without a terminal."
            badge={{ label: "free tiers", variant: "success" }}
            to="/settings/codeitlab/agents"
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
    | "/settings/codeitlab/agents"
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
