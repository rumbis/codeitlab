import { useState } from "react";
import { DownloadIcon, FeatherIcon, NetworkIcon, ScissorsIcon } from "lucide-react";

import type {
  CodeitlabEcosystemIntegration,
  CodeitlabEcosystemIntegrationKind,
} from "@t3tools/contracts";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useCodeitlabEcosystem } from "../../codeitlab/api";
import { CodeitlabCard, CodeitlabSectionHeading, CodeitlabSourceNote } from "./CodeitlabPrimitives";

const KIND_LABELS: Readonly<Record<CodeitlabEcosystemIntegrationKind, string>> = {
  mcp: "MCP",
  "policy-pack": "POLICY PACK",
};

const INTEGRATION_ICONS = {
  graft: NetworkIcon,
  ponytail: ScissorsIcon,
  terse: FeatherIcon,
} as const;

function kindVariant(kind: CodeitlabEcosystemIntegrationKind): "info" | "secondary" {
  return kind === "mcp" ? "info" : "secondary";
}

export function CodeitlabEcosystemPage() {
  const ecosystem = useCodeitlabEcosystem();
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const install = async () => {
    setInstalling(true);
    const result = await ecosystem.install();
    setInstalling(false);
    setMessage(
      result === null
        ? "Install needs the CodeitLab ecosystem RPC; the preview status below is unchanged."
        : result.written.length === 0
          ? "Ecosystem is already up to date."
          : `Wrote ${result.written.length} file${result.written.length === 1 ? "" : "s"}: ${result.written.join(", ")}`,
    );
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="ecosystem">
      <CodeitlabSourceNote source={ecosystem.source} />
      <CodeitlabSectionHeading
        eyebrow="ECOSYSTEM // ALWAYS-ON"
        title="Ecosystem integrations"
        description="Three integrations that activate automatically: Graft's repository context graph, Ponytail's minimal-change policy pack, and the Caveman/terse response pack. Install or refresh writes their MCP registration and policy files."
        action={
          <Button size="sm" variant="outline" disabled={installing} onClick={() => void install()}>
            <DownloadIcon className="size-3.5" />
            {installing ? "Installing…" : "Install / refresh"}
          </Button>
        }
      />
      {message === null ? null : (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {ecosystem.data.integrations.map((integration) => (
          <IntegrationCard key={integration.id} integration={integration} />
        ))}
      </div>

      {ecosystem.data.warnings.length === 0 ? null : (
        <Alert variant="warning">
          <AlertTitle>Ecosystem warnings</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {ecosystem.data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <Alert variant="info">
        <AlertTitle>What these integrations can change</AlertTitle>
        <AlertDescription>
          Graft&apos;s MCP server is registered per project, so it only sees the repository of the
          project you install it into. The policy packs only change the instructions CodeItLab adds
          to a turn; they cannot lift an upstream provider&apos;s policy, and a provider may still
          refuse a request.
        </AlertDescription>
      </Alert>
    </div>
  );
}

function IntegrationCard({ integration }: { readonly integration: CodeitlabEcosystemIntegration }) {
  const Icon = INTEGRATION_ICONS[integration.id];
  return (
    <CodeitlabCard className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-codeitlab-green">
            <Icon className="size-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-sm font-semibold text-foreground">
                {integration.name}
              </p>
              <Badge size="sm" variant={kindVariant(integration.kind)}>
                {KIND_LABELS[integration.kind]}
              </Badge>
              <Badge size="sm" variant={integration.enabled ? "success" : "outline"}>
                {integration.enabled ? "enabled" : "disabled"}
              </Badge>
              <Badge size="sm" variant="outline">
                mode: {integration.mode}
              </Badge>
              {integration.version === undefined ? null : (
                <span className="font-mono text-2xs text-muted-foreground">
                  v{integration.version}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{integration.detail}</p>
          </div>
        </div>
        <Badge size="sm" variant={integration.available ? "success" : "warning"}>
          {integration.available ? "available" : "not detected"}
        </Badge>
      </div>
      {integration.warnings.length === 0 ? null : (
        <div className="mt-3 flex flex-col gap-2">
          {integration.warnings.map((warning) => (
            <Alert key={warning} variant="warning">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}
    </CodeitlabCard>
  );
}
