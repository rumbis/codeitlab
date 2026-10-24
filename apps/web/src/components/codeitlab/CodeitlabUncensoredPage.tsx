import { useState } from "react";
import { RefreshCwIcon, ShieldAlertIcon } from "lucide-react";

import type { CodeitlabPolicySettings } from "@t3tools/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useCodeitlabNexus, useCodeitlabPolicy } from "../../codeitlab/api";
import { useCodeitlabSettingsWriter } from "../../codeitlab/effectsSettings";
import {
  CodeitlabCard,
  CodeitlabSectionHeading,
  CodeitlabSettingRow,
  CodeitlabSourceNote,
} from "./CodeitlabPrimitives";

export function CodeitlabUncensoredPage() {
  const policy = useCodeitlabPolicy();
  const nexus = useCodeitlabNexus();
  const { codeitlab, update } = useCodeitlabSettingsWriter();
  const [draft, setDraft] = useState<CodeitlabPolicySettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const settings = draft ?? codeitlab.policy;

  const updatePolicy = (patch: Partial<CodeitlabPolicySettings>) => {
    const next = { ...settings, ...patch };
    setDraft(next);
    update({ policy: next });
  };

  const applyProfile = async (uncensored: boolean) => {
    updatePolicy({ uncensored });
    setApplying(true);
    const result = await policy.setProfile(uncensored ? "permissive" : "standard");
    setApplying(false);
    setMessage(
      result === null
        ? "Policy RPC is not wired yet; the profile preference is saved but the effective policy below is preview data."
        : `Effective profile is now ${result.profile}.`,
    );
  };

  const toggleProvider = (providerInstanceId: string) => {
    const selected = settings.applyToProviders.includes(providerInstanceId);
    updatePolicy({
      applyToProviders: selected
        ? settings.applyToProviders.filter((id) => id !== providerInstanceId)
        : [...settings.applyToProviders, providerInstanceId],
    });
  };

  return (
    <div className="flex flex-col gap-6" data-codeitlab-page="uncensored">
      <CodeitlabSourceNote source={policy.source} />
      <CodeitlabSectionHeading
        eyebrow="Uncensored"
        title="A permissive instruction profile"
        description="This changes only the scaffolding CodeitLab adds to a turn. It cannot lift an upstream provider's policy, and it never hides that limit from you."
      />

      <CodeitlabCard className="border-warning/40 bg-warning-surface/40">
        <div className="flex items-start gap-3 px-4 py-4">
          <ShieldAlertIcon className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-warning-foreground">
              What this can and cannot do
            </p>
            <ul className="mt-2 flex flex-col gap-1.5 text-xs text-warning-foreground/90">
              {policy.data.limitations.map((limitation) => (
                <li key={limitation} className="flex gap-2">
                  <span aria-hidden>—</span>
                  <span>{limitation}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">Profile</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Permissive instructions</p>
          </div>
          <Badge size="sm" variant={settings.uncensored ? "warning" : "outline"}>
            {settings.uncensored ? "permissive" : "standard"}
          </Badge>
        </div>
        <CodeitlabSettingRow
          title="Enable permissive profile"
          description="Replaces CodeitLab's conservative instruction scaffolding for turns you send while this is on."
          control={
            <Switch
              aria-label="Enable permissive profile"
              checked={settings.uncensored}
              disabled={applying}
              onCheckedChange={(checked) => void applyProfile(checked)}
            />
          }
        />
        <CodeitlabSettingRow
          title="Audit trail"
          description="Record which turns ran under the permissive profile so you can review them later."
          control={
            <Switch
              aria-label="Record policy audit trail"
              checked={settings.auditTrail}
              onCheckedChange={(checked) => updatePolicy({ auditTrail: checked })}
            />
          }
        />
        {message === null ? null : (
          <p
            className="border-t border-border/50 px-4 py-2 text-xs text-muted-foreground"
            role="status"
          >
            {message}
          </p>
        )}
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Apply to providers</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Empty means every provider. Unsupported providers are listed below with the reason they
            were skipped.
          </p>
        </div>
        <ul className="divide-y divide-border/50">
          {nexus.data.providers.map((provider) => {
            const unsupported = policy.data.unsupported.find(
              (entry) => entry.providerInstanceId === provider.instanceId,
            );
            const selected =
              settings.applyToProviders.length === 0 ||
              settings.applyToProviders.includes(provider.instanceId);
            return (
              <li key={provider.instanceId} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{provider.name}</p>
                  <p className="truncate font-mono text-2xs text-muted-foreground">
                    {provider.instanceId}
                  </p>
                </div>
                {unsupported === undefined ? null : (
                  <Badge size="sm" variant="warning" title={unsupported.reason}>
                    unsupported
                  </Badge>
                )}
                <Switch
                  aria-label={`Apply permissive profile to ${provider.name}`}
                  checked={selected}
                  onCheckedChange={() => toggleProvider(provider.instanceId)}
                />
              </li>
            );
          })}
        </ul>
      </CodeitlabCard>

      <CodeitlabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">Effective policy</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">
              {policy.data.profile} · applied to {policy.data.appliedTo.length} provider
              {policy.data.appliedTo.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => policy.refresh()}>
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {policy.data.appliedTo.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              No provider has reported an applied profile yet.
            </span>
          ) : (
            policy.data.appliedTo.map((provider) => (
              <Badge key={provider} size="sm" variant="success">
                {provider}
              </Badge>
            ))
          )}
        </div>
        {policy.data.instructionBlock.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground">
            No instruction block is appended under the standard profile.
          </p>
        ) : (
          <pre className="mx-4 mb-3 max-h-64 overflow-auto rounded-lg border border-border/60 bg-background/60 p-3 font-mono text-2xs whitespace-pre-wrap text-foreground">
            {policy.data.instructionBlock}
          </pre>
        )}
      </CodeitlabCard>
    </div>
  );
}
