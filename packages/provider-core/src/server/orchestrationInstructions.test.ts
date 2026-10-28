import { assert, describe, it } from "@effect/vitest";

import {
  CIL_CODE_ORCHESTRATION_INSTRUCTIONS,
  CilAcpPromptWithInstructions,
  CilOrchestrationPromptForFirstRun,
  CilOrchestrationSystemPrompt,
} from "./orchestrationInstructions.ts";

describe("CodeItLab orchestration provider instructions", () => {
  it("distinguishes delegated subagents from ordinary top-level threads", () => {
    assert.include(CIL_CODE_ORCHESTRATION_INSTRUCTIONS, "Use `delegate_task`");
    assert.include(
      CIL_CODE_ORCHESTRATION_INSTRUCTIONS,
      "ordinary top-level CodeItLab conversations",
    );
    assert.include(CIL_CODE_ORCHESTRATION_INSTRUCTIONS, "Never use them merely");
    assert.include(CIL_CODE_ORCHESTRATION_INSTRUCTIONS, "cross-provider");
    assert.include(CIL_CODE_ORCHESTRATION_INSTRUCTIONS, "call `delegate_task` again");
    assert.include(
      CIL_CODE_ORCHESTRATION_INSTRUCTIONS,
      "Do not use `cil_thread_send` on `childThreadId`",
    );
  });

  it("documents structured schedules instead of JSON strings", () => {
    assert.include(CIL_CODE_ORCHESTRATION_INSTRUCTIONS, "structured object, never as JSON text");
    assert.include(CIL_CODE_ORCHESTRATION_INSTRUCTIONS, '"everyMs":3600000');
    assert.include(CIL_CODE_ORCHESTRATION_INSTRUCTIONS, "bindToCurrentThread=false");
  });

  it("injects prompt fallback only for an MCP-enabled first run", () => {
    const prompt = "Inspect the repository.";
    const injected = CilOrchestrationPromptForFirstRun({
      prompt,
      runOrdinal: 1,
      hasCilMcp: true,
    });

    assert.include(injected, "<cil_code_orchestration_instructions>");
    assert.include(injected, `<user_request>\n${prompt}\n</user_request>`);
    assert.equal(
      CilOrchestrationPromptForFirstRun({ prompt, runOrdinal: 2, hasCilMcp: true }),
      prompt,
    );
    assert.equal(
      CilOrchestrationPromptForFirstRun({ prompt, runOrdinal: 1, hasCilMcp: false }),
      prompt,
    );
  });

  it("only exposes the system prompt when the CodeItLab MCP server is attached", () => {
    assert.equal(CilOrchestrationSystemPrompt(false), undefined);
    assert.equal(CilOrchestrationSystemPrompt(true), CIL_CODE_ORCHESTRATION_INSTRUCTIONS);
  });

  it("gives ACP sessions provider-neutral mode, browser, and orchestration guidance", () => {
    const injected = CilAcpPromptWithInstructions({
      prompt: "Inspect the repository.",
      state: { interactionMode: "default", hasCilMcp: true },
    });

    assert.include(injected, "CodeItLab interaction mode: Default");
    assert.include(injected, "CodeItLab collaborative browser");
    assert.include(injected, "CodeItLab orchestration");
    assert.include(injected, "<user_request>\nInspect the repository.\n</user_request>");
  });

  it("reinjects ACP guidance only when mode or tool availability changes", () => {
    const prompt = "Continue.";
    const defaultState = { interactionMode: "default", hasCilMcp: true } as const;

    assert.equal(
      CilAcpPromptWithInstructions({ prompt, state: defaultState, previousState: defaultState }),
      prompt,
    );
    assert.include(
      CilAcpPromptWithInstructions({
        prompt,
        state: { ...defaultState, interactionMode: "plan" },
        previousState: defaultState,
      }),
      "CodeItLab interaction mode: Plan",
    );
    const withoutMcp = CilAcpPromptWithInstructions({
      prompt,
      state: { interactionMode: "default", hasCilMcp: false },
    });
    assert.include(withoutMcp, "CodeItLab interaction mode: Default");
    assert.notInclude(withoutMcp, "CodeItLab collaborative browser");
    assert.notInclude(withoutMcp, "CodeItLab orchestration");
  });
});
