import { it } from "@effect/vitest";
import { CodeitlabServiceError, DEFAULT_CODEITLAB_SETTINGS } from "@codeitlab/core";
import type { CodeitlabIntegrationsSettings } from "@codeitlab/core/integrations";
import { describe, expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { makeIntegrationsService } from "./IntegrationsService.ts";

interface ProbeCall {
  readonly url: string;
}

interface HarnessOptions {
  readonly settings?: CodeitlabIntegrationsSettings;
  readonly reachable?: ReadonlyArray<string>;
  /** Queued engine responses: status + raw JSON text, consumed in order. */
  readonly http?: ReadonlyArray<{ readonly status: number; readonly text: string }>;
}

interface Harness {
  readonly stateDir: string;
  readonly calls: Array<ProbeCall>;
  readonly httpCalls: Array<{
    readonly method: string;
    readonly url: string;
    readonly body?: unknown;
  }>;
  readonly settings: () => CodeitlabIntegrationsSettings;
  readonly make: (options?: HarnessOptions) => ReturnType<typeof makeIntegrationsService>;
}

const withHarness = <A, E>(body: (input: Harness) => Effect.Effect<A, E, FileSystem.FileSystem>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectory({ prefix: "codeitlab-integrations-" });
    let current: CodeitlabIntegrationsSettings = DEFAULT_CODEITLAB_SETTINGS.integrations;
    const calls: Array<ProbeCall> = [];
    const httpCalls: Array<{
      readonly method: string;
      readonly url: string;
      readonly body?: unknown;
    }> = [];

    const make = (options?: HarnessOptions): ReturnType<typeof makeIntegrationsService> => {
      if (options?.settings !== undefined) current = options.settings;
      const reachable = options?.reachable ?? [];
      const queued = [...(options?.http ?? [])];
      return makeIntegrationsService({
        stateDir,
        fs,
        path,
        readSettings: Effect.sync(() => current),
        writeSettings: (next): Effect.Effect<void, CodeitlabServiceError> =>
          Effect.sync(() => {
            current = next;
          }),
        probe: (url) =>
          Effect.sync(() => {
            calls.push({ url });
            return reachable.some((candidate) => url.startsWith(candidate))
              ? { reachable: true, latencyMs: 3, detail: "Answered with HTTP 200." }
              : { reachable: false, detail: "Connection refused." };
          }),
        httpJson: (input) =>
          Effect.sync(() => {
            httpCalls.push({
              method: input.method,
              url: input.url,
              ...(input.body === undefined ? {} : { body: input.body }),
            });
            const next = queued.shift();
            if (next === undefined) {
              throw new Error(`No queued HTTP response for ${input.method} ${input.url}`);
            }
            return next;
          }),
      });
    };

    return yield* body({ stateDir, calls, httpCalls, settings: () => current, make });
  }).pipe(Effect.provide(NodeServices.layer));

const exists = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(filePath);
  });

const readText = (filePath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.readFileString(filePath);
  });

describe("IntegrationsService", () => {
  it.effect("reports a reachable engine as ready and registers its MCP endpoint", () =>
    withHarness(({ stateDir, calls, make }) =>
      Effect.gen(function* () {
        const service = make({ reachable: ["http://127.0.0.1:8000/health"] });
        const list = yield* service.list;
        const shorts = list.integrations.find((entry) => entry.id === "shorts");
        expect(shorts?.state).toBe("ready");
        expect(shorts?.reachable).toBe(true);
        expect(shorts?.baseUrl).toBe("http://127.0.0.1:8000");
        expect(shorts?.detail).toContain("no authentication");
        expect(shorts?.wired).toEqual(["mcp · openshorts"]);
        expect(
          calls.filter((call) => call.url.includes(":8000/health")).map((call) => call.url),
        ).toEqual(["http://127.0.0.1:8000/health"]);
        expect(list.wired.mcpServers).toEqual(["openshorts"]);
        const registration = yield* readText(`${stateDir}/codeitlab/mcp/integrations.json`);
        expect(registration).toContain('"url":"http://127.0.0.1:8000/mcp"');
        expect(registration).toContain('"transport":"http"');
      }),
    ),
  );

  it.effect("does not register an engine it cannot reach", () =>
    withHarness(({ stateDir, make }) =>
      Effect.gen(function* () {
        const service = make({ reachable: [] });
        const list = yield* service.list;
        const shorts = list.integrations.find((entry) => entry.id === "shorts");
        expect(shorts?.state).toBe("unreachable");
        expect(shorts?.reachable).toBe(false);
        expect(shorts?.wired).toEqual([]);
        const install = shorts?.actions.find((entry) => entry.id === "install");
        expect(install?.kind).toBe("copy");
        expect(install?.value).toContain("docker compose up");
        expect(list.wired.mcpServers).toEqual([]);
        expect(yield* exists(`${stateDir}/codeitlab/mcp/integrations.json`)).toBe(false);
      }),
    ),
  );

  it.effect("wires the Search skill by default and removes it when disabled", () =>
    withHarness(({ stateDir, make }) =>
      Effect.gen(function* () {
        const service = make({ reachable: [] });
        const first = yield* service.list;
        const search = first.integrations.find((entry) => entry.id === "search");
        expect(search?.state).toBe("ready");
        expect(search?.wired).toEqual(["skill · search"]);
        expect(first.wired.skills).toContain("search");
        const skillPath = `${stateDir}/codeitlab/skills/search/SKILL.md`;
        const body = yield* readText(skillPath);
        expect(body).toContain("modsearch");
        expect(body).toContain("5.10.10");

        const next = yield* service.set({ id: "search", enabled: false });
        expect(next.wired.skills).not.toContain("search");
        expect(yield* exists(skillPath)).toBe(false);
      }),
    ),
  );

  it.effect("probes Rakazo's API port when the web port has no health route", () =>
    withHarness(({ calls, make }) =>
      Effect.gen(function* () {
        const service = make({ reachable: ["http://127.0.0.1:3100/health"] });
        const list = yield* service.list;
        const crew = list.integrations.find((entry) => entry.id === "crew");
        expect(crew?.state).toBe("ready");
        expect(crew?.baseUrl).toBe("http://127.0.0.1:5173");
        expect(crew?.wired).toEqual(["skill · crew"]);
        expect(
          calls
            .filter((call) => call.url.includes("/health") && !call.url.includes(":8000"))
            .map((call) => call.url),
        ).toEqual(["http://127.0.0.1:5173/health", "http://127.0.0.1:3100/health"]);
      }),
    ),
  );

  it.effect("persists a base URL change and reflects it in the next status", () =>
    withHarness(({ settings, make }) =>
      Effect.gen(function* () {
        const service = make({ reachable: ["http://10.0.0.5:8000/health"] });
        yield* service.list;
        const updated = yield* service.set({ id: "shorts", baseUrl: "http://10.0.0.5:8000" });
        const shorts = updated.integrations.find((entry) => entry.id === "shorts");
        expect(shorts?.state).toBe("ready");
        expect(shorts?.baseUrl).toBe("http://10.0.0.5:8000");
        expect(settings().shorts.baseUrl).toBe("http://10.0.0.5:8000");
      }),
    ),
  );

  it.effect("reports disabled integrations without probing them", () =>
    withHarness(({ calls, make }) =>
      Effect.gen(function* () {
        const service = make({
          settings: {
            ...DEFAULT_CODEITLAB_SETTINGS.integrations,
            shorts: { enabled: false },
            crew: { enabled: false },
          },
          reachable: [],
        });
        const list = yield* service.list;
        const shorts = list.integrations.find((entry) => entry.id === "shorts");
        expect(shorts?.state).toBe("disabled");
        expect(calls).toEqual([]);
        expect(list.wired.mcpServers).toEqual([]);
      }),
    ),
  );

  it.effect("submits a Shorts job only with a rights confirmation", () =>
    withHarness(({ httpCalls, make }) =>
      Effect.gen(function* () {
        const service = make({ reachable: ["http://127.0.0.1:8000/health"] });
        const failure = yield* Effect.flip(
          service.createShortsJob({ url: "https://example.com/video.mp4", acknowledged: false }),
        );
        expect(failure.message).toContain("confirm you own the content");
        expect(httpCalls).toEqual([]);
      }),
    ),
  );

  it.effect("posts a normalised job body and returns the engine job id", () =>
    withHarness(({ httpCalls, make }) =>
      Effect.gen(function* () {
        const service = make({
          reachable: ["http://127.0.0.1:8000/health"],
          http: [{ status: 200, text: JSON.stringify({ job_id: "job-1", status: "queued" }) }],
        });
        const created = yield* service.createShortsJob({
          url: "  https://example.com/video.mp4  ",
          acknowledged: true,
          targetClips: 99,
        });
        expect(created).toEqual({ jobId: "job-1", state: "queued" });
        expect(httpCalls).toEqual([
          {
            method: "POST",
            url: "http://127.0.0.1:8000/api/process",
            body: {
              url: "https://example.com/video.mp4",
              acknowledged: true,
              target_clips: 12,
              output_format: "vertical",
            },
          },
        ]);
      }),
    ),
  );

  it.effect("surfaces the engine's rejection detail", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const service = make({
          reachable: ["http://127.0.0.1:8000/health"],
          http: [
            {
              status: 400,
              text: JSON.stringify({ detail: "You must confirm you own the content" }),
            },
          ],
        });
        const failure = yield* Effect.flip(
          service.createShortsJob({ url: "https://example.com/v.mp4", acknowledged: true }),
        );
        expect(failure.message).toContain("HTTP 400");
        expect(failure.message).toContain("confirm you own the content");
      }),
    ),
  );

  it.effect("normalises a completed job's clips, logs and queue position", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const service = make({
          reachable: ["http://127.0.0.1:8000/health"],
          http: [
            {
              status: 200,
              text: JSON.stringify({
                status: "completed",
                logs: ["Job queued.", "Rendering clip 1."],
                queue: { position: 0 },
                result: {
                  clips: [
                    {
                      title: "Hook one",
                      start: 12.5,
                      end: 41,
                      video_url: "/videos/job-9/clip_1.mp4",
                      video_title_for_youtube_short: "YouTube title",
                      video_description_for_tiktok: "TikTok copy",
                    },
                  ],
                },
              }),
            },
          ],
        });
        const job = yield* service.shortsJobStatus("job-9");
        expect(job.state).toBe("completed");
        expect(job.engineStatus).toBe("completed");
        expect(job.queuePosition).toBe(0);
        expect(job.logs).toEqual(["Job queued.", "Rendering clip 1."]);
        expect(job.clips).toEqual([
          {
            title: "Hook one",
            startSeconds: 12.5,
            endSeconds: 41,
            videoUrl: "http://127.0.0.1:8000/videos/job-9/clip_1.mp4",
            youtubeTitle: "YouTube title",
            tiktokDescription: "TikTok copy",
          },
        ]);
      }),
    ),
  );

  it.effect("maps an unknown engine status instead of pretending it finished", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const service = make({
          reachable: ["http://127.0.0.1:8000/health"],
          http: [{ status: 200, text: JSON.stringify({ status: "banana" }) }],
        });
        const job = yield* service.shortsJobStatus("job-2");
        expect(job.state).toBe("unknown");
        expect(job.engineStatus).toBe("banana");
        expect(job.clips).toEqual([]);
      }),
    ),
  );

  it.effect("refuses a job when Shorts is disabled", () =>
    withHarness(({ make }) =>
      Effect.gen(function* () {
        const service = make({
          settings: {
            ...DEFAULT_CODEITLAB_SETTINGS.integrations,
            shorts: { enabled: false },
          },
        });
        const failure = yield* Effect.flip(
          service.createShortsJob({ url: "https://example.com/v.mp4", acknowledged: true }),
        );
        expect(failure.message).toContain("Shorts is disabled");
      }),
    ),
  );
});
