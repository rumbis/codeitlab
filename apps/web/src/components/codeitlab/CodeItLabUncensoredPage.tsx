import { useState } from "react";
import { RefreshCwIcon, ShieldAlertIcon } from "lucide-react";

import type { CodeItLabPolicySettings } from "@codeitlab/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useCodeItLabNexus, useCodeItLabPolicy } from "../../codeitlab/api";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import {
  CodeItLabCard,
  CodeItLabSectionHeading,
  CodeItLabSettingRow,
  CodeItLabSourceNote,
} from "./CodeItLabPrimitives";

export function CodeItLabUncensoredPage() {
  const policy = useCodeItLabPolicy();
  const nexus = useCodeItLabNexus();
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const [draft, setDraft] = useState<CodeItLabPolicySettings | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const settings = draft ?? codeitlab.policy;

  const updatePolicy = (patch: Partial<CodeItLabPolicySettings>) => {
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
      <CodeItLabSourceNote source={policy.source} />
      <CodeItLabSectionHeading
        eyebrow="Uncensored"
        title="A permissive instruction profile"
        description="This changes only the scaffolding CodeItLab adds to a turn. It cannot lift an upstream provider's policy, and it never hides that limit from you."
      />

      <CodeItLabCard className="border-warning/40 bg-warning-surface/40">
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
      </CodeItLabCard>

      <CodeItLabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">Profile</p>
            <p className="mt-0.5 text-sm font-medium text-foreground">Permissive instructions</p>
          </div>
          <Badge size="sm" variant={settings.uncensored ? "warning" : "outline"}>
            {settings.uncensored ? "permissive" : "standard"}
          </Badge>
        </div>
        <CodeItLabSettingRow
          title="Enable permissive profile"
          description="Replaces CodeItLab's conservative instruction scaffolding for turns you send while this is on."
          control={
            <div className="flex flex-col items-end gap-1">
              <Switch
                aria-describedby="policy-apply-state"
                aria-label="Enable permissive profile"
                checked={settings.uncensored}
                disabled={applying}
                onCheckedChange={(checked) => void applyProfile(checked)}
              />
              <span
                aria-live="polite"
                className="max-w-56 text-end text-2xs text-muted-foreground"
                id="policy-apply-state"
              >
                {applying
                  ? "Saving the profile and re-reading the effective policy…"
                  : `The profile is ${settings.uncensored ? "permissive" : "standard"}.`}
              </span>
            </div>
          }
        />
        <CodeItLabSettingRow
          title="Audit trail"
          description="Record which turns ran under the permissive profile so you can review them later."
          control={
            <div className="flex flex-col items-end gap-1">
              <Switch
                aria-describedby="policy-audit-state"
                aria-label="Record policy audit trail"
                checked={settings.auditTrail}
                disabled={!settings.uncensored}
                onCheckedChange={(checked) => updatePolicy({ auditTrail: checked })}
              />
              <span
                aria-live="polite"
                className="max-w-56 text-end text-2xs text-muted-foreground"
                id="policy-audit-state"
              >
                {settings.uncensored
                  ? "Records which turns ran under the permissive profile."
                  : "Nothing to record while the profile is standard; enable it first."}
              </span>
            </div>
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
      </CodeItLabCard>

      <CodeItLabCard>
        <div className="border-b border-border/60 px-4 py-3">
          <p className="codeitlab-mono-label text-codeitlab-green/80">Apply to providers</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Empty means every provider. Unsupported providers are listed below with the reason they
            were skipped.
          </p>
          <p
            aria-live="polite"
            className="mt-1 text-2xs text-muted-foreground"
            id="policy-providers-state"
          >
            {settings.uncensored
              ? "Choose where the permissive profile applies; unsupported providers stay off."
              : "The profile is standard, so these switches wait; enable the permissive profile first."}
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
                  aria-describedby="policy-providers-state"
                  aria-label={`Apply permissive profile to ${provider.name}`}
                  checked={selected}
                  disabled={!settings.uncensored || unsupported !== undefined}
                  onCheckedChange={() => toggleProvider(provider.instanceId)}
                />
              </li>
            );
          })}
        </ul>
      </CodeItLabCard>

      <CodeItLabCard>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <p className="codeitlab-mono-label text-codeitlab-green/80">Effective policy</p>
            <p className="mt-0.5 text-sm font-medium tabular-nums text-foreground">
              {policy.data.profile} · applied to {policy.data.appliedTo.length} provider
              {policy.data.appliedTo.length === 1 ? "" : "s"}
            </p>
          </div>
          <Button
            aria-describedby="policy-refresh-state"
            disabled={policy.isPending}
            size="sm"
            variant="outline"
            onClick={() => policy.refresh()}
          >
            <RefreshCwIcon className="size-3.5" />
            Refresh
          </Button>
        </div>
        <p
          aria-live="polite"
          className="px-4 pt-2 text-2xs text-muted-foreground"
          id="policy-refresh-state"
        >
          {policy.isPending
            ? "Reading the effective policy…"
            : "Effective policy comes from the last read; Refresh asks the server again."}
        </p>
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
      </CodeItLabCard>
    </div>
  );
}
