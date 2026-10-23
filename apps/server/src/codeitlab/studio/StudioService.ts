import { CodeitlabServiceError } from "@codeitlab/core";
import { renderStudioHtml, StudioProject } from "@codeitlab/core/studio";
import type { StudioProjectInput } from "@codeitlab/core/services";
import { StudioService as StudioServiceTag } from "@codeitlab/core/services";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { writeFileStringAtomically } from "@t3tools/shared/atomicWrite";

import * as ServerConfig from "../../config.ts";

/**
 * Studio projects on disk.
 *
 * One JSON file per project keeps the store diffable and means a corrupt
 * project can never take the whole list down: undecodable files are skipped and
 * reported as a warning. Exports are plain HTML files written next to the
 * projects so a user can open or hand off a deck without the app running.
 */

const decodeProject = Schema.decodeUnknownOption(Schema.fromJsonString(StudioProject));
const encodeProject = Schema.encodeSync(Schema.fromJsonString(StudioProject));

const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Project ids become file names, so anything else is folded into `-`. */
export const studioProjectId = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const folded = trimmed.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (folded.length === 0) return undefined;
  return folded.slice(0, 64);
};

const serviceError = (operation: string, message: string, cause?: unknown) =>
  new CodeitlabServiceError({
    operation,
    message,
    ...(cause === undefined ? {} : { cause }),
  });

export const make = Effect.fn("codeitlab.studio.service.make")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;

  const studioDirectory = path.join(config.stateDir, "codeitlab", "studio");
  const projectsDirectory = path.join(studioDirectory, "projects");
  const exportsDirectory = path.join(studioDirectory, "exports");

  const writeAtomic = (filePath: string, contents: string) =>
    writeFileStringAtomically({ filePath, contents }).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
    );

  const projectPath = (id: string) => path.join(projectsDirectory, `${id}.json`);

  // `list` is a property on the service, so the span-named function is invoked
  // once here to get a lazy effect; the body still runs per call.
  const list: StudioServiceTag["Service"]["list"] = Effect.fn("codeitlab.studio.list")(
    function* () {
      yield* fs
        .makeDirectory(projectsDirectory, { recursive: true })
        .pipe(Effect.catch(() => Effect.void));
      const entries = yield* fs.readDirectory(projectsDirectory).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.succeed([] as ReadonlyArray<string>),
        ),
        Effect.mapError((cause) =>
          serviceError("studio.list", "Could not read the Studio projects directory.", cause),
        ),
      );
      const projects: StudioProject[] = [];
      for (const entry of entries) {
        if (!entry.endsWith(".json")) continue;
        const text = yield* fs
          .readFileString(path.join(projectsDirectory, entry))
          .pipe(Effect.catch(() => Effect.succeed("")));
        if (text.trim().length === 0) continue;
        const decoded = decodeProject(text);
        if (Option.isNone(decoded)) {
          yield* Effect.logWarning("Skipping an undecodable Studio project.", { entry });
          continue;
        }
        projects.push(decoded.value);
      }
      return projects.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    },
  )();

  const save: StudioServiceTag["Service"]["save"] = Effect.fn("codeitlab.studio.save")(function* (
    input: StudioProjectInput,
  ) {
    const requestedId = input.id === undefined ? undefined : studioProjectId(input.id);
    const id =
      requestedId ??
      (yield* crypto
        .randomUUIDv7()
        .pipe(
          Effect.mapError((cause) =>
            serviceError("studio.save", "Could not mint a project id.", cause),
          ),
        ));
    const existing = yield* fs.readFileString(projectPath(id)).pipe(
      Effect.map((text) => decodeProject(text)),
      Effect.catch(() => Effect.succeed(Option.none<StudioProject>())),
    );
    const now = DateTime.formatIso(DateTime.nowUnsafe());
    const createdAt = Option.isSome(existing) ? existing.value.createdAt : now;
    const project: StudioProject = {
      id,
      name: input.name.trim().length === 0 ? "Untitled" : input.name.trim(),
      kind: input.kind,
      theme: input.theme,
      aspect: input.aspect,
      createdAt,
      updatedAt: now,
      slides: input.slides,
    };
    yield* fs
      .makeDirectory(projectsDirectory, { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          serviceError("studio.save", "Could not create the Studio projects directory.", cause),
        ),
      );
    yield* writeAtomic(projectPath(id), `${encodeProject(project)}\n`).pipe(
      Effect.mapError((cause) =>
        serviceError("studio.save", "Could not write the Studio project.", cause),
      ),
    );
    return project;
  });

  const remove: StudioServiceTag["Service"]["remove"] = Effect.fn("codeitlab.studio.remove")(
    function* (rawId: string) {
      const id = studioProjectId(rawId);
      if (id === undefined || !PROJECT_ID_PATTERN.test(id)) return false;
      const existed = yield* fs.readFileString(projectPath(id)).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
      yield* fs.remove(projectPath(id)).pipe(
        Effect.catchIf(
          (error) => error.reason._tag === "NotFound",
          () => Effect.void,
        ),
        Effect.mapError((cause) =>
          serviceError("studio.remove", "Could not delete the Studio project.", cause),
        ),
      );
      return existed;
    },
  );

  const exportHtml: StudioServiceTag["Service"]["exportHtml"] = Effect.fn(
    "codeitlab.studio.export",
  )(function* (rawId: string) {
    const id = studioProjectId(rawId);
    if (id === undefined) {
      return yield* Effect.fail(serviceError("studio.export", "Invalid Studio project id."));
    }
    const text = yield* fs.readFileString(projectPath(id)).pipe(
      Effect.catchIf(
        (error) => error.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
      Effect.mapError((cause) =>
        serviceError("studio.export", "Could not read the Studio project.", cause),
      ),
    );
    const decoded = text.length === 0 ? Option.none<StudioProject>() : decodeProject(text);
    if (Option.isNone(decoded)) {
      return yield* Effect.fail(
        serviceError("studio.export", "That Studio project does not exist or cannot be read."),
      );
    }
    const html = renderStudioHtml(decoded.value);
    const exportPath = path.join(exportsDirectory, `${id}.html`);
    yield* fs
      .makeDirectory(exportsDirectory, { recursive: true })
      .pipe(
        Effect.mapError((cause) =>
          serviceError("studio.export", "Could not create the Studio exports directory.", cause),
        ),
      );
    yield* writeAtomic(exportPath, html).pipe(
      Effect.mapError((cause) =>
        serviceError("studio.export", "Could not write the Studio export.", cause),
      ),
    );
    return { path: exportPath, html };
  });

  return StudioServiceTag.of({ list, save, remove, exportHtml });
});

export const layer = Layer.effect(StudioServiceTag, make());
