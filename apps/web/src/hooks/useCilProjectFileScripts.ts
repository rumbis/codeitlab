import {
  CIL_PROJECT_FILE_NAME,
  type EnvironmentId,
  type CilProjectFile,
  type CilProjectFileScript,
} from "@codeitlab/contracts";
import { parseCilProjectFile } from "@codeitlab/shared/cilProjectFile";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<CilProjectFileScript> = [];

export interface CilProjectFileState {
  status: "loading" | "missing" | "invalid" | "valid";
  file: CilProjectFile | null;
  scripts: ReadonlyArray<CilProjectFileScript>;
}

export function useCilProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): CilProjectFileState {
  // cil.json is the current name; a repository that only has cil.json still works.
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
    CIL_PROJECT_FILE_NAME,
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
  const file = parseCilProjectFile(contents);
  if (file === null) {
    return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
  }
  return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
}

export function useCilProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<CilProjectFileScript> {
  return useCilProjectFileState(environmentId, cwd).scripts;
}
