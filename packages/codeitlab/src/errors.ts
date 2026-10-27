import * as Schema from "effect/Schema";

/**
 * One failure shape for every CodeItLab feature service.
 *
 * Services fail with this instead of dying: memory disabled, a rejected
 * credential-shaped note, an unknown memory id, a settings write failure or a
 * REA CLI spawn timeout are all expected outcomes that the RPC transport maps
 * to the wire error without losing the cause.
 */
export class CodeItLabServiceError extends Schema.TaggedError<CodeItLabServiceError>()(
  "CodeItLabServiceError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
