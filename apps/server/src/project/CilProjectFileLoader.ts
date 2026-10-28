import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { PROJECT_FILE_NAMES, type CilProjectFile } from "@codeitlab/contracts";
import { CilProjectFileFromJson } from "@codeitlab/shared/cilProjectFile";

const decodeCilProjectFileJson = Schema.decodeEffect(CilProjectFileFromJson);

export class CilProjectFileLoadError extends Schema.TaggedError<CilProjectFileLoadError>()(
  "CilProjectFileLoadError",
  {
    operation: Schema.Literals(["read", "decode"]),
    workspaceRoot: Schema.String,
    filePath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} ${this.filePath}.`;
  }
}

export class CilProjectFileLoader extends Context.Service<
  CilProjectFileLoader,
  {
    /**
     * Never fails: missing, unreadable, or invalid files resolve to `Option.none` (invalid files
     * are logged as warnings).
     */
    readonly load: (workspaceRoot: string) => Effect.Effect<Option.Option<CilProjectFile>>;
  }
>()("codeitlab/project/CilProjectFileLoader") {}

const logCilProjectFileLoadError = (error: CilProjectFileLoadError) =>
  Effect.logWarning(error).pipe(
    Effect.annotateLogs({
      operation: error.operation,
      workspaceRoot: error.workspaceRoot,
      filePath: error.filePath,
      errorTag: error._tag,
    }),
  );

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const load: CilProjectFileLoader["Service"]["load"] = Effect.fn("CilProjectFileLoader.load")(
    function* (workspaceRoot) {
      const filePath = path.join(workspaceRoot, PROJECT_FILE_NAMES[0]);
      const raw = yield* fileSystem.readFileString(filePath).pipe(
        Effect.asSome,
        Effect.catchTags({
          PlatformError: (error) =>
            error.reason._tag === "NotFound"
              ? Effect.succeed(Option.none<string>())
              : logCilProjectFileLoadError(
                  new CilProjectFileLoadError({
                    operation: "read",
                    workspaceRoot,
                    filePath,
                    cause: error,
                  }),
                ).pipe(Effect.as(Option.none<string>())),
        }),
      );
      if (Option.isNone(raw)) {
        return Option.none<CilProjectFile>();
      }
      return yield* decodeCilProjectFileJson(raw.value).pipe(
        Effect.asSome,
        Effect.catchTags({
          SchemaError: (error) =>
            logCilProjectFileLoadError(
              new CilProjectFileLoadError({
                operation: "decode",
                workspaceRoot,
                filePath,
                cause: error,
              }),
            ).pipe(Effect.as(Option.none<CilProjectFile>())),
        }),
      );
    },
  );

  return CilProjectFileLoader.of({ load });
});

export const layer = Layer.effect(CilProjectFileLoader, make);
