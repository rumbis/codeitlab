import { describe, expect, it } from "vite-plus/test";
import type { EnvironmentProject } from "@codeitlab/client-runtime/state/models";
import { pullRequestFallbackEnvironment } from "./pullRequestEnvironmentFallback";

const project = (environmentId: string, id: string, canonicalKey: string) =>
  ({
    environmentId,
    id,
    repositoryIdentity: { canonicalKey },
  }) as unknown as EnvironmentProject;

const projects = [
  project("laptop", "codeitlab", "github.com/rumbis/codeitlab"),
  project("desktop", "other", "github.com/pingdotgg/other"),
  project("server", "cil-copy", "github.com/rumbis/codeitlab"),
];
const target = {
  environmentId: "laptop",
  projectId: "codeitlab",
  repository: "rumbis/codeitlab",
  host: "github.com",
};

describe("pullRequestFallbackEnvironment", () => {
  it("moves to a connected copy of the repository when the original is down", () => {
    expect(
      pullRequestFallbackEnvironment(target, projects, new Set(["desktop", "server"])),
    ).toEqual({ environmentId: "server", projectId: "cil-copy" });
  });

  it("stays put while the original is connected or nothing else holds the repository", () => {
    expect(pullRequestFallbackEnvironment(target, projects, new Set(["laptop", "server"]))).toBe(
      null,
    );
    expect(pullRequestFallbackEnvironment(target, projects, new Set(["desktop"]))).toBe(null);
  });

  it("derives the host from the original project when the route has none", () => {
    const { host: _host, ...hostless } = target;
    expect(pullRequestFallbackEnvironment(hostless, projects, new Set(["server"]))).toEqual({
      environmentId: "server",
      projectId: "cil-copy",
    });
  });
});
