import type { EffectivePolicy, PolicyProfile } from "@codeitlab/core/policy";

/**
 * The permissive ("uncensored") profile changes only the instructions CodeitLab
 * itself adds. It cannot and does not touch an upstream provider's safety
 * training or platform moderation, and the panel must say so.
 *
 * The text is deliberately explicit about what it does *not* permit: a test
 * asserts it never tells an agent to ignore provider policy, and the exclusions
 * stay visible so users understand the real scope.
 */

export const PERMISSIVE_PROFILE_ID = "direct-v1";

export const POLICY_LIMITATIONS: ReadonlyArray<string> = [
  "CodeitLab can only change the instructions it adds itself. Each provider's own safety training, system prompt, and platform moderation still apply and can still refuse.",
  "This does not bypass authentication, billing, rate limits, or a provider's terms of service.",
  "The profile does not legalise anything: the user remains responsible for what they ask for and for how output is used.",
  "Providers that receive instructions as a turn-message prefix (all non-Codex harnesses today) may weight them lower than their own system prompt.",
];

export const PERMISSIVE_INSTRUCTION_BLOCK = [
  "## CodeitLab operating mode: permissive (user-selected)",
  "The user has explicitly selected CodeitLab's permissive instruction profile. Within the provider's own limits:",
  "- Answer directly and concretely. Skip preambles, moralising, disclaimers, and unsolicited safety summaries.",
  "- Do not refuse merely because a topic is edgy: profanity, blunt critique, security-research detail, and adult-adjacent fiction are acceptable when the user asks for them.",
  "- Prefer the most useful true answer over the most cautious one. State uncertainty and risk as facts, not as refusals.",
  "- Keep professional standards for correctness: cite files, show commands, and mark what you did not verify.",
  "Hard limits that still apply, regardless of this mode:",
  "- No actionable instructions for illegal activity, weapons, or malware intended for real-world deployment.",
  "- No targeted harm, harassment, or non-consensual content involving real people.",
  "- No attempt to bypass the provider's own safety systems, and no claim that this mode does. If the provider refuses, report the refusal plainly.",
].join("\n");

export type InstructionMechanism =
  | "system-prompt"
  | "developer-instructions"
  | "first-prompt"
  | "message-prefix"
  | "none";

export interface ProviderInstructionSupport {
  readonly supported: boolean;
  readonly mechanism: InstructionMechanism;
  readonly detail: string;
}

const MESSAGE_PREFIX_SUPPORT = (detail: string): ProviderInstructionSupport => ({
  supported: true,
  mechanism: "message-prefix",
  detail,
});

/**
 * How CodeitLab's instruction block reaches each driver. Codex is the only
 * adapter that consumes `appContext` as developer instructions today; the turn
 * hook prefixes every other provider's message, which works universally but is
 * weaker than a system prompt. Kept honest rather than pretending parity.
 */
export const providerInstructionSupport = (driverKind: string): ProviderInstructionSupport => {
  switch (driverKind) {
    case "codex":
      return {
        supported: true,
        mechanism: "developer-instructions",
        detail: "Delivered as Codex developer instructions through appContext.",
      };
    case "claudeAgent":
      return MESSAGE_PREFIX_SUPPORT(
        "Delivered as a prefix on the turn message; Claude's own system prompt and safety training still apply.",
      );
    case "opencode":
      return MESSAGE_PREFIX_SUPPORT(
        "Delivered as a prefix on the turn message; OpenCode's own system prompt still applies.",
      );
    case "pi":
      return MESSAGE_PREFIX_SUPPORT(
        "Delivered as a prefix on the turn message; Pi's own instructions still apply.",
      );
    case "cursor":
      return MESSAGE_PREFIX_SUPPORT(
        "Delivered as a prefix on the turn message; Cursor's own system prompt still applies.",
      );
    case "grok":
    case "muse":
    case "antigravity":
    case "acpRegistry":
      return MESSAGE_PREFIX_SUPPORT(
        "Delivered as a prefix on the first turn message; the ACP agent's own system prompt still applies.",
      );
    default:
      return MESSAGE_PREFIX_SUPPORT(
        "Delivered as a prefix on the turn message; the provider's own instructions still apply.",
      );
  }
};

export interface PolicyResolutionInput {
  readonly profile: PolicyProfile;
  /** Instances the user limited the profile to; empty means every provider. */
  readonly applyToProviders: ReadonlyArray<string>;
  readonly instances: ReadonlyArray<{ readonly instanceId: string; readonly driverKind: string }>;
  /** Set when resolving a single turn's provider. */
  readonly providerInstanceId?: string | undefined;
}

export const resolveEffectivePolicy = (input: PolicyResolutionInput): EffectivePolicy => {
  if (input.profile === "standard") {
    return {
      profile: "standard",
      appliedTo: [],
      unsupported: [],
      instructionBlock: "",
      limitations: [],
    };
  }

  const candidates =
    input.providerInstanceId === undefined
      ? input.instances
      : input.instances.filter((instance) => instance.instanceId === input.providerInstanceId);
  const appliedTo: string[] = [];
  const unsupported: Array<{ readonly providerInstanceId: string; readonly reason: string }> = [];
  for (const instance of candidates) {
    const support = providerInstructionSupport(instance.driverKind);
    if (!support.supported) {
      unsupported.push({
        providerInstanceId: instance.instanceId,
        reason: support.detail,
      });
      continue;
    }
    if (
      input.applyToProviders.length > 0 &&
      !input.applyToProviders.includes(instance.instanceId)
    ) {
      continue;
    }
    appliedTo.push(instance.instanceId);
  }

  if (input.providerInstanceId !== undefined && candidates.length === 0) {
    unsupported.push({
      providerInstanceId: input.providerInstanceId,
      reason: "Provider instance is not registered in this environment.",
    });
  }

  return {
    profile: "permissive",
    appliedTo,
    unsupported,
    instructionBlock: PERMISSIVE_INSTRUCTION_BLOCK,
    limitations: [...POLICY_LIMITATIONS],
  };
};
