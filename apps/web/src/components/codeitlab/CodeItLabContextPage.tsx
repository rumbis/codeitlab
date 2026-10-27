import {
  CONTEXT_SIZE_ESTIMATES,
  formatContextTokens,
  resolveContextSize,
} from "@codeitlab/core/context";
import { useState } from "react";
import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import { useEnvironmentProviders, usePrimaryEnvironmentId } from "../../state/environments";
import { Input } from "../ui/input";
import { CodeItLabCard, CodeItLabEmptyBlock, CodeItLabSectionHeading } from "./CodeItLabPrimitives";

/**
 * Context sizes: the meter always prefers the provider's reported limit, so this
 * page exists for the cases where a provider reports usage without a maximum.
 * Values recorded here fill the gap; family estimates are shown as estimates.
 */
export function CodeItLabContextPage() {
  const { codeitlab, update } = useCodeItLabSettingsWriter();
  const sizes = codeitlab.context.sizes;
  const environmentId = usePrimaryEnvironmentId();
  const providersByEnvironment = useEnvironmentProviders();
  const providers = environmentId === null ? [] : (providersByEnvironment.get(environmentId) ?? []);
  const entries = deriveProviderInstanceEntries(providers).filter(
    (entry) => entry.enabled && entry.models.length > 0,
  );

  const rows = entries.flatMap((entry) =>
    entry.models.map((model) => ({
      key: `${entry.instanceId as string}:${model.slug}`,
      instanceId: entry.instanceId as string,
      providerName: entry.displayName,
      slug: model.slug,
      name: model.name,
      resolved: resolveContextSize(sizes, entry.instanceId as string, model.slug),
    })),
  );

  const [notice, setNotice] = useState<string | null>(null);

  const record = (instanceId: string, model: string, name: string, raw: string) => {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/[,_\s]/g, "");
    // Same rule as the budget table: a typo must not erase the recorded size.
    if (trimmed !== "" && !/^\d+$/.test(digits)) {
      setNotice(
        `Not saved: “${trimmed}” is not a token count. Use digits only, or clear the field.`,
      );
      return;
    }
    const tokens = Number.parseInt(digits, 10);
    const next = sizes.filter(
      (size) =>
        !(size.model.trim() === model.trim() && size.instanceId.trim() === instanceId.trim()),
    );
    if (Number.isFinite(tokens) && tokens > 0) {
      next.push({ instanceId, model, tokens });
      setNotice(`${name} now reports ${formatContextTokens(tokens)} recorded tokens.`);
    } else {
      setNotice(
        `Removed the recorded size for ${name}; its provider or family estimate applies again.`,
      );
    }
    update({ context: { ...codeitlab.context, sizes: next } });
  };

  return (
    <div className="flex flex-col gap-6">
      <CodeItLabSectionHeading
        description="The composer meter prefers the limit your provider reports. Record a size here for models that report usage without one; family estimates fill the rest and are marked with ~ so they never look measured."
        eyebrow="CodeItLab // context"
        title="Context sizes"
      />

      {rows.length === 0 ? (
        <CodeItLabEmptyBlock
          description="Connect a provider and its models appear here. Recording a size only matters when the provider omits the limit from its usage reports."
          title="No models to size yet"
        />
      ) : (
        <CodeItLabCard className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Model</th>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">In effect</th>
                <th className="px-3 py-2 font-medium">Recorded tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-b border-border/40 last:border-0" key={row.key}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-2xs text-muted-foreground">{row.slug}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.providerName}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {row.resolved === null
                      ? "unknown"
                      : `${row.resolved.source === "estimate" ? "~" : ""}${formatContextTokens(row.resolved.tokens)}`}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Recorded context size for ${row.name}`}
                      className="max-w-32"
                      defaultValue={
                        sizes.find(
                          (size) =>
                            size.model.trim() === row.slug &&
                            size.instanceId.trim() === row.instanceId,
                        )?.tokens ?? ""
                      }
                      inputMode="numeric"
                      onBlur={(event) =>
                        record(row.instanceId, row.slug, row.name, event.currentTarget.value)
                      }
                      placeholder="Provider default"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CodeItLabCard>
      )}

      <CodeItLabCard className="flex flex-col gap-2 p-4">
        <p className="text-xs font-medium text-muted-foreground">
          Family estimates used as a last resort
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-2xs text-muted-foreground">
          {CONTEXT_SIZE_ESTIMATES.map((estimate) => (
            <li className="tabular-nums" key={estimate.label}>
              {estimate.label}: {formatContextTokens(estimate.tokens)}
            </li>
          ))}
        </ul>
        <p className="text-2xs text-muted-foreground">
          Estimates are conservative and labelled with ~. They never override a provider number, and
          they are not a promise about the model's real window.
        </p>
        <p aria-live="polite" className="text-2xs text-muted-foreground" role="status">
          {notice ??
            "Clearing a field removes the recorded size; the provider limit or estimate applies again."}
        </p>
      </CodeItLabCard>
    </div>
  );
}
