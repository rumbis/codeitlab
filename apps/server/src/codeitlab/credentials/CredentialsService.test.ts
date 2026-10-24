// @effect-diagnostics nodeBuiltinImport:off globalFetchInEffect:off - the test stands up a real loopback upstream and calls the gateway to prove the path end to end.
import * as NodeHttp from "node:http";

import { it } from "@effect/vitest";
import { CodeitlabServiceError, DEFAULT_CODEITLAB_SETTINGS } from "@codeitlab/core";
import type { CodeitlabCredentialsSettings } from "@codeitlab/core/credentials";
import { describe, expect, it as vitestIt } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Path from "effect/Path";

import {
  isGatewayHostAllowed,
  makeCredentialsService,
  type CredentialsServiceHandle,
} from "./CredentialsService.ts";

const SECRET = "sk-proj-AbCdEf0123456789AbCdEf0123456789AbCdEf0123456789";

describe("gateway host check", () => {
  vitestIt("accepts loopback hostnames with or without a port", () => {
    for (const host of [
      "127.0.0.1",
      "127.0.0.1:5284",
      "localhost:5284",
      "LOCALHOST",
      "[::1]",
      "[::1]:5284",
    ]) {
      expect(isGatewayHostAllowed(host)).toBe(true);
    }
  });

  vitestIt("rejects a foreign host, a lookalike and an empty header", () => {
    for (const host of ["rebound.example", "127.0.0.1.evil.test", "0.0.0.0:5284", "", undefined]) {
      expect(isGatewayHostAllowed(host)).toBe(false);
    }
  });
});

interface Harness {
  readonly stateDir: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly settings: () => CodeitlabCredentialsSettings;
  readonly make: (
    overrides?: Partial<CodeitlabCredentialsSettings>,
  ) => Effect.Effect<CredentialsServiceHandle, CodeitlabServiceError>;
}

const withHarness = <A, E>(body: (input: Harness) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectory({ prefix: "codeitlab-credentials-" });
    let current: CodeitlabCredentialsSettings = {
      ...DEFAULT_CODEITLAB_SETTINGS.credentials,
      gatewayPort: 46789,
    };
    const make = (overrides: Partial<CodeitlabCredentialsSettings> = {}) => {
      current = { ...current, ...overrides };
      return makeCredentialsService({
        stateDir,
        fs,
        path,
        readSettings: Effect.sync(() => current),
        writeSettings: (next) =>
          Effect.sync(() => {
            current = next;
          }),
        fetchText: (_url) =>
          Effect.succeed(
            JSON.stringify({
              id: "codeitlab-tiny-credentials",
              version: "9.9.9",
              algorithm: "test",
              buckets: 2,
              ngrams: [3],
              denseFeatures: ["bias"],
              scale: 0.1,
              bias: 0,
              threshold: 0.5,
              weights: [0, 0, 0],
            }),
          ),
      });
    };
    return yield* body({ stateDir, fs, path, settings: () => current, make });
  }).pipe(Effect.provide(NodeServices.layer));

const KEY_JSON = JSON.stringify({
  model: "gpt-5",
  messages: [{ role: "user", content: `my key is ${SECRET}` }],
});

describe("CredentialsService", () => {
  it.effect("masks a preview scan and records value-free audit entries", () =>
    withHarness(({ make, settings }) =>
      Effect.gen(function* () {
        const handle = yield* make();
        const result = yield* handle.service.scan({ text: `key=${SECRET}`, target: "prompt" });
        expect(result.masked).not.toContain(SECRET);
        expect(result.findings.length).toBeGreaterThan(0);
        const status = yield* handle.service.status;
        expect(status.scanned).toBe(1);
        expect(status.maskedValues).toBeGreaterThan(0);
        expect(JSON.stringify(status.audit)).not.toContain(SECRET);
        expect(status.audit[0]?.target).toBe("prompt");
        expect(settings().enabled).toBe(true);
      }),
    ),
  );

  it.effect("restores the original values and keeps them across service restarts", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const first = yield* make();
        const masked = yield* first.service.scan({ text: `key=${SECRET}` });
        yield* first.close;

        const second = yield* make();
        const restored = yield* second.service.restore({ text: masked.masked });
        expect(restored.text).toBe(`key=${SECRET}`);
        expect(restored.restored).toBeGreaterThan(0);
        yield* second.close;
      }),
    ),
  );

  it.effect("blocks a request that contains a /private block when asked to", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const handle = yield* make({ privateTag: "block" });
        const result = yield* handle.service.scan({
          text: "keep this /private between us /private",
        });
        expect(result.blocked).toBe(true);
        expect(result.privateBlocks).toBe(1);
        expect(result.masked).not.toContain("between us");
        yield* handle.close;
      }),
    ),
  );

  it.effect("blocks a model-only finding when blockOnModelFlag is on", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const handle = yield* make({ blockOnModelFlag: true });
        const result = yield* handle.service.scan({
          text: "the password is QwErTyUiOpAsDfGhJkLzXcVbNm",
        });
        expect(result.blocked).toBe(true);
        expect(result.masked).not.toContain("QwErTyUiOpAsDfGhJkLzXcVbNm");
        yield* handle.close;
      }),
    ),
  );

  it.effect("downloads a newer local model and keeps the bundled one on a bad file", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const handle = yield* make();
        const before = yield* handle.service.status;
        expect(before.model.state).toBe("bundled");
        const model = yield* handle.service.downloadModel;
        expect(model.state).toBe("ready");
        expect(model.version).toBe("9.9.9");
        const after = yield* handle.service.status;
        expect(after.model.version).toBe("9.9.9");
        yield* handle.close;
      }),
    ),
  );

  it.effect("reports a failed download without losing the bundled model", () =>
    withHarness(({ make, stateDir, fs, path }) =>
      Effect.gen(function* () {
        const handle = yield* make();
        const failing = yield* makeCredentialsService({
          stateDir,
          fs,
          path,
          readSettings: Effect.succeed({ ...DEFAULT_CODEITLAB_SETTINGS.credentials }),
          writeSettings: () => Effect.void,
          fetchText: () => Effect.succeed("{}"),
        });
        const failure = yield* Effect.flip(failing.service.downloadModel);
        expect(failure.message).toContain("not valid");
        const status = yield* failing.service.status;
        expect(status.model.state).toBe("bundled");
        yield* failing.close;
        yield* handle.close;
      }),
    ),
  );

  it.effect("starts the gateway, masks the outbound body and restores the answer", () =>
    withHarness(({ make, settings }) =>
      Effect.gen(function* () {
        let received = "";
        const upstream = NodeHttp.createServer((request, response) => {
          let body = "";
          request.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          request.on("end", () => {
            received = body;
            const parsed = JSON.parse(body) as { messages: Array<{ content: string }> };
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({ answer: `The key was ${parsed.messages[0]?.content ?? ""}` }),
            );
          });
        });
        const upstreamPort = yield* Effect.callback<number, never>((resume) => {
          upstream.listen(0, "127.0.0.1", () => {
            const address = upstream.address();
            resume(
              Effect.succeed(typeof address === "object" && address !== null ? address.port : 0),
            );
          });
          return Effect.sync(() => upstream.close());
        });

        const handle = yield* make({ enabled: true });
        const started = yield* handle.service.start;
        expect(started.running).toBe(true);

        const port = settings().gatewayPort;
        const response = yield* Effect.tryPromise(() =>
          fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-codeitlab-upstream": `http://127.0.0.1:${upstreamPort}`,
            },
            body: KEY_JSON,
          }),
        );
        expect(response.status).toBe(200);
        const answer = (yield* Effect.tryPromise(() => response.json())) as { answer: string };

        expect(received).not.toContain(SECRET);
        expect(received).toContain("sk-proj-");
        expect(answer.answer).toContain(SECRET);
        yield* handle.close;
      }),
    ),
  );

  it.effect("accepts the upstream encoded in the path, so a base URL is enough", () =>
    withHarness(({ make, settings }) =>
      Effect.gen(function* () {
        let received = "";
        const upstream = NodeHttp.createServer((request, response) => {
          let body = "";
          request.on("data", (chunk: Buffer) => {
            body += chunk.toString("utf8");
          });
          request.on("end", () => {
            received = body;
            const parsed = JSON.parse(body) as { messages: Array<{ content: string }> };
            response.writeHead(200, { "content-type": "application/json" });
            response.end(
              JSON.stringify({ answer: `The key was ${parsed.messages[0]?.content ?? ""}` }),
            );
          });
        });
        const upstreamPort = yield* Effect.callback<number, never>((resume) => {
          upstream.listen(0, "127.0.0.1", () => {
            const address = upstream.address();
            resume(
              Effect.succeed(typeof address === "object" && address !== null ? address.port : 0),
            );
          });
          return Effect.sync(() => upstream.close());
        });

        const handle = yield* make({ enabled: true });
        yield* handle.service.start;
        const port = settings().gatewayPort;
        const encoded = Buffer.from(`http://127.0.0.1:${upstreamPort}`, "utf8").toString(
          "base64url",
        );
        // The shape the settings page hands out: /upstream/<base64url>/<api path>.
        const response = yield* Effect.tryPromise(() =>
          fetch(`http://127.0.0.1:${port}/upstream/${encoded}/v1/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: KEY_JSON,
          }),
        );
        expect(response.status).toBe(200);
        const answer = (yield* Effect.tryPromise(() => response.json())) as { answer: string };

        expect(received).not.toContain(SECRET);
        expect(received).toContain("sk-proj-");
        expect(answer.answer).toContain(SECRET);
        yield* handle.close;
      }),
    ),
  );

  it.effect("rejects a request whose Host is not loopback, so DNS rebinding cannot reach it", () =>
    withHarness(({ make, settings }) =>
      Effect.gen(function* () {
        const handle = yield* make({ enabled: true });
        yield* handle.service.start;
        const port = settings().gatewayPort;
        const status = yield* Effect.tryPromise(
          () =>
            new Promise<number>((resolve, reject) => {
              const request = NodeHttp.request(
                {
                  host: "127.0.0.1",
                  port,
                  path: "/v1/chat/completions",
                  method: "POST",
                  headers: { host: "rebound.example", "content-type": "application/json" },
                },
                (response) => {
                  response.resume();
                  response.on("end", () => resolve(response.statusCode ?? 0));
                },
              );
              request.on("error", reject);
              request.end(KEY_JSON);
            }),
        );
        expect(status).toBe(403);
        yield* handle.close;
      }),
    ),
  );
});
