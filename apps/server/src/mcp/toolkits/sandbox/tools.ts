import {
  OrchestratorMcpFailure,
  SandboxHealth,
  SandboxRunInput,
  SandboxRunResult,
  SandboxSyncResult,
} from "@codeitlab/contracts";
import { SandboxService as SandboxServiceTag } from "@codeitlab/core/services";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  ProjectService.ProjectService,
  SandboxServiceTag,
];

const SandboxStatusTool = Tool.make("cil_sandbox_status", {
  description:
    "Report whether this machine can run a sandbox and what sandbox machine exists: per-backend readiness (Tart on macOS, Docker/Podman on Linux, WSL2 on Windows), the machine's name, image and state (running/stopped/missing/unsupported/unknown), and for a stopped Tart machine the exact command that starts it. Read-only: it probes installed CLIs and runs no command inside the sandbox. Creating or removing the machine happens in the CodeItLab Setup page and needs human consent, so no tool does it.",
  success: SandboxHealth,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Read sandbox health")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const SandboxRunTool = Tool.make("cil_sandbox_run", {
  description:
    "Run one shell command inside the CodeItLab sandbox machine (a Docker/Podman container, or a Tart VM while it is running) and return its exit code, stdout/stderr tail and duration. Needs a machine that exists and is running: the app never starts it, so a stopped Tart machine fails with the start command to run yourself. Requires a live full-access thread. Commands are capped at 4,000 characters with a 10 s default and 120 s maximum timeout; output keeps its last 8,000 characters and is env-redacted. This executes real code inside the sandbox: use it for checks and builds, not to change the host.",
  parameters: SandboxRunInput,
  success: SandboxRunResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Run a command in the sandbox")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const SandboxSyncTool = Tool.make("cil_sandbox_sync", {
  description:
    "Copy this thread's git-tracked files into /work inside the CodeItLab sandbox machine, so cil_sandbox_run can build or test the real code instead of only running probes. Only tracked files move: everything gitignored, including .env, stays on the host. Caps at 500 files and 8 MB, and nothing is copied back out of the machine. Needs a machine that exists and is running, and a live full-access thread.",
  // No explicit empty Schema.Struct({}): that does not encode to an object-root
  // JSON Schema, which makes MCP clients reject the whole server. Tool.EmptyParams
  // (the default) is the object schema MCP requires.
  success: SandboxSyncResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Title, "Copy tracked files into the sandbox")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const SandboxToolkit = Toolkit.make(SandboxStatusTool, SandboxRunTool, SandboxSyncTool);
