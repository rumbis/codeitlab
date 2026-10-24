// @effect-diagnostics nodeBuiltinImport:off -- the render test probes the real ffmpeg/Chromium toolchain.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { StudioService } from "@codeitlab/core/services";
import { studioStarterSlides } from "@codeitlab/core/studio";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { chromium } from "playwright-core";
import { describe, expect } from "vite-plus/test";

import { ServerConfig } from "../../config.ts";
import { layer, studioProjectId } from "./StudioService.ts";

const configLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "studio-service-test-",
}).pipe(Layer.provide(NodeServices.layer));

const testLayer = layer.pipe(Layer.provideMerge(Layer.mergeAll(configLayer, NodeServices.layer)));

const deck = (id?: string) => ({
  ...(id === undefined ? {} : { id }),
  name: "Launch deck",
  kind: "deck" as const,
  theme: "matrix" as const,
  aspect: "16:9" as const,
  slides: studioStarterSlides("deck"),
});

describe("StudioService layer", () => {
  it.effect("saves a project, lists it, and round-trips the slides", () =>
    Effect.gen(function* () {
      const service = yield* StudioService;
      const saved = yield* service.save(deck());
      expect(saved.id.length).toBeGreaterThan(0);
      expect(saved.createdAt).toBe(saved.updatedAt);
      expect(saved.slides.length).toBe(4);

      const projects = yield* service.list;
      expect(projects.map((project) => project.id)).toContain(saved.id);

      const updated = yield* service.save({
        ...deck(saved.id),
        name: "Launch deck v2",
        slides: saved.slides.slice(0, 2),
      });
      expect(updated.id).toBe(saved.id);
      expect(updated.createdAt).toBe(saved.createdAt);
      expect(updated.name).toBe("Launch deck v2");
      expect(updated.slides.length).toBe(2);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("writes a self-contained HTML export next to the projects", () =>
    Effect.gen(function* () {
      const service = yield* StudioService;
      const saved = yield* service.save(deck());
      const exported = yield* service.exportHtml(saved.id);
      expect(exported.path.endsWith(`${saved.id}.html`)).toBe(true);
      expect(exported.html).toContain("<!doctype html>");
      expect(exported.html).toContain(saved.name);

      const fs = yield* FileSystem.FileSystem;
      const onDisk = yield* fs.readFileString(exported.path);
      expect(onDisk).toBe(exported.html);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("removes a project and reports whether it existed", () =>
    Effect.gen(function* () {
      const service = yield* StudioService;
      const saved = yield* service.save(deck());
      expect(yield* service.remove(saved.id)).toBe(true);
      expect(yield* service.remove(saved.id)).toBe(false);
      const projects = yield* service.list;
      expect(projects.map((project) => project.id)).not.toContain(saved.id);
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("fails export for an unknown project instead of writing an empty file", () =>
    Effect.gen(function* () {
      const service = yield* StudioService;
      const failure = yield* Effect.flip(service.exportHtml("missing-project"));
      expect(failure.operation).toBe("studio.export");
    }).pipe(Effect.provide(testLayer)),
  );

  it.effect("skips an undecodable project file and keeps the rest of the list", () =>
    Effect.gen(function* () {
      const service = yield* StudioService;
      const config = yield* ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const saved = yield* service.save(deck());
      const projectsDir = path.join(config.stateDir, "codeitlab", "studio", "projects");
      yield* fs.writeFileString(path.join(projectsDir, "broken.json"), "{not json");

      const projects = yield* service.list;
      expect(projects.map((project) => project.id)).toContain(saved.id);
      expect(projects.some((project) => project.id === "broken")).toBe(false);
    }).pipe(Effect.provide(testLayer)),
  );

  it("folds hostile project ids into safe file names", () => {
    expect(studioProjectId("../../etc/passwd")).toBe("etc-passwd");
    expect(studioProjectId("  ")).toBeUndefined();
    expect(studioProjectId("deck/1")).toBe("deck-1");
  });
});

const canRenderVideo = (() => {
  const ffmpeg =
    NodeChildProcess.spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
  let browser = false;
  try {
    browser = NodeFS.existsSync(chromium.executablePath());
  } catch {
    browser = false;
  }
  return ffmpeg && browser;
})();

describe.skipIf(!canRenderVideo)("StudioService render", () => {
  it.effect("renders a project to an mp4 in the exports directory", () =>
    Effect.gen(function* () {
      const studio = yield* StudioService;
      const saved = yield* studio.save(deck("render-me"));
      const result = yield* studio.render({
        id: saved.id,
        fps: 10,
        secondsPerSlide: 1,
      });
      expect(result.slideCount).toBe(saved.slides.length);
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      expect(result.durationSeconds).toBeGreaterThan(0);
      const stat = NodeFS.statSync(result.path);
      expect(stat.size).toBeGreaterThan(1_000);
      expect(result.path.endsWith(".mp4")).toBe(true);
    }).pipe(Effect.provide(testLayer)),
  );
});
