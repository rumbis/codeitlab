import * as Option from "effect/Option";
import { cilHomePath } from "@codeitlab/shared/homeDirectory";

export type JoinPath = (first: string, ...segments: string[]) => string;

function normalizeConfiguredBaseDir(CilHome: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(CilHome)) {
    return Option.none();
  }
  const trimmed = CilHome.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly CilHome: Option.Option<string>;
}): string {
  const configured = normalizeConfiguredBaseDir(input.CilHome);
  if (Option.isSome(configured)) return configured.value;
  return cilHomePath({ homeDirectory: input.homeDirectory, joinPath: input.joinPath });
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly CilHome: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.CilHome));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
