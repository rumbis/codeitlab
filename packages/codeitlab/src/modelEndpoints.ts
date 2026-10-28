import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Wire contract for probing a custom OpenAI-compatible endpoint.
 *
 * The Models page cannot discover what a gateway serves from the browser: the
 * bearer token lives in the server's environment, and a browser request would
 * hit CORS before it hit the endpoint. So discovery is one server call that
 * answers "is this reachable, and which model ids does it advertise", and the
 * page only renders the answer.
 *
 * The key itself never crosses this contract in either direction: the request
 * names an environment variable, the response carries model ids.
 */

const TrimmedDefault = (value: string) =>
  Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const CodeItLabModelEndpointProbeInput = Schema.Struct({
  /** Base URL as typed; the server re-validates it rather than trusting the client. */
  baseUrl: Schema.String,
  /** Environment variable holding the bearer token; empty means the endpoint needs no key. */
  apiKeyEnv: TrimmedDefault(""),
});
export type CodeItLabModelEndpointProbeInput = typeof CodeItLabModelEndpointProbeInput.Type;

export const CodeItLabModelEndpointProbeResult = Schema.Struct({
  checkedAt: Schema.String,
  /** Canonical base URL the probe actually used. */
  baseUrl: Schema.String,
  reachable: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  /** HTTP status, when a response arrived at all. */
  status: Schema.optional(Schema.Number),
  latencyMs: Schema.optional(Schema.Number),
  models: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  /**
   * Why the probe failed, with credentials and query strings already removed.
   * The page prints this; it must never contain the token.
   */
  error: Schema.optional(Schema.String),
  /** Set when `apiKeyEnv` names a variable the server does not define. */
  missingKey: Schema.optional(Schema.Boolean),
});
export type CodeItLabModelEndpointProbeResult = typeof CodeItLabModelEndpointProbeResult.Type;

/**
 * One sentence for the row: what happened, without inventing a cause. A probe
 * that could not reach the endpoint is not the same failure as one that reached
 * it and was refused, and the user's next action differs.
 */
export function summarizeModelEndpointProbe(result: CodeItLabModelEndpointProbeResult): string {
  if (result.missingKey === true) {
    return `The key variable is not set on this machine, so the endpoint was not asked.`;
  }
  if (!result.reachable) {
    return result.error === undefined || result.error.trim() === ""
      ? "Could not reach the endpoint."
      : `Could not reach the endpoint: ${result.error}`;
  }
  const count = result.models.length;
  if (result.status !== undefined && result.status >= 400) {
    return `The endpoint answered ${result.status} and listed no models.`;
  }
  if (count === 0) {
    return "Reached the endpoint, but it listed no models.";
  }
  return `Reached the endpoint: ${count} ${count === 1 ? "model" : "models"} listed.`;
}
