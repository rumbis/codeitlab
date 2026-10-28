// @effect-diagnostics globalFetchInEffect:off - the probe targets an arbitrary user-added gateway, not a provider client; the raw fetch call is where the 8s timeout signal is applied.
import { CodeItLabServiceError } from "@codeitlab/core";
import type {
  CodeItLabModelEndpointProbeInput,
  CodeItLabModelEndpointProbeResult,
} from "@codeitlab/core/modelEndpoints";
import {
  modelEndpointUrl,
  normalizeModelEndpointBaseUrl,
  parseModelEndpointModelIds,
} from "@codeitlab/core/models";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

/**
 * One server-side discovery call for a custom OpenAI-compatible endpoint.
 *
 * The browser cannot make this request: the bearer token lives in the server's
 * environment, and a cross-origin call from the page would be stopped by CORS
 * before the endpoint ever saw it. Raw `fetch` is used instead of a provider
 * client because this talks to an arbitrary gateway, not to a harness.
 */

const PROBE_TIMEOUT_MS = 8_000;

const serviceError = (message: string, cause?: unknown) =>
  new CodeItLabServiceError({
    operation: "models.probeEndpoint",
    message,
    ...(cause === undefined ? {} : { cause }),
  });

/** A fetch rejection's message can quote the request URL, so only the shape of the failure is shown. */
const NETWORK_ERROR_CODE = /^[A-Z][A-Z0-9_]*$/;

const describeFetchFailure = (cause: unknown): string => {
  if (!(cause instanceof Error)) return "unknown error";
  if (cause.name === "TimeoutError") {
    return `no response within ${PROBE_TIMEOUT_MS / 1000} seconds`;
  }
  const inner = cause.cause;
  if (
    inner instanceof Error &&
    "code" in inner &&
    typeof inner.code === "string" &&
    NETWORK_ERROR_CODE.test(inner.code)
  ) {
    return `${cause.name} (${inner.code})`;
  }
  return cause.name;
};

export const probeModelEndpoint = Effect.fn("ModelEndpointProbe.probe")(function* (
  input: CodeItLabModelEndpointProbeInput,
): Effect.fn.Return<CodeItLabModelEndpointProbeResult, CodeItLabServiceError> {
  // The client sends the base URL as typed, so the server re-validates it
  // rather than trusting that the settings page already did.
  const validation = normalizeModelEndpointBaseUrl(input.baseUrl);
  if (!validation.ok) {
    return yield* serviceError(validation.reason);
  }
  const baseUrl = validation.baseUrl;
  const checkedAt = DateTime.formatIso(DateTime.nowUnsafe());

  const apiKeyEnv = input.apiKeyEnv.trim();
  const apiKey = apiKeyEnv === "" ? "" : (process.env[apiKeyEnv] ?? "").trim();
  // A named-but-unset variable is not a failed endpoint: the server never
  // asks, so the page can say "set this variable" instead of reporting a
  // network error.
  if (apiKeyEnv !== "" && apiKey === "") {
    return {
      checkedAt,
      baseUrl,
      reachable: false,
      missingKey: true,
      models: [],
    } satisfies CodeItLabModelEndpointProbeResult;
  }

  const url = modelEndpointUrl(baseUrl, "models");
  if (url === null) {
    // normalizeModelEndpointBaseUrl already accepted the URL; this keeps the
    // invariant explicit instead of fetching the string "null".
    return yield* serviceError("The endpoint URL could not be built.");
  }

  const startedAt = DateTime.toEpochMillis(DateTime.nowUnsafe());
  const fetched = yield* Effect.tryPromise({
    try: (signal) =>
      fetch(url, {
        headers: apiKey === "" ? {} : { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]),
      }),
    // The failure is turned into a result below, so the service error only
    // carries the already-sanitized text out of the promise boundary.
    catch: (cause) => serviceError(describeFetchFailure(cause)),
  }).pipe(Effect.result);
  if (fetched._tag === "Failure") {
    return {
      checkedAt,
      baseUrl,
      reachable: false,
      latencyMs: DateTime.toEpochMillis(DateTime.nowUnsafe()) - startedAt,
      models: [],
      error: fetched.failure.message,
    } satisfies CodeItLabModelEndpointProbeResult;
  }

  const response = fetched.success;
  // An error envelope is not a model list; parsing it would put the endpoint's
  // error text into the picker as model ids.
  const body = response.ok
    ? yield* Effect.promise(() =>
        response.text().then(
          (text) => text,
          () => "",
        ),
      )
    : "";
  return {
    checkedAt,
    baseUrl,
    reachable: true,
    status: response.status,
    latencyMs: DateTime.toEpochMillis(DateTime.nowUnsafe()) - startedAt,
    models: parseModelEndpointModelIds(body),
  } satisfies CodeItLabModelEndpointProbeResult;
});
