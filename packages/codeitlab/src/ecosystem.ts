import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Ecosystem integrations: Graft, Ponytail, Caveman (terse).
 *
 * CodeitLab ships these as *built-in, auto-activated* capabilities: the user
 * never configures them and never has to ask for them. Activation is server
 * policy, injection is per-turn context, and every behaviour has a settings
 * override.
 *
 * The two policy packs are vendored instruction text, not a plugin runtime:
 *  - `ponytail` — minimal-change engineering policy, vendored from Ponytail
 *    v5.1.1 by Dietrich Gebert (MIT). CodeItLab renders the ruleset for the
 *    active mode; it does not run the upstream hook scripts.
 *  - `terse` — the "caveman" terseness rule the user already runs as a Hermes
 *    pre-LLM hook. Rendered server-side, so there is no per-turn subprocess.
 *
 * Attribution lives in `ECOSYSTEM_ATTRIBUTION` and in the rendered block.
 */

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const NumberDefault = (value: number) =>
  Schema.Number.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const TrimmedStringDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

const StringArrayDefault = (value: ReadonlyArray<string>) =>
  Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([...value])));

export const CodeitlabGraftMode = Schema.Literals(["auto", "always", "off"]);
export type CodeitlabGraftMode = typeof CodeitlabGraftMode.Type;

export const CodeitlabPolicyPackMode = Schema.Literals(["off", "lite", "full", "ultra"]);
export type CodeitlabPolicyPackMode = typeof CodeitlabPolicyPackMode.Type;

export const CodeitlabTerseMode = Schema.Literals(["off", "lite", "full"]);
export type CodeitlabTerseMode = typeof CodeitlabTerseMode.Type;

export const CodeitlabGraftSettings = Schema.Struct({
  enabled: BooleanDefault(true),
  /** `auto` registers the graph for git repos over the size threshold. */
  mode: CodeitlabGraftMode.pipe(Schema.withDecodingDefault(Effect.succeed("auto" as const))),
  /** `--deep` adds an LLM concept map; it costs tokens, so it is opt-in. */
  deep: BooleanDefault(false),
  maxBuildMinutes: NumberDefault(10),
  freshnessTtlMins: NumberDefault(60),
  /** Files above this count are treated as "large repo" for `auto` mode. */
  autoFileThreshold: NumberDefault(200),
  excludeGlobs: StringArrayDefault(["node_modules/**", ".git/**", "dist/**", "build/**"]),
  mcpCommand: TrimmedStringDefault("graft"),
  mcpArgs: StringArrayDefault(["mcp"]),
  /** Bundled MCP servers inherit a scrubbed env; telemetry stays off. */
  telemetryOff: BooleanDefault(true),
});
export type CodeitlabGraftSettings = typeof CodeitlabGraftSettings.Type;

export const CodeitlabPonytailSettings = Schema.Struct({
  enabled: BooleanDefault(true),
  mode: CodeitlabPolicyPackMode.pipe(Schema.withDecodingDefault(Effect.succeed("full" as const))),
  /** Register the six upstream commands as slash commands. */
  commandsEnabled: BooleanDefault(true),
  attribution: BooleanDefault(true),
});
export type CodeitlabPonytailSettings = typeof CodeitlabPonytailSettings.Type;

export const CodeitlabTerseSettings = Schema.Struct({
  /**
   * Always on: the user asked for the caveman/terse rule to apply without
   * having to request it. A thread can still opt out with "normal mode".
   */
  enabled: BooleanDefault(true),
  mode: CodeitlabTerseMode.pipe(Schema.withDecodingDefault(Effect.succeed("lite" as const))),
  /** Detect terse mode from a migrated Hermes preference on first import. */
  autoDetect: BooleanDefault(true),
});
export type CodeitlabTerseSettings = typeof CodeitlabTerseSettings.Type;

export const CodeitlabEcosystemSettings = Schema.Struct({
  graft: CodeitlabGraftSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  ponytail: CodeitlabPonytailSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
  terse: CodeitlabTerseSettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type CodeitlabEcosystemSettings = typeof CodeitlabEcosystemSettings.Type;

// ---------------------------------------------------------------------------
// Status (RPC surface)
// ---------------------------------------------------------------------------

export const CodeitlabEcosystemIntegrationKind = Schema.Literals(["mcp", "policy-pack"]);
export type CodeitlabEcosystemIntegrationKind = typeof CodeitlabEcosystemIntegrationKind.Type;

export const CodeitlabEcosystemIntegrationId = Schema.Literals(["graft", "ponytail", "terse"]);
export type CodeitlabEcosystemIntegrationId = typeof CodeitlabEcosystemIntegrationId.Type;

export const CodeitlabEcosystemIntegration = Schema.Struct({
  id: CodeitlabEcosystemIntegrationId,
  name: Schema.String,
  kind: CodeitlabEcosystemIntegrationKind,
  enabled: Schema.Boolean,
  /** Effective mode: graft auto|always|off, ponytail off|lite|full|ultra, terse off|lite|full. */
  mode: Schema.String,
  version: Schema.optionalKey(Schema.String),
  available: Schema.Boolean,
  /** One-line human explanation of the current state. */
  detail: Schema.String,
  warnings: Schema.Array(Schema.String),
});
export type CodeitlabEcosystemIntegration = typeof CodeitlabEcosystemIntegration.Type;

export const CodeitlabEcosystemStatus = Schema.Struct({
  integrations: Schema.Array(CodeitlabEcosystemIntegration),
  generatedAt: Schema.String,
  warnings: Schema.Array(Schema.String),
});
export type CodeitlabEcosystemStatus = typeof CodeitlabEcosystemStatus.Type;

export const CodeitlabEcosystemInstallResult = Schema.Struct({
  status: CodeitlabEcosystemStatus,
  written: Schema.Array(Schema.String),
});
export type CodeitlabEcosystemInstallResult = typeof CodeitlabEcosystemInstallResult.Type;

// ---------------------------------------------------------------------------
// Vendored policy packs
// ---------------------------------------------------------------------------

export const ECOSYSTEM_ATTRIBUTION = {
  ponytail: "Ponytail v5.1.1 — Dietrich Gebert (MIT)",
  terse: "Caveman terseness hook — user-authored rule, adopted with attribution",
  graft: "Graft v0.21.1 — @nanonets/graft (MCP server)",
} as const;

const PONYTAIL_RULES: Record<Exclude<CodeitlabPolicyPackMode, "off">, ReadonlyArray<string>> = {
  lite: [
    "Make the smallest complete change that satisfies the request.",
    "Before writing, state what you are about to change and why (one line, not a plan document).",
  ],
  full: [
    "Make the smallest complete change that satisfies the request. Do not refactor adjacent code.",
    "No unrequested abstractions, options, flags, or helper layers. Add an abstraction only when the second caller exists.",
    "Scope check before writing: name the files you will touch; if a file is outside the request, ask first.",
    "Prefer editing existing code over adding new files. Prefer deleting over commenting out.",
    "Do not add tests, docs, or logging the user did not ask for, unless the change is untestable without them.",
    "Match the surrounding code style instead of importing your own.",
    "End with one line: what you skipped and the risk of skipping it.",
  ],
  ultra: [
    "Make the smallest complete change that satisfies the request. One concern per response.",
    "Zero unrequested abstractions, options, flags, or helper layers. No new files unless unavoidable.",
    "Scope check before writing: name the files you will touch; anything outside the request waits.",
    "No unrequested tests, docs, logging, comments, or reformatting.",
    "Delete dead code you touch instead of preserving it.",
    "End with one line: what you skipped and the risk of skipping it. Nothing else.",
  ],
};

const TERSE_RULES: Record<Exclude<CodeitlabTerseMode, "off">, ReadonlyArray<string>> = {
  lite: [
    "Answer first, then the minimum supporting detail. No preamble, no ceremony.",
    "Short words, short sentences. One idea per sentence.",
    "Quote payloads, errors, and file paths verbatim — never paraphrase them.",
  ],
  full: [
    "Answer first. No preamble, no restating the question, no closing summary.",
    "Short words, short sentences (about 20 words max). One idea per sentence.",
    "Quote payloads, errors, and file paths verbatim — never paraphrase them.",
    "Report tool runs as one bounded line each (what ran, result); do not narrate intentions.",
    "Never perform the style (no 'caveman speak'); the content is plain English, just compressed.",
    "Auto-clarity exceptions: security warnings, irreversible actions, step order, and user confusion get plain prose, then resume.",
    "Stop when the user says 'stop caveman', 'normal mode', or 'stop terse'.",
  ],
};

export interface CodeitlabPackRenderInput {
  readonly settings: CodeitlabEcosystemSettings;
  /** Project is a code repository (enables Ponytail by default in `auto`). */
  readonly isCodeProject?: boolean;
  /** Thread-level override, e.g. a security review thread forces packs off. */
  readonly threadOverride?: "off" | null;
}

export interface CodeitlabRenderedPack {
  readonly id: "ponytail" | "terse";
  readonly title: string;
  readonly mode: string;
  readonly lines: ReadonlyArray<string>;
}

/** Resolves the effective pack modes for a turn. */
export const resolvePackModes = (
  input: CodeitlabPackRenderInput,
): { readonly ponytail: CodeitlabPolicyPackMode; readonly terse: CodeitlabTerseMode } => {
  const { settings } = input;
  if (input.threadOverride === "off") {
    return { ponytail: "off", terse: "off" };
  }
  const ponytail = settings.ponytail.enabled
    ? settings.ponytail.mode === "off"
      ? "off"
      : settings.ponytail.mode
    : "off";
  const terse = settings.terse.enabled ? settings.terse.mode : "off";
  return { ponytail, terse };
};

/**
 * Renders the packs for one turn, in the fixed composition order
 * Ponytail → terse. Later packs may compress earlier lines but never remove
 * them (the risk line stays).
 */
export const renderEcosystemPacks = (
  input: CodeitlabPackRenderInput,
): ReadonlyArray<CodeitlabRenderedPack> => {
  const modes = resolvePackModes(input);
  const packs: Array<CodeitlabRenderedPack> = [];
  if (modes.ponytail !== "off") {
    packs.push({
      id: "ponytail",
      title: "Ponytail policy (minimal change)",
      mode: modes.ponytail,
      lines: PONYTAIL_RULES[modes.ponytail],
    });
  }
  if (modes.terse !== "off") {
    packs.push({
      id: "terse",
      title: "Terse communication",
      mode: modes.terse,
      lines: TERSE_RULES[modes.terse],
    });
  }
  return packs;
};

/** The instruction block injected into a turn, or an empty string. */
export const renderEcosystemInstructions = (input: CodeitlabPackRenderInput): string => {
  const packs = renderEcosystemPacks(input);
  if (packs.length === 0) return "";
  const sections = packs.map((pack) => {
    const heading = `### ${pack.title} (mode: ${pack.mode})`;
    const body = pack.lines.map((line) => `- ${line}`).join("\n");
    return `${heading}\n${body}`;
  });
  const attribution = input.settings.ponytail.attribution
    ? `\n_Attribution: ${ECOSYSTEM_ATTRIBUTION.ponytail}; ${ECOSYSTEM_ATTRIBUTION.terse}._`
    : "";
  return `## CodeItLab ecosystem policy\n\n${sections.join("\n\n")}${attribution}`;
};

/** Graft is offered when the project is a large-enough git repository. */
export const graftAppliesToProject = (input: {
  readonly settings: CodeitlabGraftSettings;
  readonly isGitRepo: boolean;
  readonly fileCount: number;
}): boolean => {
  if (!input.settings.enabled || input.settings.mode === "off") return false;
  if (input.settings.mode === "always") return input.isGitRepo;
  return input.isGitRepo && input.fileCount >= input.settings.autoFileThreshold;
};

/** One appContext line telling the agent the graph exists and how to use it. */
export const graftInstructionLine = (): string =>
  "Graft graph is available for this repo: use graft_repo_map / graft_find_code / graft_trace_calls before broad file reads, and graft_check_freshness before trusting a stale graph.";
