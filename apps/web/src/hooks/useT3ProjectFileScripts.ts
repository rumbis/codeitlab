import {
  CIL_PROJECT_FILE_NAME,
  T3_PROJECT_FILE_NAME,
  type EnvironmentId,
  type T3ProjectFile,
  type T3ProjectFileScript,
} from "@t3tools/contracts";
import { parseT3ProjectFile } from "@t3tools/shared/t3ProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<T3ProjectFileScript> = [];

export interface T3ProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: T3ProjectFile | null;
  scripts: ReadonlyArray<T3ProjectFileScript>;
}

export function useT3ProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): T3ProjectFileState {
  // cil.json is the current name; a repository that only has t3.json still works.
  const primary = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    CIL_PROJECT_FILE_NAME,
    cwd !== null,
  );
  const primaryMissing = !primary.isPending && primary.data === null;
  const legacy = useProjectFileQuery(
    environmentId,
    cwd ?? "",
    T3_PROJECT_FILE_NAME,
    cwd !== null && primaryMissing,
  );
  // While cil.json is still loading, report loading rather than falling through
  // to a disabled legacy query and claiming the file is missing.
  const query = primary.data !== null || primary.isPending ? primary : legacy;
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  if (contents === null) {
    return {
      status: isPending ? "loading" : "missing",
      file: null,
      scripts: NO_SCRIPTS,
    } as const;
  }
  const file = parseT3ProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useT3ProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<T3ProjectFileScript> {
  return useT3ProjectFileState(environmentId, cwd).scripts;
}
