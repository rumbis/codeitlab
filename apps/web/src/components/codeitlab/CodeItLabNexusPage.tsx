import { useState } from "react";
import { RefreshCwIcon, SearchIcon, ServerIcon, SparklesIcon, WrenchIcon } from "lucide-react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { useCodeItLabNexus, useCodeItLabNexusRefresh } from "../../codeitlab/api";
import { codeitlabProviderLabel, codeitlabProviderName } from "../../codeitlab/providerLabels";
import {
  CodeItLabCard,
  CodeItLabEmptyBlock,
  CodeItLabSectionHeading,
  CodeItLabSourceNote,
} from "./CodeItLabPrimitives";

function transportVariant(transport: string): "success" | "info" | "warning" {
  if (transport === "local") return "success";
  if (transport === "tailscale") return "info";
  return "warning";
}

export function CodeItLabNexusPage() {
  const nexus = useCodeItLabNexus();
  const refreshNexus = useCodeItLabNexusRefresh();
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const normalized = query.trim().toLowerCase();
  const skills = nexus.data.skills.filter(
    (skill) =>
      normalized.length === 0 ||
      skill.name.toLowerCase().includes(normalized) ||
      skill.description.toLowerCase().includes(normalized) ||
      skill.source.includes(normalized),
  );
  const mcpServers = nexus.data.mcpServers.filter(
    (server) =>
      normalized.length === 0 ||
      server.name.toLowerCase().includes(normalized) ||
      server.transport.includes(normalized),
  );
  const sessions = nexus.data.sessions.filter(
    (session) => normalized.length === 0 || session.title.toLowerCase().includes(normalized),
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshNexus();
    setRefreshing(false);
    nexus.refresh();
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="nexus">
      <CodeItLabSourceNote source={nexus.source} />
      <CodeItLabSectionHeading
        eyebrow="Nexus"
        title="One catalog for every harness"
        description="Providers keep their native state; Nexus ingests, dedupes, and indexes their skills, sessions, and MCP servers so a turn can use all of them."
        action={
          <Button
            aria-describedby="nexus-refresh-state"
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            <RefreshCwIcon className="size-3.5" />
            {refreshing ? "Refreshing…" : "Refresh catalog"}
          </Button>
        }
      />

      <p aria-live="polite" className="text-2xs text-muted-foreground" id="nexus-refresh-state">
        {refreshing
          ? "Refreshing the catalog…"
          : `Catalog built ${new Date(nexus.data.generatedAt).toLocaleString()} from ${nexus.data.providers.length} providers: ${nexus.data.skills.length} skills, ${nexus.data.mcpServers.length} MCP servers, ${nexus.data.sessions.length} sessions.`}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {nexus.data.providers.map((provider) => (
          <CodeItLabCard key={provider.instanceId} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {codeitlabProviderName(provider.name)}
                </p>
                <p className="truncate font-mono text-2xs text-muted-foreground">
                  {provider.driverKind} · {provider.instanceId}
                </p>
              </div>
              <Badge size="sm" variant={provider.available ? "success" : "error"}>
                {provider.available ? "online" : "offline"}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
              <Badge size="sm" variant={transportVariant(provider.transport)}>
                {provider.transport}
              </Badge>
              <span>{provider.skills} skills</span>
              <span>{provider.sessions} sessions</span>
              <span>{provider.mcpServers} MCP</span>
            </div>
            {provider.detail === undefined ? null : (
              <p className="mt-2 text-2xs text-warning-foreground">{provider.detail}</p>
            )}
          </CodeItLabCard>
        ))}
      </div>

      <InputGroup>
        <InputGroupAddon>
          <SearchIcon className="text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Filter Nexus catalog"
          placeholder="Filter skills, MCP servers, sessions…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {normalized === "" ? null : (
          <InputGroupAddon align="inline-end">
            <Button onClick={() => setQuery("")} size="xs" type="button" variant="ghost">
              Clear filter
            </Button>
          </InputGroupAddon>
        )}
      </InputGroup>

      {normalized === "" ? null : (
        <p aria-live="polite" className="text-2xs text-muted-foreground" id="nexus-filter-state">
          Showing {skills.length} of {nexus.data.skills.length} skills, {mcpServers.length} of{" "}
          {nexus.data.mcpServers.length} MCP servers and {sessions.length} of{" "}
          {nexus.data.sessions.length} sessions for “{query.trim()}”.
        </p>
      )}

      <CodeItLabCard>
        <CatalogHeading
          icon={<SparklesIcon className="size-3.5" />}
          title="Skills"
          count={skills.length}
        />
        {skills.length === 0 ? (
          <div className="px-4 py-6">
            <CodeItLabEmptyBlock
              title="No skills match"
              description={
                normalized === ""
                  ? "No harness has reported a skill yet. Refresh after connecting a provider."
                  : "Clear the filter to see every ingested skill."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {skills.map((skill) => (
              <li key={skill.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-foreground">{skill.name}</span>
                  <Badge size="sm" variant="outline">
                    {skill.source}
                  </Badge>
                  {skill.alsoAvailableIn.map((source) => (
                    <Badge key={source} size="sm" variant="info">
                      also in {source}
                    </Badge>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{skill.description}</p>
                {skill.path === undefined ? null : (
                  <p className="truncate font-mono text-2xs text-muted-foreground/70">
                    {skill.path}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CodeItLabCard>

      <CodeItLabCard>
        <CatalogHeading
          icon={<WrenchIcon className="size-3.5" />}
          title="MCP servers"
          count={mcpServers.length}
        />
        {mcpServers.length === 0 ? (
          <div className="px-4 py-6">
            <CodeItLabEmptyBlock
              title="No MCP servers match"
              description={
                normalized === ""
                  ? "No harness has reported an MCP server yet. Nexus merges them by command, args, and env keys once one does."
                  : "MCP servers are deduped by command, args, and env keys across providers."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {mcpServers.map((server) => (
              <li key={server.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-foreground">{server.name}</span>
                  <Badge size="sm" variant="outline">
                    {server.transport}
                  </Badge>
                  <Badge size="sm" variant={server.enabled ? "success" : "outline"}>
                    {server.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <span className="text-2xs text-muted-foreground">
                    from {server.sources.join(", ")}
                  </span>
                </div>
                <p className="truncate font-mono text-2xs text-muted-foreground">
                  {server.command ?? server.url ?? server.id} {server.args.join(" ")}
                </p>
                <div className="flex flex-wrap gap-1">
                  {server.tools.map((tool) => (
                    <Badge key={tool} size="sm" variant="secondary">
                      {tool}
                    </Badge>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CodeItLabCard>

      <CodeItLabCard>
        <CatalogHeading
          icon={<ServerIcon className="size-3.5" />}
          title="Sessions"
          count={sessions.length}
        />
        {sessions.length === 0 ? (
          <div className="px-4 py-6">
            <CodeItLabEmptyBlock
              title="No sessions match"
              description={
                normalized === ""
                  ? "No harness has reported a session yet. Sessions are ingested from every configured harness, including remote transports."
                  : "Sessions are ingested from every configured harness, including remote transports."
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {sessions.map((session) => (
              <li key={session.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {session.title}
                </span>
                <Badge size="sm" variant="outline">
                  {codeitlabProviderLabel(session.providerInstanceId)}
                </Badge>
                {session.remote ? (
                  <Badge size="sm" variant="info">
                    remote
                  </Badge>
                ) : null}
                <span className="text-2xs tabular-nums text-muted-foreground">
                  {session.messageCount} msgs · {new Date(session.updatedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CodeItLabCard>

      {nexus.data.warnings.length === 0 ? null : (
        <CodeItLabCard className="border-warning/30">
          <div className="px-4 py-3">
            <p className="codeitlab-mono-label text-warning-foreground">Warnings</p>
            <ul className="mt-2 flex flex-col gap-1">
              {nexus.data.warnings.map((warning) => (
                <li key={warning} className="text-xs text-warning-foreground">
                  {warning}
                </li>
              ))}
            </ul>
          </div>
        </CodeItLabCard>
      )}
    </div>
  );
}

function CatalogHeading({
  icon,
  title,
  count,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly count: number;
}) {
  return (
    <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
      <span className="text-codeitlab-green">{icon}</span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <Badge size="sm" variant="secondary">
        {count}
      </Badge>
    </div>
  );
}
