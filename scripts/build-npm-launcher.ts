#!/usr/bin/env node
/**
 * Builds the `t3` npm package behind `npx t3` / `npm i -g t3`: a launcher
 * with no dependencies that downloads this exact version's CLI archive from
 * the GitHub Release on first run (scripts/npm-launcher/t3.mjs).
 * The executables are not published to npm. npm's publish-time scanning held
 * 250 MB platform packages back for up to an hour after the launcher went
 * live, and every install in that window ran a launcher with nothing to
 * launch.
 *
 * Output: `<output-dir>/t3/` (the package tree) and `<output-dir>/t3.tgz`,
 * which is what gets published.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as HostProcess from "@t3tools/shared/HostProcess";
import { fromJsonStringPretty } from "@t3tools/shared/schemaJson";
import serverPackageJson from "../apps/server/package.json" with { type: "json" };

import { windowsSystemTar } from "./lib/windows-tar.ts";

export const NPM_LAUNCHER_PACKAGE_NAME = "t3";

/** The package this fork publishes; `npx codeitlab` runs the CodeitLab CLI. */
export const CODEITLAB_CLI_PACKAGE_NAME = "codeitlab";

const encodePackageJson = Schema.encodeEffect(fromJsonStringPretty(Schema.Unknown));

export class NpmLauncherCommandFailedError extends Schema.TaggedError<NpmLauncherCommandFailedError>()(
  "NpmLauncherCommandFailedError",
  { command: Schema.String, exitCode: Schema.Int },
) {
  override get message(): string {
    return `${this.command} exited with code ${this.exitCode}.`;
  }
}

/** package.json for the launcher. `engines` asks for `import.meta.dirname` and `fetch`. */
export function npmLauncherPackageManifest(version: string) {
  return {
    name: NPM_LAUNCHER_PACKAGE_NAME,
    version,
    description:
      "T3 Code CLI. Downloads the self-contained executable for this platform from the GitHub Release.",
    license: serverPackageJson.license,
    repository: serverPackageJson.repository,
    bin: { t3: "./bin/t3.mjs" },
    files: ["bin", "dist"],
    engines: { node: ">=20.11" },
  };
}

/** package.json for the CodeitLab CLI launcher. */
export function codeitlabCliPackageManifest(version: string) {
  return {
    name: CODEITLAB_CLI_PACKAGE_NAME,
    version,
    description:
      "CodeitLab CLI. Runs the CLI of the CodeitLab desktop app on this machine, or downloads the matching CLI build from the CodeitLab release.",
    license: serverPackageJson.license,
    repository: {
      type: "git",
      url: "https://github.com/rumbis/codeitlab",
      directory: "apps/server",
    },
    bin: { codeitlab: "./bin/codeitlab.mjs" },
    files: ["bin", "dist"],
    engines: { node: ">=20.11" },
    keywords: ["codeitlab", "cli", "acp", "agents"],
  };
}

/** Builds the `codeitlab` package tree and tarball, the same way as `t3`. */
export const buildCodeitlabCliPackage = Effect.fn("buildCodeitlabCliPackage")(function* (input: {
  readonly version: string;
  readonly outputDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const sourceDir = yield* path.fromFileUrl(new URL("./npm-launcher/", import.meta.url));

  yield* fs.makeDirectory(input.outputDir, { recursive: true });
  const scratch = yield* fs.makeTempDirectoryScoped({
    directory: input.outputDir,
    prefix: ".codeitlab-launcher-",
  });
  const stageDir = path.join(scratch, "package");
  yield* fs.makeDirectory(path.join(stageDir, "bin"), { recursive: true });
  yield* fs.makeDirectory(path.join(stageDir, "dist"));
  yield* fs.writeFileString(
    path.join(stageDir, "package.json"),
    `${yield* encodePackageJson(codeitlabCliPackageManifest(input.version))}\n`,
  );
  yield* fs.copyFile(
    path.join(sourceDir, "codeitlab.mjs"),
    path.join(stageDir, "bin/codeitlab.mjs"),
  );
  yield* fs.chmod(path.join(stageDir, "bin/codeitlab.mjs"), 0o755);
  yield* fs.copyFile(
    path.join(sourceDir, "codeitlab-bin.mjs"),
    path.join(stageDir, "dist/bin.mjs"),
  );
  const readme = yield* path.fromFileUrl(new URL("../apps/server/README.md", import.meta.url));
  if (yield* fs.exists(readme)) {
    yield* fs.copyFile(readme, path.join(stageDir, "README.md"));
  }

  const packageDir = path.join(input.outputDir, CODEITLAB_CLI_PACKAGE_NAME);
  const tarball = path.join(input.outputDir, `${CODEITLAB_CLI_PACKAGE_NAME}.tgz`);
  yield* fs.remove(tarball, { force: true });
  const platform = yield* HostProcess.Platform;
  const tar = platform === "win32" ? windowsSystemTar() : "tar";
  // macOS bsdtar turns xattrs (e.g. com.apple.provenance) into AppleDouble `._*`
  // members, which would ship inside the published tarball.
  const tarArgs = ["-czf", tarball, "-C", scratch, "package"];
  if (platform === "darwin") tarArgs.unshift("--no-xattrs");
  const child = yield* spawner.spawn(
    ChildProcess.make(tar, tarArgs, {
      stdout: "inherit",
      stderr: "inherit",
      env: { COPYFILE_DISABLE: "1" },
    }),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new NpmLauncherCommandFailedError({ command: `tar (${tarball})`, exitCode });
  }
  yield* fs.remove(packageDir, { recursive: true, force: true });
  yield* fs.rename(stageDir, packageDir);
  yield* Effect.log(`[npm-launcher] Wrote ${packageDir} and ${tarball}`);
  return { packageDir, tarball };
}, Effect.scoped);

export const buildNpmLauncher = Effect.fn("buildNpmLauncher")(function* (input: {
  readonly version: string;
  readonly outputDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const sourceDir = yield* path.fromFileUrl(new URL("./npm-launcher/", import.meta.url));

  yield* fs.makeDirectory(input.outputDir, { recursive: true });
  const scratch = yield* fs.makeTempDirectoryScoped({
    directory: input.outputDir,
    prefix: ".launcher-",
  });
  const stageDir = path.join(scratch, "package");
  yield* fs.makeDirectory(path.join(stageDir, "bin"), { recursive: true });
  yield* fs.makeDirectory(path.join(stageDir, "dist"));
  yield* fs.writeFileString(
    path.join(stageDir, "package.json"),
    `${yield* encodePackageJson(npmLauncherPackageManifest(input.version))}\n`,
  );
  yield* fs.copyFile(path.join(sourceDir, "t3.mjs"), path.join(stageDir, "bin/t3.mjs"));
  yield* fs.chmod(path.join(stageDir, "bin/t3.mjs"), 0o755);
  yield* fs.copyFile(path.join(sourceDir, "bin.mjs"), path.join(stageDir, "dist/bin.mjs"));
  const readme = yield* path.fromFileUrl(new URL("../apps/server/README.md", import.meta.url));
  if (yield* fs.exists(readme)) {
    yield* fs.copyFile(readme, path.join(stageDir, "README.md"));
  }

  const packageDir = path.join(input.outputDir, NPM_LAUNCHER_PACKAGE_NAME);
  const tarball = path.join(input.outputDir, `${NPM_LAUNCHER_PACKAGE_NAME}.tgz`);
  yield* fs.remove(tarball, { force: true });
  const tar = (yield* HostProcess.Platform) === "win32" ? windowsSystemTar() : "tar";
  // npm tarballs root everything under `package/`.
  const child = yield* spawner.spawn(
    ChildProcess.make(tar, ["-czf", tarball, "-C", scratch, "package"], {
      stdout: "inherit",
      stderr: "inherit",
    }),
  );
  const exitCode = Number(yield* child.exitCode);
  if (exitCode !== 0) {
    return yield* new NpmLauncherCommandFailedError({ command: `tar (${tarball})`, exitCode });
  }
  yield* fs.remove(packageDir, { recursive: true, force: true });
  yield* fs.rename(stageDir, packageDir);
  yield* Effect.log(`[npm-launcher] Wrote ${packageDir} and ${tarball}`);
  return { packageDir, tarball };
}, Effect.scoped);

const codeitlabCommand = Command.make(
  "build-codeitlab-cli-package",
  {
    version: Flag.String("version").pipe(
      Flag.withDescription("Exact release version the launcher reports and downloads."),
    ),
    outputDir: Flag.String("output-dir").pipe(Flag.withDefault("npm-packages")),
  },
  buildCodeitlabCliPackage,
).pipe(Command.withDescription("Build the codeitlab npm package behind npx codeitlab."));

const command = Command.make(
  "build-npm-launcher",
  {
    version: Flag.String("version").pipe(
      Flag.withDescription("Exact release version; the launcher downloads this version's archive."),
    ),
    outputDir: Flag.String("output-dir").pipe(Flag.withDefault("npm-packages")),
  },
  buildNpmLauncher,
).pipe(Command.withDescription("Build the t3 npm launcher package."));

if (import.meta.main) {
  // `node scripts/build-npm-launcher.ts [build-codeitlab-cli-package] --version ...`
  const wantsCodeitlab = process.argv[2] === "build-codeitlab-cli-package";
  if (wantsCodeitlab) process.argv.splice(2, 1);
  Command.run(wantsCodeitlab ? codeitlabCommand : command, { version: "0.0.0" }).pipe(
    Effect.provide(Layer.mergeAll(Logger.layer([Logger.consolePretty()]), NodeServices.layer)),
    NodeRuntime.runMain,
  );
}
