import { codeitlabAgentLabel } from "@codeitlab/contracts";

/**
 * Display names for provider instance ids and snapshot names.
 *
 * Server snapshots carry the white-labeled agent name, but several surfaces
 * (Nexus session badges, routing history, health rows, preview fallbacks) only
 * have a driver id such as `hermes` or `acpRegistry_qoder_cli`. Those must still
 * read as `CodeItLab <Agent>` instead of leaking the raw id or vendor name.
 */

const KNOWN_INSTANCE_LABELS: Readonly<Record<string, string>> = {
  hermes: "Hermes",
  claudeAgent: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  grok: "Grok",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  pi: "Pi",
  muse: "Muse Code",
  acpRegistry: "ACP",
};

const ACP_INSTANCE_PREFIX = "acpRegistry_";

const ACRONYM_WORDS: ReadonlySet<string> = new Set([
  "acp",
  "ai",
  "api",
  "cli",
  "gpt",
  "llm",
  "mcp",
  "nim",
  "sdk",
  "ui",
]);

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYM_WORDS.has(lower)) return lower.toUpperCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function humanizeInstanceId(instanceId: string): string {
  const stripped = instanceId
    .replace(/^(hermes|claudeAgent|codex|cursor|grok|opencode|antigravity|pi|muse)[-_]/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return titleCaseWords(stripped);
}

/** `hermes` → `CodeItLab Hermes`, `acpRegistry_qoder_cli` → `CodeItLab Qoder CLI`. */
export function codeitlabProviderLabel(instanceId: string): string {
  const trimmed = instanceId.trim();
  if (trimmed.length === 0) return codeitlabAgentLabel(null);
  const known = KNOWN_INSTANCE_LABELS[trimmed];
  if (known !== undefined) return codeitlabAgentLabel(known);
  if (trimmed.startsWith(ACP_INSTANCE_PREFIX)) {
    const rest = humanizeInstanceId(trimmed.slice(ACP_INSTANCE_PREFIX.length));
    return codeitlabAgentLabel(rest.length > 0 ? rest : "ACP Agent");
  }
  const humanized = humanizeInstanceId(trimmed);
  return codeitlabAgentLabel(humanized.length > 0 ? humanized : trimmed);
}

const BRAND_PREFIX_PATTERN = /^CodeItLab\s+/i;

/** Brand a snapshot-supplied name; `hermes` (lowercase id) still reads as an agent name. */
export function codeitlabProviderName(name: string | null | undefined): string {
  const raw = (name ?? "").trim();
  if (raw.length === 0) return codeitlabAgentLabel(null);
  // Server health rows already carry the prefix but keep the raw id casing
  // ("CodeItLab hermes"); strip it so the known-label map can title-case it.
  const stripped = raw.replace(BRAND_PREFIX_PATTERN, "").trim();
  if (stripped.length === 0) return codeitlabAgentLabel(null);
  const known = KNOWN_INSTANCE_LABELS[stripped];
  if (known !== undefined) return codeitlabAgentLabel(known);
  const humanized = humanizeInstanceId(stripped);
  return codeitlabAgentLabel(humanized.length > 0 ? humanized : stripped);
}

/** Short driver label for technical columns: `hermes` → `Hermes`, `acpRegistry` → `ACP`. */
export function codeitlabProviderKindLabel(kind: string | null | undefined): string {
  const trimmed = (kind ?? "").trim();
  if (trimmed.length === 0) return "Agent";
  const known = KNOWN_INSTANCE_LABELS[trimmed];
  if (known !== undefined) return known;
  const humanized = humanizeInstanceId(trimmed);
  return humanized.length > 0 ? humanized : trimmed;
}
