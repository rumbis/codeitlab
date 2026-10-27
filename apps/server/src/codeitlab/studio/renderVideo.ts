// @effect-diagnostics nodeBuiltinImport:off globalTimers:off -- The renderer owns a real ffmpeg process and a hard deadline; wrapping the spawn in an Effect service would add no safety at this seam.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  renderStudioSlideHtml,
  studioRenderPlan,
  type StudioProject,
} from "@codeitlab/core/studio";

/**
 * Video from code.
 *
 * A Studio project is a list of slides plus a theme and an aspect ratio. This
 * module turns that document into an MP4 without any timeline editor: each slide
 * is rendered by the same stylesheet as the interactive deck, screenshotted by a
 * headless Chromium, and assembled by ffmpeg at the deterministic frame rate
 * from `studioRenderPlan`. The code is the source of truth, so re-rendering the
 * same project tomorrow produces the same frames.
 */

// Playwright resolves its browser from files beside the package, and a Node
// single-executable can only `import` built-ins; createRequire reads the real
// filesystem in the dev server and in `dist-exe/codeitlab` alike.
const requirePlaywright = NodeModule.createRequire(import.meta.url);
const loadPlaywright = (): typeof import("playwright-core") =>
  requirePlaywright("playwright-core") as typeof import("playwright-core");

export interface StudioVideoOptions {
  readonly fps?: number;
  readonly secondsPerSlide?: number;
  /** Override the browser binary; defaults to the one playwright resolves. */
  readonly chromePath?: string;
  /** Override the ffmpeg binary; defaults to `ffmpeg` on PATH. */
  readonly ffmpegPath?: string;
  /** Keep the rendered PNG frames in this directory (otherwise a temp dir). */
  readonly workDir?: string;
  readonly timeoutMs?: number;
}

export interface StudioVideoResult {
  readonly outputPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly durationSeconds: number;
  readonly totalFrames: number;
  readonly slideCount: number;
  readonly framesDirectory: string;
}

function runFfmpeg(binary: string, args: ReadonlyArray<string>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(binary, args, { stdio: ["ignore", "ignore", "pipe"] });
    const stderr: string[] = [];
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr.push(chunk.toString("utf8"));
      if (stderr.length > 200) stderr.shift();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`ffmpeg timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(
        new Error(
          `Could not run "${binary}": ${error.message}. Install ffmpeg or set CODEITLAB_STUDIO_FFMPEG.`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`ffmpeg exited with ${code}: ${stderr.join("").trim().slice(-800)}`));
    });
  });
}

const quoteConcatPath = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

/**
 * A slide is static, escaped HTML with no script and no assets, so the render
 * browser gets the narrowest surface we can give it: JavaScript off, and every
 * network request pointed at a closed local port (loopback included, because
 * Chromium otherwise bypasses the proxy for it). A project therefore cannot
 * fetch remote assets, phone home, or probe the local network while it renders.
 */
export function studioBrowserLaunchOptions(chromePath?: string): {
  headless: true;
  proxy: { server: string; bypass: string };
  args: string[];
  executablePath?: string;
} {
  return {
    headless: true,
    proxy: { server: "http://127.0.0.1:9", bypass: "<-loopback>" },
    args: ["--proxy-bypass-list=<-loopback>", "--disable-features=WebRtcHideLocalIpsWithMdns"],
    ...(chromePath === undefined ? {} : { executablePath: chromePath }),
  };
}

/**
 * Render `project` to `outputPath` (an .mp4 path). Returns the plan that was
 * used so the caller can show duration and frame count without probing the file.
 */
export async function renderStudioVideo(
  project: StudioProject,
  outputPath: string,
  options: StudioVideoOptions = {},
): Promise<StudioVideoResult> {
  if (project.slides.length === 0) {
    throw new Error("Cannot render a Studio project with no slides.");
  }
  const plan = studioRenderPlan(project, {
    ...(options.fps === undefined ? {} : { fps: options.fps }),
    ...(options.secondsPerSlide === undefined ? {} : { secondsPerSlide: options.secondsPerSlide }),
  });
  const timeoutMs = options.timeoutMs ?? 120_000;
  const workDir =
    options.workDir ?? (await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "codeitlab-studio-")));
  const ownsWorkDir = options.workDir === undefined;

  try {
    await NodeFSP.mkdir(workDir, { recursive: true });
    await NodeFSP.mkdir(NodePath.dirname(outputPath), { recursive: true });

    const frames: string[] = [];
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch(studioBrowserLaunchOptions(options.chromePath));
    try {
      const page = await browser.newPage({
        viewport: { width: plan.width, height: plan.height },
        deviceScaleFactor: 1,
        javaScriptEnabled: false,
      });
      for (let index = 0; index < project.slides.length; index += 1) {
        await page.setContent(renderStudioSlideHtml(project, index), { waitUntil: "load" });
        const framePath = NodePath.join(workDir, `slide-${String(index).padStart(3, "0")}.png`);
        await page.screenshot({ path: framePath, type: "png" });
        frames.push(framePath);
      }
    } finally {
      await browser.close();
    }

    // The concat demuxer wants the final file listed twice: once with its
    // duration and once as the closing entry, otherwise the last slide is cut.
    const last = frames[frames.length - 1];
    if (last === undefined) throw new Error("No frames were captured.");
    const lines = frames.flatMap((frame) => [
      `file ${quoteConcatPath(frame)}`,
      `duration ${plan.secondsPerSlide}`,
    ]);
    lines.push(`file ${quoteConcatPath(last)}`);
    const listPath = NodePath.join(workDir, "frames.txt");
    await NodeFSP.writeFile(listPath, `${lines.join("\n")}\n`, "utf8");

    await runFfmpeg(
      options.ffmpegPath ?? process.env.CODEITLAB_STUDIO_FFMPEG ?? "ffmpeg",
      [
        "-hide_banner",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-vf",
        `fps=${plan.fps},format=yuv420p`,
        // The concat demuxer's closing frame can pick up an extra second; the
        // plan owns the duration, so trim to it exactly.
        "-t",
        String(plan.durationSeconds),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      timeoutMs,
    );

    return {
      outputPath,
      width: plan.width,
      height: plan.height,
      fps: plan.fps,
      durationSeconds: plan.durationSeconds,
      totalFrames: plan.totalFrames,
      slideCount: project.slides.length,
      framesDirectory: workDir,
    };
  } finally {
    if (ownsWorkDir) {
      await NodeFSP.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
