// @effect-diagnostics nodeBuiltinImport:off - the test stands up a real loopback endpoint because the probe makes a real HTTP request.
import * as NodeHttp from "node:http";

import { CodeItLabServiceError } from "@codeitlab/core";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { describe, expect } from "vite-plus/test";

import { probeModelEndpoint } from "./ModelEndpointProbe.ts";

const SECRET = "sk-codeitlab-probe-secret";
const KEY_ENV = "CODEITLAB_TEST_MODELS_PROBE_KEY";

interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | undefined;
}

interface Endpoint {
  readonly server: NodeHttp.Server;
  readonly baseUrl: string;
  readonly requests: Array<RecordedRequest>;
}

type Respond = (request: NodeHttp.IncomingMessage, response: NodeHttp.ServerResponse) => void;

const acquireEndpoint = (respond: Respond): Effect.Effect<Endpoint, never> =>
  Effect.callback<Endpoint, never>((resume) => {
    const requests: Array<RecordedRequest> = [];
    const server = NodeHttp.createServer((request, response) => {
      requests.push({ url: request.url ?? "", authorization: request.headers.authorization });
      respond(request, response);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resume(Effect.succeed({ server, baseUrl: `http://127.0.0.1:${port}/v1`, requests }));
    });
    return Effect.sync(() => {
      server.close();
    });
  });

const closeEndpoint = (endpoint: Endpoint) =>
  Effect.sync(() => {
    endpoint.server.close();
  });

const withEndpoint = <A, E>(
  respond: Respond,
  use: (endpoint: Endpoint) => Effect.Effect<A, E>,
): Effect.Effect<A, E> => Effect.acquireUseRelease(acquireEndpoint(respond), use, closeEndpoint);

/** Sets (or clears, for `undefined`) one variable for the duration of the effect. */
const withEnvVar = <A, E>(
  name: string,
  value: string | undefined,
  effect: Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
      return previous;
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }),
  );

const openAiList = (ids: ReadonlyArray<string>): Respond => {
  return (_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ data: ids.map((id) => ({ id })) }));
  };
};

describe("probeModelEndpoint", () => {
  it.effect("lists the model ids an OpenAI-compatible endpoint advertises", () =>
    withEndpoint(openAiList(["gpt-5", "claude-sonnet-4-5"]), (endpoint) =>
      Effect.gen(function* () {
        const result = yield* probeModelEndpoint({ baseUrl: endpoint.baseUrl, apiKeyEnv: "" });

        expect(result.reachable).toBe(true);
        expect(result.status).toBe(200);
        expect(result.models).toEqual(["gpt-5", "claude-sonnet-4-5"]);
        expect(result.baseUrl).toBe(endpoint.baseUrl);
        expect(result.checkedAt).not.toBe("");
        expect(result.latencyMs).toBeGreaterThanOrEqual(0);
        expect(endpoint.requests).toHaveLength(1);
        expect(endpoint.requests[0]?.url).toBe("/v1/models");
        expect(endpoint.requests[0]?.authorization).toBeUndefined();
      }),
    ),
  );

  it.effect("sends the key named by apiKeyEnv as a bearer token", () =>
    withEnvVar(
      KEY_ENV,
      SECRET,
      withEndpoint(openAiList(["gpt-5"]), (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeModelEndpoint({
            baseUrl: endpoint.baseUrl,
            apiKeyEnv: KEY_ENV,
          });

          expect(result.models).toEqual(["gpt-5"]);
          expect(endpoint.requests[0]?.authorization).toBe(`Bearer ${SECRET}`);
        }),
      ),
    ),
  );

  it.effect("reports a 401 as reachable with status 401 and no models", () =>
    withEndpoint(
      (_request, response) => {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "invalid api key" } }));
      },
      (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeModelEndpoint({ baseUrl: endpoint.baseUrl, apiKeyEnv: "" });

          expect(result.reachable).toBe(true);
          expect(result.status).toBe(401);
          expect(result.models).toEqual([]);
        }),
    ),
  );

  it.effect("short-circuits when the key variable is unset and makes no request", () =>
    withEnvVar(
      KEY_ENV,
      undefined,
      withEndpoint(openAiList(["gpt-5"]), (endpoint) =>
        Effect.gen(function* () {
          const result = yield* probeModelEndpoint({
            baseUrl: endpoint.baseUrl,
            apiKeyEnv: KEY_ENV,
          });

          expect(result.missingKey).toBe(true);
          expect(result.reachable).toBe(false);
          expect(result.models).toEqual([]);
          expect(endpoint.requests).toHaveLength(0);
        }),
      ),
    ),
  );

  it.effect("fails with a service error when the base URL is invalid", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        probeModelEndpoint({ baseUrl: "ftp://api.example.com/v1", apiKeyEnv: "" }),
      );

      expect(error).toBeInstanceOf(CodeItLabServiceError);
      expect(error.operation).toBe("models.probeEndpoint");
      expect(error.message).toContain("http and https");
    }),
  );

  it.effect("reports an unreachable endpoint without exposing the key", () =>
    withEnvVar(
      KEY_ENV,
      SECRET,
      withEndpoint(openAiList(["gpt-5"]), (endpoint) =>
        Effect.gen(function* () {
          // Closing the listener first makes the refusal deterministic; the probe
          // must not need the server to answer to report the failure.
          yield* closeEndpoint(endpoint);
          const result = yield* probeModelEndpoint({
            baseUrl: endpoint.baseUrl,
            apiKeyEnv: KEY_ENV,
          });

          expect(result.reachable).toBe(false);
          expect(result.error).toBeDefined();
          expect(result.error).not.toContain(SECRET);
        }),
      ),
    ),
  );
});
