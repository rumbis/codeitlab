import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * REA (rea.tools) is always installed and always available: an MCP server plus a
 * seeded skill. `autoActivate` means agents reach for it on reverse-engineering
 * and analysis work without the user asking for it by name.
 */

export const ReaHealthCheck = Schema.Struct({
  name: Schema.String,
  ok: Schema.Boolean,
  detail: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  remediation: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ReaHealthCheck = typeof ReaHealthCheck.Type;

export const ReaStatus = Schema.Struct({
  installed: Schema.Boolean,
  version: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  mcpCommand: Schema.String,
  mcpArgs: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Merged MCP server id in the Nexus catalog. */
  mcpServerId: Schema.optional(Schema.String),
  skillInstalled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  skillPath: Schema.optional(Schema.String),
  autoActivate: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  health: Schema.Array(ReaHealthCheck).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  checkedAt: Schema.optional(Schema.String),
});
export type ReaStatus = typeof ReaStatus.Type;

export const ReaCapability = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  /** Side effects the capability can have, disclosed up front. */
  sideEffects: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type ReaCapability = typeof ReaCapability.Type;
