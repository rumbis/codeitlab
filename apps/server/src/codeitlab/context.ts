import { CodeItLabServiceError } from "@codeitlab/core";
import type { EffectivePolicy, MemoryRecall, NexusCatalog, RoutingDecision } from "@codeitlab/core";
import {
  CodeItLabContextService,
  MemoryService,
  NexusService,
  PolicyService,
  RoutingService,
  type CodeItLabTurnContext,
  type CodeItLabTurnContextInput,
} from "@codeitlab/core/services";
import type { CodeItLabSettings } from "@codeitlab/core/settings";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import { renderEcosystemInstructions } from "@codeitlab/core/ecosystem";
import { graftTurnLine } from "./ecosystem/EcosystemService.ts";
import { buildNexusInstructions } from "./nexus/instructions.ts";
import { reaAutoActivationBlock } from "./rea/instructions.ts";

/**
 * One turn's CodeItLab context, composed from memory recall, the routing
 * decision, the instruction policy, REA auto-activation, and the Nexus catalog.
 *
 * The output is a single self-contained block so the transport hook can deliver
 * it through either channel: `appContext` for Codex, or a prefix on the turn
 * message for every other provider. The service is a pure composition over
 * already-existing services; each contributor degrades to "absent" on failure so
 * a broken memory store cannot block a turn.
 */

const MAX_CONTEXT_CHARS = 6_000;
const MAX_NEXUS_SKILLS = 12;
const MAX_NEXUS_MCP = 8;
const MAX_NEXUS_SESSIONS = 5;

export interface CodeItLabInstructionParts {
  readonly memory?: MemoryRecall | undefined;
  readonly decision?: RoutingDecision | undefined;
  /** The orchestrator already applied this route to the turn. */
  readonly routeEnforced?: boolean | undefined;
  readonly policy?: EffectivePolicy | undefined;
  readonly reaText?: string | undefined;
  readonly nexusText?: string | undefined;
  readonly ecosystemText?: string | undefined;
  readonly graftText?: string | undefined;
}

const memorySection = (recall: MemoryRecall | undefined): string => {
  if (recall === undefined || recall.injectedText.trim().length === 0) return "";
  return `## Recalled memory\n${recall.injectedText.trim()}`;
};

const routingSection = (decision: RoutingDecision | undefined, enforced: boolean): string => {
  if (decision === undefined) return "";
  const lines = [
    "## Routing decision",
    `Task class: ${decision.taskClass}. Provider: ${decision.providerInstanceId}. Model: ${decision.model}.`,
    `Reason: ${decision.reason}`,
    enforced
      ? "This route is already applied to the turn; do not switch providers or mention the routing machinery unless asked."
      : "Use this provider/model for the turn when the user has not pinned one explicitly; do not mention the routing machinery unless asked.",
  ];
  if (decision.omniRouteModel !== undefined) {
    lines.push(`OmniRoute virtual model: ${decision.omniRouteModel}.`);
  }
  return lines.join("\n");
};

/** Pure renderer so the turn-hook integration and its tests share one shape. */
export const renderCodeItLabInstructions = (parts: CodeItLabInstructionParts): string => {
  const sections = [
    parts.policy?.instructionBlock ?? "",
    memorySection(parts.memory),
    routingSection(parts.decision, parts.routeEnforced === true),
    parts.ecosystemText ?? "",
    parts.reaText ?? "",
    parts.graftText ?? "",
    parts.nexusText ?? "",
  ].filter((section) => section.trim().length > 0);

  if (sections.length === 0) return "";
  const body = sections.join("\n\n");
  if (body.length <= MAX_CONTEXT_CHARS) {
    return `<codeitlab_context>\n${body}\n</codeitlab_context>`;
  }
  // Over budget: keep the leading sections whole and trim the tail, which is the
  // cheapest content to lose (catalog names and routing prose).
  const trimmed = body.slice(0, MAX_CONTEXT_CHARS);
  const lastBreak = trimmed.lastIndexOf("\n\n");
  return `<codeitlab_context>\n${trimmed.slice(0, lastBreak > 0 ? lastBreak : MAX_CONTEXT_CHARS)}\n</codeitlab_context>`;
};

const standardPolicyFallback = (reason: string): EffectivePolicy => ({
  profile: "standard",
  appliedTo: [],
  unsupported: [],
  instructionBlock: "",
  limitations: [reason],
});

export const make = Effect.fn("codeitlab.context.make")(function* () {
  const settings = yield* ServerSettings.ServerSettingsService;
  const memory = yield* MemoryService;
  const routing = yield* RoutingService;
  const policy = yield* PolicyService;

  const readSettings = settings.getSettings.pipe(
    Effect.mapError(
      (cause) =>
        new CodeItLabServiceError({
          operation: "context.build",
          message: "Could not read settings to build the turn context.",
          cause,
        }),
    ),
  );

  const buildTurnContext: CodeItLabContextService["Service"]["buildTurnContext"] = Effect.fn(
    "codeitlab.context.buildTurnContext",
  )(function* (input: CodeItLabTurnContextInput) {
    const current = yield* readSettings;
    const codeitlab: CodeItLabSettings = current.codeitlab;
    const projectId = input.projectId ?? null;

    const recall = yield* Effect.gen(function* () {
      if (
        !codeitlab.memory.enabled ||
        !codeitlab.memory.autoRecall ||
        input.prompt.trim().length === 0
      ) {
        return undefined;
      }
      return yield* memory.recall({
        query: input.prompt,
        projectId,
        limit: codeitlab.memory.retrievalTopK,
        minScore: codeitlab.memory.minScore,
      });
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Memory recall failed; continuing without memories.", {
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );

    // When enforcement is on, the orchestrator already decided and recorded the
    // authoritative route for this turn; recording the advisory copy here would
    // write a second, contradictory history entry.
    const routeEnforced = codeitlab.routing.enforcement !== "off";
    const decision = yield* Effect.gen(function* () {
      if (codeitlab.routing.mode === "manual") return undefined;
      return yield* routing.decide({
        prompt: input.prompt,
        projectId,
        attachments: input.attachments ?? [],
        recordHistory: !routeEnforced,
      });
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Routing decision failed; continuing without a route.", {
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );

    const effectivePolicy = yield* policy
      .effective(
        input.providerInstanceId === undefined
          ? {}
          : { providerInstanceId: input.providerInstanceId },
      )
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Policy resolution failed; using the standard profile.", {
            cause,
          }).pipe(
            Effect.as(standardPolicyFallback("The policy service was unavailable for this turn.")),
          ),
        ),
      );

    const reaText = codeitlab.rea.enabled ? reaAutoActivationBlock(codeitlab.rea) : "";

    // Ecosystem packs come after the policy block and before REA, in the fixed
    // composition order Ponytail -> terse -> REA. They only add instruction
    // text; they never change what the upstream provider allows.
    const ecosystemText = renderEcosystemInstructions({
      settings: codeitlab.ecosystem,
      ...(input.threadOverride === "off" ? { threadOverride: "off" as const } : {}),
    });
    const graftText = graftTurnLine(codeitlab.ecosystem);

    const nexusService = yield* Effect.serviceOption(NexusService);
    const nexusCatalog: NexusCatalog | undefined = yield* Effect.gen(function* () {
      if (!codeitlab.nexus.enabled || !codeitlab.nexus.autoInject || Option.isNone(nexusService)) {
        return undefined;
      }
      return yield* nexusService.value.catalog;
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Nexus catalog read failed; continuing without it.", {
          cause,
        }).pipe(Effect.as(undefined)),
      ),
    );

    const nexusText =
      nexusCatalog === undefined
        ? ""
        : buildNexusInstructions(nexusCatalog, {
            query: input.prompt,
            maxSkills: MAX_NEXUS_SKILLS,
            maxMcpServers: MAX_NEXUS_MCP,
            maxSessions: MAX_NEXUS_SESSIONS,
          });

    const instructions = renderCodeItLabInstructions({
      memory: recall,
      decision,
      routeEnforced,
      policy: effectivePolicy,
      ecosystemText,
      reaText,
      graftText,
      nexusText,
    });

    return {
      instructions,
      ...(recall === undefined ? {} : { recall }),
      ...(decision === undefined ? {} : { decision }),
      policy: effectivePolicy,
      ...(nexusCatalog === undefined
        ? {}
        : {
            nexus: {
              skills: nexusCatalog.skills,
              mcpServers: nexusCatalog.mcpServers,
            },
          }),
    } satisfies CodeItLabTurnContext;
  });

  return CodeItLabContextService.of({ buildTurnContext });
});

export const layer = Layer.effect(CodeItLabContextService, make());
