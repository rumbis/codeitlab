import { codeitlabProviderName } from "./providerLabels";

/** One choice in a fallback select; `value` is what the settings schema stores. */
export interface FallbackOption {
  readonly value: string;
  readonly label: string;
}

/** The slice of a routing-catalog provider the backup pickers need. */
export interface FallbackProviderInstance {
  readonly providerInstanceId: string;
  readonly name: string;
}

export const FIRST_HEALTHY_PROVIDER_LABEL = "First healthy provider";
export const PROVIDER_DEFAULT_MODEL_LABEL = "Provider default";
export const PROVIDER_FAILURE_COOLDOWN_OPTIONS: ReadonlyArray<number> = [5, 10, 30, 60];

/**
 * Backup-provider choices. The empty value is not "no backup" — it means the
 * router picks the first healthy enabled instance at failure time, which is the
 * safest default when the provider set changes between turns.
 */
export function fallbackProviderOptions(
  instances: ReadonlyArray<FallbackProviderInstance>,
): ReadonlyArray<FallbackOption> {
  const options: FallbackOption[] = [{ value: "", label: FIRST_HEALTHY_PROVIDER_LABEL }];
  const seen = new Set<string>();
  for (const instance of instances) {
    const id = instance.providerInstanceId.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    options.push({ value: id, label: codeitlabProviderName(instance.name) });
  }
  return options;
}

/** Backup-model choices for one provider; empty value means the provider's default. */
export function fallbackModelOptions(
  models: ReadonlyArray<string> | undefined,
): ReadonlyArray<FallbackOption> {
  const options: FallbackOption[] = [{ value: "", label: PROVIDER_DEFAULT_MODEL_LABEL }];
  const seen = new Set<string>();
  for (const model of models ?? []) {
    const slug = model.trim();
    if (slug.length === 0 || seen.has(slug)) continue;
    seen.add(slug);
    options.push({ value: slug, label: slug });
  }
  return options;
}

/**
 * The server records fallbacks as `fell back to <provider> because <primary>
 * failed` in the decision reason, so the history badge keys off that wording.
 */
export function isFallbackDecision(reason: string): boolean {
  return reason.toLowerCase().includes("fell back");
}
