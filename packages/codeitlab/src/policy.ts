import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Effective instruction policy for a turn. `standard` keeps the harness defaults;
 * `permissive` is the user-selected uncensored profile. The profile can only
 * change instructions CodeItLab itself adds — an upstream provider's own policy
 * still applies, and the UI must say so.
 */

export const PolicyProfile = Schema.Literals(["standard", "permissive"]);
export type PolicyProfile = typeof PolicyProfile.Type;

export const EffectivePolicy = Schema.Struct({
  profile: PolicyProfile,
  /** Provider instances the profile was applied to this turn. */
  appliedTo: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Provider instances where the profile could not be applied, with a reason. */
  unsupported: Schema.Array(
    Schema.Struct({ providerInstanceId: Schema.String, reason: Schema.String }),
  ).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /** Instruction block appended to the turn, when any. */
  instructionBlock: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** Honest statement of the profile's limits, shown in the panel. */
  limitations: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type EffectivePolicy = typeof EffectivePolicy.Type;

export const PolicyAuditEntry = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  threadId: Schema.optional(Schema.String),
  providerInstanceId: Schema.String,
  profile: PolicyProfile,
});
export type PolicyAuditEntry = typeof PolicyAuditEntry.Type;
