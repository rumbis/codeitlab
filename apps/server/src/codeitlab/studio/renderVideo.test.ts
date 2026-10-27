// @effect-diagnostics nodeBuiltinImport:off -- ffprobe/ffmpeg probes and file hashes are the point of this test.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { studioStarterSlides, type StudioProject } from "@codeitlab/core/studio";
import { chromium } from "playwright-core";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { renderStudioVideo, studioBrowserLaunchOptions } from "./renderVideo.ts";

const hasBinary = (binary: string): boolean => {
  const result = NodeChildProcess.spawnSync(binary, ["-version"], { stdio: "ignore" });
  return result.status === 0;
};

const hasBrowser = ((): boolean => {
  try {
    return NodeFS.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const canRender = hasBinary("ffmpeg") && hasBinary("ffprobe") && hasBrowser;

const project = (): StudioProject => ({
  id: "video-from-code",
  name: "Video from code",
  kind: "video",
  theme: "matrix",
  aspect: "16:9",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  slides: studioStarterSlides("video").slice(0, 2),
});

interface ProbeResult {
  streams?: Array<{ width?: number; height?: number; duration?: string; nb_frames?: string }>;
  format?: { duration?: string };
}

const probe = (filePath: string): ProbeResult => {
  const result = NodeChildProcess.spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,duration,nb_frames",
      "-show_entries",
      "format=duration",
      "-of",
      "json",
      filePath,
    ],
    { encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout) as ProbeResult;
};

const hashFile = async (filePath: string): Promise<string> => {
  const buffer = await NodeFSP.readFile(filePath);
  return NodeCrypto.createHash("sha256").update(buffer).digest("hex");
};

let workDirs: string[] = [];

afterEach(async () => {
  for (const directory of workDirs) {
    await NodeFSP.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
  workDirs = [];
});

const tempDir = async (): Promise<string> => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "studio-video-test-"));
  workDirs.push(directory);
  return directory;
};

describe.skipIf(!canRender)("renderStudioVideo", () => {
  it("renders an mp4 from the project with the planned size and duration", async () => {
    const directory = await tempDir();
    const outputPath = NodePath.join(directory, "out.mp4");
    const result = await renderStudioVideo(project(), outputPath, {
      fps: 10,
      secondsPerSlide: 1,
      workDir: NodePath.join(directory, "frames"),
    });

    expect(result).toMatchObject({
      width: 1920,
      height: 1080,
      fps: 10,
      slideCount: 2,
      totalFrames: 20,
      durationSeconds: 2,
    });
    const stat = await NodeFSP.stat(outputPath);
    expect(stat.size).toBeGreaterThan(1_000);

    const info = probe(outputPath);
    expect(info.streams?.[0]?.width).toBe(1920);
    expect(info.streams?.[0]?.height).toBe(1080);
    const duration = Number(info.format?.duration ?? info.streams?.[0]?.duration);
    expect(duration).toBeGreaterThan(1.5);
    expect(duration).toBeLessThan(2.6);
  }, 120_000);

  it("captures byte-identical frames when the same project is rendered again", async () => {
    const first = await tempDir();
    const second = await tempDir();
    await renderStudioVideo(project(), NodePath.join(first, "out.mp4"), {
      fps: 10,
      secondsPerSlide: 1,
      workDir: NodePath.join(first, "frames"),
    });
    await renderStudioVideo(project(), NodePath.join(second, "out.mp4"), {
      fps: 10,
      secondsPerSlide: 1,
      workDir: NodePath.join(second, "frames"),
    });

    for (const name of ["slide-000.png", "slide-001.png"]) {
      const left = await hashFile(NodePath.join(first, "frames", name));
      const right = await hashFile(NodePath.join(second, "frames", name));
      expect(left).toBe(right);
    }
  }, 120_000);

  it("reports a missing ffmpeg instead of writing a broken file", async () => {
    const directory = await tempDir();
    await expect(
      renderStudioVideo(project(), NodePath.join(directory, "out.mp4"), {
        fps: 10,
        secondsPerSlide: 1,
        workDir: NodePath.join(directory, "frames"),
        ffmpegPath: "/nonexistent/ffmpeg-binary",
      }),
    ).rejects.toThrow(/Could not run|ffmpeg/);
  }, 120_000);

  it("refuses a project with no slides", async () => {
    const directory = await tempDir();
    await expect(
      renderStudioVideo({ ...project(), slides: [] }, NodePath.join(directory, "out.mp4"), {
        workDir: NodePath.join(directory, "frames"),
      }),
    ).rejects.toThrow(/no slides/);
  });
});

describe("studio render sandbox", () => {
  it.skipIf(!hasBrowser)(
    "renders with JavaScript off and every network request blocked",
    async () => {
      const requests: string[] = [];
      const server = NodeHttp.createServer((incoming, outgoing) => {
        requests.push(incoming.url ?? "");
        outgoing.end("ok");
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("receiver did not bind");

      const browser = await chromium.launch(studioBrowserLaunchOptions());
      try {
        const page = await browser.newPage({ javaScriptEnabled: false });
        await page.setContent(
          `<p>slide</p><img src="http://127.0.0.1:${address.port}/pixel.png"><script>window.__ran = 1</script>`,
          { waitUntil: "domcontentloaded" },
        );
        await new Promise((resolve) => setTimeout(resolve, 500));

        // The proxy sends every request (loopback included) to a closed port.
        expect(requests).toHaveLength(0);
        const ran = await page
          .evaluate(() => (window as unknown as { __ran?: number }).__ran)
          .catch(() => undefined);
        expect(ran).toBeUndefined();
      } finally {
        await browser.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
    60_000,
  );
});

describe.skipIf(canRender)("renderStudioVideo (environment)", () => {
  it("skips when ffmpeg or the headless browser is unavailable", () => {
    expect(canRender).toBe(false);
  });
});
