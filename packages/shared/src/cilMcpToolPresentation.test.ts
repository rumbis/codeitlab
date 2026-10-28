import { describe, expect, it } from "vite-plus/test";

import { CIL_MCP_TOOL_NAMES, resolvecilMcpToolPresentation } from "./cilMcpToolPresentation.ts";

describe("resolvecilMcpToolPresentation", () => {
  it("recognizes every CodeItLab tool across provider prefixes and completion suffixes", () => {
    for (const tool of CIL_MCP_TOOL_NAMES) {
      const presentation = resolvecilMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__cil-code__",
        "mcp__cil_code__",
        "mcp__codeitlab__",
        "CodeItLab-code.",
        "cil_code/",
        "codeitlab:",
        "mcp_cil-code_",
        "CodeItLab ",
        "cil-code · ",
      ]) {
        expect(resolvecilMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolvecilMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });
  it("pretty prints Claude and Cursor CodeItLab MCP tool names", () => {
    expect(resolvecilMcpToolPresentation("mcp__cil-code__cil_thread_read")).toEqual({
      displayName: "Read a CodeItLab thread",
      logo: "cil-code",
    });
  });

  it("pretty prints Codex CodeItLab MCP tool names", () => {
    expect(resolvecilMcpToolPresentation("cil-code.create_threads")).toEqual({
      displayName: "Create CodeItLab threads",
      logo: "cil-code",
    });
  });

  it("pretty prints thread metadata updates", () => {
    expect(resolvecilMcpToolPresentation("mcp__cil-code__cil_thread_update")).toEqual({
      displayName: "Update CodeItLab thread metadata",
      logo: "cil-code",
    });
  });

  it("pretty prints bare CodeItLab MCP toolkit names", () => {
    expect(resolvecilMcpToolPresentation("list_scheduled_tasks")).toEqual({
      displayName: "List scheduled tasks",
      logo: "cil-code",
    });
  });

  it("pretty prints worktree CodeItLab MCP tool names", () => {
    expect(resolvecilMcpToolPresentation("mcp__cil-code__cil_worktree_handoff")).toEqual({
      displayName: "Hand off thread to a git worktree",
      logo: "cil-code",
    });
    expect(resolvecilMcpToolPresentation("cil-code.cil_worktree_status")).toEqual({
      displayName: "Get thread worktree status",
      logo: "cil-code",
    });
  });

  it("pretty prints preview CodeItLab MCP tool names", () => {
    expect(resolvecilMcpToolPresentation("CodeItLab-code.preview_open")).toEqual({
      displayName: "Open a page in the preview browser",
      logo: "cil-code",
    });
    expect(resolvecilMcpToolPresentation("mcp__cil-code__preview_status")).toEqual({
      displayName: "Get preview browser status",
      logo: "cil-code",
    });
  });

  it("matches the separator variants ACP registry agents emit", () => {
    for (const name of [
      "mcp_cil-code_delegate_task",
      "cil_code:delegate_task",
      "codeitlab/delegate_task",
      "cil-code delegate_task",
      "CodeItLab delegate_task",
      "cil-code__delegate_task",
    ]) {
      expect(resolvecilMcpToolPresentation(name)?.displayName).toBe("Delegate a child task");
    }
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolvecilMcpToolPresentation("cil-code-thread_opencode2-adapter_delegate_task")?.displayName,
    ).toBe("Delegate a child task");
    expect(
      resolvecilMcpToolPresentation("cil-code-thread_opencode2-adapter_not_a_tool"),
    ).toBeNull();
  });

  it("keeps unknown MCP tools on the generic renderer path", () => {
    expect(resolvecilMcpToolPresentation("mcp__github__search_issues")).toBeNull();
    expect(resolvecilMcpToolPresentation("cil-code.not_a_real_tool")).toBeNull();
  });
});
