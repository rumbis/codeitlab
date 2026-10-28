import {
  CIL_PROJECT_FILE_NAME,
  type EnvironmentId,
  type CilProjectFile,
} from "@codeitlab/contracts";
import { parseCilProjectFile } from "@codeitlab/shared/cilProjectFile";
import { executeAtomQuery } from "@codeitlab/client-runtime/state/runtime";

import {
  getProjectFileQueryAtom,
  resolveProjectFileQueryData,
} from "~/components/files/projectFilesQueryState";
import { appAtomRegistry } from "~/rpc/atomRegistry";

export async function readCilProjectFile(
  environmentId: EnvironmentId,
  workspaceRoot: string,
): Promise<CilProjectFile | null> {
  const result = await executeAtomQuery(
    appAtomRegistry,
    getProjectFileQueryAtom(environmentId, workspaceRoot, CIL_PROJECT_FILE_NAME),
    { reportDefect: false, reportFailure: false },
  );
  const data = resolveProjectFileQueryData(
    environmentId,
    workspaceRoot,
    CIL_PROJECT_FILE_NAME,
    result._tag === "Success" ? result.value : null,
  );
  if (data === null || data.exists === false || data.truncated) return null;
  return parseCilProjectFile(data.contents);
}
