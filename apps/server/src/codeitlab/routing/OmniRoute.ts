import type { TaskClass } from "@codeitlab/core/routing";
import type { CodeitlabOmniRouteSettings } from "@codeitlab/core/settings";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

/**
 * OmniRoute is an OpenAI-compatible gateway. We only use two things from it: the
 * `auto/*` virtual model names it advertises and the real model list from
 * `GET /v1/models`. Discovery is best-effort — an unreachable gateway must never
 * fail routing, it just removes OmniRoute candidates.
 */

export const OMNIROUTE_VIRTUAL_MODEL_BY_TASK: Record<TaskClass, string> = {
  coding: "auto/best-coding",
  reasoning: "auto/best-reasoning",
  vision: "auto/best-vision",
  fast: "auto/best-fast",
  chat: "auto/best-chat",
  cheap: "auto/cheap",
};

const decodeJsonUnknown = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/** Accepts the OpenAI `{data:[{id}]}` shape and a bare array of ids/objects. */
export const parseOmniRouteModelList = (body: string): ReadonlyArray<string> => {
  const decoded = Option.getOrUndefined(decodeJsonUnknown(body));
  const record = asRecord(decoded);
  const entries = Array.isArray(decoded)
    ? decoded
    : record === undefined
      ? []
      : Array.isArray(record["data"])
        ? (record["data"] as ReadonlyArray<unknown>)
        : Array.isArray(record["models"])
          ? (record["models"] as ReadonlyArray<unknown>)
          : [];
  const ids: string[] = [];
  for (const entry of entries) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      ids.push(entry.trim());
      continue;
    }
    const entryRecord = asRecord(entry);
    const id = entryRecord?.["id"];
    if (typeof id === "string" && id.trim().length > 0) ids.push(id.trim());
  }
  return [...new Set(ids)].sort();
};

export interface OmniRouteDiscovery {
  readonly models: ReadonlyArray<string>;
  readonly error: string | null;
}

const discoverOmniRouteModelsEffect = Effect.fn("OmniRoute.discoverModels")(function* (
  settings: CodeitlabOmniRouteSettings,
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (!settings.enabled) return { models: [], error: null };
  const baseUrl = settings.baseUrl.trim().replace(/\/+$/u, "");
  if (baseUrl.length === 0) {
    return { models: [], error: "OmniRoute base URL is empty." };
  }
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const apiKey = environment[settings.apiKeyEnv];
  const withApiKey =
    apiKey === undefined || apiKey.trim().length === 0
      ? <T>(request: T): T => request
      : HttpClientRequest.bearerToken(apiKey);
  const request = HttpClientRequest.get(`${baseUrl}/v1/models`).pipe(withApiKey);
  const body = yield* http.execute(request).pipe(
    Effect.flatMap((response) => response.text),
    Effect.timeout("5 seconds"),
    Effect.catch((cause) =>
      Effect.logInfo("OmniRoute model discovery failed.", { cause }).pipe(Effect.as(undefined)),
    ),
  );
  if (body === undefined) {
    return {
      models: [],
      error: "OmniRoute is unreachable; using configured virtual models only.",
    };
  }
  const models = parseOmniRouteModelList(body);
  return models.length > 0
    ? { models, error: null }
    : { models: [], error: "OmniRoute returned no models." };
});

export const discoverOmniRouteModels = (
  settings: CodeitlabOmniRouteSettings,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<OmniRouteDiscovery, never, HttpClient.HttpClient> =>
  discoverOmniRouteModelsEffect(settings, environment).pipe(
    Effect.orElseSucceed(() => ({ models: [], error: "OmniRoute discovery failed." })),
  );

/** Virtual models the gateway advertises plus the configured defaults. */
export const omniRouteVirtualModels = (
  settings: CodeitlabOmniRouteSettings,
  discovered: ReadonlyArray<string>,
): ReadonlyArray<string> => [
  ...new Set([
    ...settings.virtualModels,
    ...discovered.filter((model) => model.startsWith("auto/")),
  ]),
];
