import type { CodeItLabReaSettings } from "@codeitlab/core/settings";

/**
 * Always-on REA activation. This block is appended to every turn's instruction
 * context (subject to the per-turn char budget in `context.ts`), so an agent
 * reaches for REA on artifact/analysis work without the user naming it.
 */
export const reaAutoActivationBlock = (settings: CodeItLabReaSettings): string => {
  if (!settings.enabled || !settings.autoActivate) return "";
  return [
    "## REA (always available)",
    'The `codeitlab-rea` MCP server is connected to this session. Use it proactively, without waiting for the user to ask for REA, whenever the question depends on a shipped artifact rather than source: installed/packaged apps, Electron asar bundles, native binaries or dylibs, APKs, firmware, browser bundles, or "how does this app actually work".',
    "Start with `analyze` or `inspect` to get an overview and evidence id, then drill in with `function`/`decompile`/`inspect-analysis-view`. Quote evidence ids and report only what the evidence shows. Prefer static analysis; disclose operations with side effects (`capabilities` lists them) before running them. If a required engine (Hopper/Ghidra/IDA/JADX/Kuna) is missing, use the available operations and report the gap instead of installing anything.",
    "Skip REA for ordinary analysis of a complete source repository: repository tools are faster and more precise there.",
  ].join("\n");
};
