import { type CodeItLabServiceError, OrchestratorMcpFailure } from "@codeitlab/contracts";
import { SandboxService as SandboxServiceTag } from "@codeitlab/core/services";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Project from "../../../project/ProjectService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertFullAccess, readCaller, readThread, unavailable } from "../../threadAccess.ts";
import { SandboxToolkit } from "./tools.ts";

/** Keep the server's own sentence: "the machine is stopped, start it with ..." is the answer. */
const sandboxFailure = (error: CodeItLabServiceError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

const handlers = {
  cil_sandbox_status: McpToolAccess.reads(() =>
    Effect.gen(function* () {
      const sandbox = yield* SandboxServiceTag;
      return yield* sandbox.health.pipe(Effect.mapError(sandboxFailure));
    }),
  ),
  cil_sandbox_run: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const caller = yield* readCaller();
      yield* assertFullAccess(
        caller,
        "Running commands in the sandbox needs a live full-access thread.",
      );
      const sandbox = yield* SandboxServiceTag;
      return yield* sandbox.run(input).pipe(Effect.mapError(sandboxFailure));
    }),
  ),
  cil_sandbox_sync: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const caller = yield* readCaller();
      yield* assertFullAccess(
        caller,
        "Copying this thread's files into the sandbox needs a live full-access thread.",
      );
      // The cwd comes from the calling thread, never from the tool input: an
      // agent may copy its own workspace, not an arbitrary host path.
      const {
        projection: { thread },
      } = yield* readThread();
      const projects = yield* Project.ProjectService;
      const project = yield* projects.getById(thread.projectId).pipe(Effect.mapError(unavailable));
      if (Option.isNone(project)) {
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "The project was not found.",
        });
      }
      const sandbox = yield* SandboxServiceTag;
      return yield* sandbox
        .machineSync({ cwd: thread.worktreePath ?? project.value.workspaceRoot })
        .pipe(Effect.mapError(sandboxFailure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof SandboxToolkit.tools>;

export const layer = McpToolAccess.toLayer(SandboxToolkit, handlers);
