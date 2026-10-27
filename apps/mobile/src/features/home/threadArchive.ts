import {
  threadRuntimeCanArchive,
  type ThreadRuntimeSummary,
} from "@codeitlab/client-runtime/state/models";

export function threadCanArchive(runtime: ThreadRuntimeSummary | null | undefined): boolean {
  return threadRuntimeCanArchive(runtime);
}
