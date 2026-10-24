import * as Option from "effect/Option";
import { decideHomeDirectory } from "@t3tools/shared/homeDirectory";

export type JoinPath = (first: string, ...segments: string[]) => string;

/** Synchronous filesystem hooks; the desktop shell runs these before Electron is ready. */
export type DesktopHomeFs = {
  readonly exists: (path: string) => boolean;
  readonly rename: (from: string, to: string) => void;
};

function normalizeConfiguredBaseDir(t3Home: Option.Option<string>): Option.Option<string> {
  if (Option.isNone(t3Home)) {
    return Option.none();
  }
  const trimmed = t3Home.value.trim();
  return trimmed.length > 0 ? Option.some(trimmed) : Option.none();
}

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
  /** Omit to skip the one-time `~/.t3` move (tests, pure callers). */
  readonly homeFs?: DesktopHomeFs;
}): string {
  const configured = normalizeConfiguredBaseDir(input.t3Home);
  if (Option.isSome(configured)) return configured.value;
  const decision = decideHomeDirectory({
    homeDirectory: input.homeDirectory,
    joinPath: input.joinPath,
    currentExists: input.homeFs?.exists(input.joinPath(input.homeDirectory, ".cil")) ?? false,
    legacyExists: input.homeFs?.exists(input.joinPath(input.homeDirectory, ".t3")) ?? false,
  });
  if (decision.kind === "use") return decision.path;
  try {
    input.homeFs?.rename(decision.from, decision.to);
    return decision.to;
  } catch {
    // Keep working from the old directory; the next launch retries.
    return decision.from;
  }
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
  readonly t3Home: Option.Option<string>;
}): string {
  const useDevSubdir =
    input.isDevelopment && Option.isNone(normalizeConfiguredBaseDir(input.t3Home));
  return input.joinPath(input.baseDir, useDevSubdir ? "dev" : "userdata");
}
