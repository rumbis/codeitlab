import { useState } from "react";
import { CheckCircle2Icon, DownloadIcon, XCircleIcon } from "lucide-react";

import type { CodeItLabReaSettings } from "@codeitlab/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { useCodeItLabRea } from "../../codeitlab/api";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import {
  CodeItLabCard,
  CodeItLabSectionHeading,
  CodeItLabSettingRow,
  CodeItLabSourceNote,
  CodeItLabStat,
} from "./CodeItLabPrimitives";

export function CodeItLabReaPage() {
  const rea = useCodeItLabRea();
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const [draft, setDraft] = useState<CodeItLabReaSettings | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const settings = draft ?? codeitlab.rea;

  const updateRea = (patch: Partial<CodeItLabReaSettings>) => {
    const next = { ...settings, ...patch };
    setDraft(next);
    update({ rea: next });
  };

  const install = async () => {
    setInstalling(true);
    const status = await rea.install();
    setInstalling(false);
    setMessage(
      status === null
        ? "Install RPC is not wired yet; the command below is what the installer will run."
        : status.installed
          ? `REA ${status.version} installed.`
          : "Install ran but REA did not report as installed; check the health checks below.",
    );
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="rea">
      <CodeItLabSourceNote source={rea.source} />
      <CodeItLabSectionHeading
        eyebrow="REA"
        title="Reverse-engineer anything"
        description="REA is always available: an MCP server plus a seeded skill. Agents reach for it on analysis work without being asked by name."
        action={
          <Button
            aria-describedby="rea-install-state"
            size="sm"
            variant="outline"
            disabled={installing}
            onClick={() => void install()}
          >
            <DownloadIcon className="size-3.5" />
            {installing ? "Installing…" : rea.data.installed ? "Reinstall" : "Install"}
          </Button>
        }
      />
      <p
        aria-live="polite"
        className="text-xs text-muted-foreground"
        id="rea-install-state"
        role="status"
      >
        {installing
          ? "Installing REA; the checks below refresh when it finishes."
          : (message ??
            "REA is always available as an MCP server plus a seeded skill; Install rewrites both.")}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <CodeItLabStat
          label="Version"
          value={rea.data.version.length === 0 ? "—" : rea.data.version}
        />
        <CodeItLabStat label="MCP server" value={rea.data.mcpServerId ?? "not merged"} />
        <CodeItLabStat
          label="Skill"
          value={rea.data.skillInstalled ? "installed" : "missing"}
          hint={rea.data.skillPath}
        />
        <CodeItLabStat
          label="Last check"
          value={
            rea.data.checkedAt === undefined
              ? "never"
              : new Date(rea.data.checkedAt).toLocaleTimeString()
          }
        />
      </div>

      <CodeItLabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">Health</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Installation checks</p>
          </div>
          <Badge
            size="sm"
            variant={
              rea.data.health.every((check) => check.ok)
                ? "success"
                : rea.data.health.some((check) => check.ok)
                  ? "warning"
                  : "error"
            }
          >
            {rea.data.health.filter((check) => check.ok).length}/{rea.data.health.length} passing
          </Badge>
        </div>
        {rea.data.health.length === 0 ? (
          <p className="px-4 py-4 text-xs text-muted-foreground">
            No health checks reported yet. Install REA to populate them.
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {rea.data.health.map((check) => (
              <li key={check.name} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex items-center gap-2">
                  {check.ok ? (
                    <CheckCircle2Icon className="size-4 text-success-foreground" />
                  ) : (
                    <XCircleIcon className="size-4 text-warning-foreground" />
                  )}
                  <span className="font-mono text-xs text-foreground">{check.name}</span>
                  <Badge size="sm" variant={check.ok ? "success" : "warning"}>
                    {check.ok ? "ok" : "needs attention"}
                  </Badge>
                </div>
                <p className="ps-6 text-xs text-muted-foreground">{check.detail}</p>
                {check.remediation.length === 0 ? null : (
                  <p className="ps-6 font-mono text-2xs text-codeitlab-cyan">{check.remediation}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CodeItLabCard>

      <CodeItLabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">Settings</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">MCP command and activation</p>
          </div>
        </div>
        <CodeItLabSettingRow
          title="Enabled"
          description="Expose REA's MCP tools to every provider that supports MCP."
          control={
            <Switch
              aria-label="Enable REA"
              checked={settings.enabled}
              onCheckedChange={(checked) => updateRea({ enabled: checked })}
            />
          }
        />
        <CodeItLabSettingRow
          title="Auto-activate"
          description="Agents use REA on analysis tasks without the user naming it."
          control={
            <div className="flex flex-col items-end gap-1">
              <Switch
                aria-describedby="rea-activate-state"
                aria-label="Auto-activate REA"
                checked={settings.autoActivate}
                disabled={!settings.enabled}
                onCheckedChange={(checked) => updateRea({ autoActivate: checked })}
              />
              <span
                aria-live="polite"
                className="max-w-56 text-end text-2xs text-muted-foreground"
                id="rea-activate-state"
              >
                {settings.enabled
                  ? "Agents use REA on analysis tasks without being named."
                  : "Enable REA first; auto-activation only matters while its MCP tools are exposed."}
              </span>
            </div>
          }
        />
        <CodeItLabSettingRow
          title="Seed skill"
          description="Install the bundled REA skill into the app-managed skills directory."
          control={
            <Switch
              aria-label="Seed REA skill"
              checked={settings.installSkill}
              onCheckedChange={(checked) => updateRea({ installSkill: checked })}
            />
          }
        />
        <CodeItLabSettingRow
          title="MCP command"
          description="Command used to start the REA MCP server."
          control={
            <Input
              aria-label="REA MCP command"
              className="w-full sm:w-72"
              value={settings.mcpCommand}
              onChange={(event) => updateRea({ mcpCommand: event.currentTarget.value })}
            />
          }
        />
        <CodeItLabSettingRow
          title="MCP arguments"
          description="One argument per line."
          control={
            <Input
              aria-label="REA MCP arguments"
              className="w-full sm:w-72"
              value={settings.mcpArgs.join(" ")}
              onChange={(event) =>
                updateRea({
                  mcpArgs: event.currentTarget.value
                    .split(/\s+/)
                    .map((argument) => argument.trim())
                    .filter((argument) => argument.length > 0),
                })
              }
            />
          }
        />
      </CodeItLabCard>

      <CodeItLabCard>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Capabilities</p>
          <p className="mt-1 text-xs text-muted-foreground">
            What REA can do, and the side effects it discloses before running.
          </p>
        </div>
        <ul className="divide-y divide-border/50">
          {rea.capabilities.map((capability) => (
            <li key={capability.id} className="flex flex-col gap-1 px-4 py-3">
              <p className="text-sm font-medium text-foreground">{capability.title}</p>
              <p className="text-xs text-muted-foreground">{capability.description}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {capability.sideEffects.map((sideEffect) => (
                  <Badge key={sideEffect} size="sm" variant="secondary">
                    {sideEffect}
                  </Badge>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </CodeItLabCard>
    </div>
  );
}
