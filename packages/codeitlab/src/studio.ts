import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Studio: a local-first deck and video-scene builder.
 *
 * The shape is intentionally small — a project is a name, a theme, an aspect
 * ratio and an ordered list of slides. Everything else (the player, the
 * export) is derived from that document, so a project stays diffable and a
 * broken editor can never corrupt the render path.
 *
 * The HTML renderer is pure and deterministic: same project in, same bytes
 * out. It is the single source of truth for previews and exports, which is why
 * it lives in the shared package instead of the server.
 */

const BooleanDefault = (value: boolean) =>
  Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(value)));

export const StudioKind = Schema.Literals(["deck", "video"]);
export type StudioKind = typeof StudioKind.Type;

export const StudioAspect = Schema.Literals(["16:9", "9:16", "1:1"]);
export type StudioAspect = typeof StudioAspect.Type;

export const StudioTheme = Schema.Literals(["matrix", "noir", "aurora"]);
export type StudioTheme = typeof StudioTheme.Type;

export const StudioLayout = Schema.Literals(["title", "bullets", "quote", "two-col", "visual"]);
export type StudioLayout = typeof StudioLayout.Type;

export const StudioSlide = Schema.Struct({
  id: Schema.String,
  layout: StudioLayout.pipe(Schema.withDecodingDefault(Effect.succeed("title" as const))),
  title: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  /** Free text. Lines starting with "- " render as bullets. */
  body: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  notes: Schema.optional(Schema.String),
});
export type StudioSlide = typeof StudioSlide.Type;

export const StudioProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: StudioKind,
  theme: StudioTheme.pipe(Schema.withDecodingDefault(Effect.succeed("matrix" as const))),
  aspect: StudioAspect.pipe(Schema.withDecodingDefault(Effect.succeed("16:9" as const))),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  slides: Schema.Array(StudioSlide),
});
export type StudioProject = typeof StudioProject.Type;

/** What a client sends to create or update a project. */
export const StudioProjectInput = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.String,
  kind: StudioKind,
  theme: StudioTheme.pipe(Schema.withDecodingDefault(Effect.succeed("matrix" as const))),
  aspect: StudioAspect.pipe(Schema.withDecodingDefault(Effect.succeed("16:9" as const))),
  slides: Schema.Array(StudioSlide),
});
export type StudioProjectInput = typeof StudioProjectInput.Type;

export const StudioProjectList = Schema.Struct({
  projects: Schema.Array(StudioProject),
});
export type StudioProjectList = typeof StudioProjectList.Type;

export const StudioExportResult = Schema.Struct({
  path: Schema.String,
  html: Schema.String,
});
export type StudioExportResult = typeof StudioExportResult.Type;

export const StudioDeleteResult = Schema.Struct({
  deleted: BooleanDefault(true),
});

/** What a rendered video reports back: where it is and how long it runs. */
export const StudioRenderResult = Schema.Struct({
  path: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  fps: Schema.Number,
  durationSeconds: Schema.Number,
  totalFrames: Schema.Number,
  slideCount: Schema.Number,
});
export type StudioRenderResult = typeof StudioRenderResult.Type;
export type StudioDeleteResult = typeof StudioDeleteResult.Type;

export const CodeitlabStudioSettings = Schema.Struct({
  enabled: BooleanDefault(true),
  defaultTheme: StudioTheme.pipe(Schema.withDecodingDefault(Effect.succeed("matrix" as const))),
  defaultAspect: StudioAspect.pipe(Schema.withDecodingDefault(Effect.succeed("16:9" as const))),
  /** Seed a starter outline when a project is created from the tab. */
  seedStarter: BooleanDefault(true),
});
export type CodeitlabStudioSettings = typeof CodeitlabStudioSettings.Type;

// Themes

export interface StudioThemePalette {
  readonly background: string;
  readonly surface: string;
  readonly text: string;
  readonly muted: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly grid: string;
}

export const STUDIO_THEME_PALETTES: Readonly<Record<StudioTheme, StudioThemePalette>> = {
  // The Matrix-inspired default: phosphor green on near-black, scanline grid.
  matrix: {
    background: "#04070a",
    surface: "rgba(0, 255, 140, 0.06)",
    text: "#d7ffe9",
    muted: "#6f9c86",
    accent: "#00ff8c",
    accentSoft: "rgba(0, 255, 140, 0.18)",
    grid: "rgba(0, 255, 140, 0.08)",
  },
  noir: {
    background: "#0b0b0d",
    surface: "rgba(255, 255, 255, 0.05)",
    text: "#f4f4f5",
    muted: "#9b9ba3",
    accent: "#f5f5f5",
    accentSoft: "rgba(255, 255, 255, 0.14)",
    grid: "rgba(255, 255, 255, 0.05)",
  },
  aurora: {
    background: "#070a14",
    surface: "rgba(120, 180, 255, 0.08)",
    text: "#eaf2ff",
    muted: "#8ea4c8",
    accent: "#7cc4ff",
    accentSoft: "rgba(124, 196, 255, 0.2)",
    grid: "rgba(124, 196, 255, 0.07)",
  },
};

export const studioAspectRatio = (aspect: StudioAspect): string =>
  aspect === "16:9" ? "16 / 9" : aspect === "9:16" ? "9 / 16" : "1 / 1";

// Starters

/**
 * A four-slide starter outline. Ids are stable per project so an editor can
 * treat the seed as an ordinary document (reorder, delete, rename).
 */
export const studioStarterSlides = (kind: StudioKind): ReadonlyArray<StudioSlide> => {
  if (kind === "video") {
    return [
      {
        id: "scene-open",
        layout: "title",
        title: "Cold open",
        body: "One line that sets the tension. Say it, then cut.",
      },
      {
        id: "scene-context",
        layout: "bullets",
        title: "Why now",
        body: "- The world changed\n- The old way is too slow\n- The new way is cheap",
      },
      {
        id: "scene-demo",
        layout: "visual",
        title: "Demo beat",
        body: "Screen recording, terminal, or a 3D scene goes here.",
      },
      {
        id: "scene-close",
        layout: "quote",
        title: "Close",
        body: "The line you want quoted.",
      },
    ];
  }
  return [
    {
      id: "slide-title",
      layout: "title",
      title: "Untitled deck",
      body: "A subtitle that earns the next slide.",
    },
    {
      id: "slide-problem",
      layout: "bullets",
      title: "The problem",
      body: "- What is broken today\n- Who feels it\n- What it costs",
    },
    {
      id: "slide-idea",
      layout: "two-col",
      title: "The idea",
      body: "Left: the insight.\n\nRight: the mechanism that makes it real.",
    },
    {
      id: "slide-close",
      layout: "quote",
      title: "Close",
      body: "One sentence the room remembers.",
    },
  ];
};

// Renderer

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export const escapeStudioHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);

const renderBody = (body: string, layout: StudioLayout): string => {
  const trimmed = body.trim();
  if (trimmed.length === 0) return "";
  const lines = trimmed.split(/\r?\n/);
  const bullets = lines.filter((line) => line.trimStart().startsWith("- "));
  if (layout === "bullets" || (layout !== "quote" && bullets.length >= 2)) {
    const items = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) =>
        line.startsWith("- ")
          ? `<li>${escapeStudioHtml(line.slice(2))}</li>`
          : `<li class="plain">${escapeStudioHtml(line)}</li>`,
      )
      .join("\n        ");
    return `<ul class="bullets">\n        ${items}\n      </ul>`;
  }
  if (layout === "quote") {
    return `<blockquote>${escapeStudioHtml(trimmed)}</blockquote>`;
  }
  if (layout === "two-col") {
    const [left, right = ""] = trimmed.split(/\n\s*\n/);
    return `<div class="columns"><p>${escapeStudioHtml((left ?? "").trim())}</p><p>${escapeStudioHtml(right.trim())}</p></div>`;
  }
  return `<p>${escapeStudioHtml(trimmed)}</p>`;
};

const renderSlide = (slide: StudioSlide, index: number, total: number): string => {
  const notes =
    slide.notes === undefined || slide.notes.trim().length === 0
      ? ""
      : `<aside class="notes">${escapeStudioHtml(slide.notes.trim())}</aside>`;
  return `    <section class="slide layout-${slide.layout}" data-index="${index}" aria-label="Slide ${index + 1} of ${total}">
      <div class="slide-inner">
        <h2>${escapeStudioHtml(slide.title.trim())}</h2>
        ${renderBody(slide.body, slide.layout)}
      </div>
      ${notes}
    </section>`;
};

/**
 * The shared stylesheet for every Studio artefact: the interactive deck and the
 * single-slide frames the video renderer captures. Keeping one stylesheet is
 * what makes the preview, the export and the video look identical.
 */
const studioCss = (palette: StudioThemePalette, ratio: string): string => `
  :root {
    color-scheme: dark;
    --bg: ${palette.background};
    --surface: ${palette.surface};
    --text: ${palette.text};
    --muted: ${palette.muted};
    --accent: ${palette.accent};
    --accent-soft: ${palette.accentSoft};
    --grid: ${palette.grid};
    --ratio: ${ratio};
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background:
      radial-gradient(120% 90% at 15% 0%, var(--accent-soft), transparent 60%),
      repeating-linear-gradient(0deg, var(--grid) 0 1px, transparent 1px 48px),
      repeating-linear-gradient(90deg, var(--grid) 0 1px, transparent 1px 48px),
      var(--bg);
    color: var(--text);
    font-family: "SF Mono", ui-monospace, "JetBrains Mono", Menlo, monospace;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .stage {
    position: relative;
    width: min(92vw, calc(88vh * (16 / 9)));
    aspect-ratio: var(--ratio);
    perspective: 1600px;
  }
  .slide {
    position: absolute;
    inset: 0;
    padding: clamp(1.4rem, 3.2vw, 3.4rem);
    background: linear-gradient(160deg, var(--surface), transparent 55%);
    border: 1px solid var(--accent-soft);
    border-radius: 14px;
    opacity: 0;
    transform: rotateY(-9deg) translate3d(4%, 0, -120px) scale(0.97);
    transition: opacity 320ms ease, transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
    pointer-events: none;
    display: flex;
    flex-direction: column;
    justify-content: center;
    overflow: hidden;
  }
  .slide.active {
    opacity: 1;
    transform: none;
    pointer-events: auto;
  }
  .slide-inner { max-width: 62ch; }
  h2 {
    margin: 0 0 0.9rem;
    font-size: clamp(1.6rem, 3.4vw, 3rem);
    line-height: 1.08;
    letter-spacing: -0.02em;
    text-shadow: 0 0 24px var(--accent-soft);
  }
  h2::before {
    content: "> ";
    color: var(--accent);
    opacity: 0.85;
  }
  p, li, blockquote { font-size: clamp(0.95rem, 1.55vw, 1.35rem); line-height: 1.6; }
  p { color: var(--text); margin: 0; }
  .bullets { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.55rem; }
  .bullets li { color: var(--text); }
  .bullets li.plain { list-style: none; margin-left: -1.1rem; color: var(--muted); }
  .bullets li::marker { color: var(--accent); }
  blockquote {
    margin: 0;
    padding-left: 1rem;
    border-left: 2px solid var(--accent);
    color: var(--text);
    font-style: italic;
  }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1.6rem; }
  .columns p { color: var(--muted); }
  .layout-visual .slide-inner::after {
    content: "";
    display: block;
    margin-top: 1.2rem;
    height: 8px;
    width: 40%;
    background: linear-gradient(90deg, var(--accent), transparent);
    border-radius: 999px;
  }
  .notes { display: none; }
  .chrome {
    position: fixed;
    inset: auto 0 0 0;
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 1.1rem;
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    background: linear-gradient(0deg, rgba(0, 0, 0, 0.55), transparent);
    transition: opacity 200ms ease;
  }
  .chrome.hidden { opacity: 0; }
  .bar { flex: 1; height: 2px; background: var(--accent-soft); position: relative; }
  .bar > i { position: absolute; inset: 0 auto 0 0; width: 0; background: var(--accent); transition: width 240ms ease; }
  @media (prefers-reduced-motion: reduce) {
    .slide { transition: none; transform: none; }
    .bar > i { transition: none; }
  }
`;

/**
 * Renders a project to one self-contained HTML file.
 *
 * No network, no build step, no fonts to fetch: the deck opens from disk and
 * presents offline. Arrow keys / space / click advance; `Escape` hides the
 * chrome. Animations are transform-only and disabled under
 * `prefers-reduced-motion`.
 */
export const renderStudioHtml = (project: StudioProject): string => {
  const palette = STUDIO_THEME_PALETTES[project.theme];
  const slides = project.slides.map((slide, index) =>
    renderSlide(slide, index, project.slides.length),
  );
  const ratio = studioAspectRatio(project.aspect);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CodeitLab Studio">
<title>${escapeStudioHtml(project.name)}</title>
<style>
${studioCss(palette, ratio)}
</style>
</head>
<body data-studio-project="${escapeStudioHtml(project.id)}" data-studio-kind="${project.kind}" data-studio-theme="${project.theme}">
<main class="stage" role="region" aria-roledescription="carousel" aria-label="${escapeStudioHtml(project.name)}">
${slides.join("\n")}
</main>
<div class="chrome" id="chrome">
  <span id="counter">1 / ${project.slides.length}</span>
  <span class="bar"><i id="progress"></i></span>
  <span>${escapeStudioHtml(project.name)}</span>
</div>
<script>
(() => {
  const slides = Array.from(document.querySelectorAll(".slide"));
  const counter = document.getElementById("counter");
  const progress = document.getElementById("progress");
  const chrome = document.getElementById("chrome");
  let index = 0;
  let chromeTimer = 0;
  if (slides.length === 0) return;
  const paint = () => {
    slides.forEach((slide, i) => slide.classList.toggle("active", i === index));
    if (counter) counter.textContent = (index + 1) + " / " + slides.length;
    if (progress) progress.style.width = ((index + 1) / slides.length * 100).toFixed(1) + "%";
  };
  const go = (next) => {
    index = Math.max(0, Math.min(slides.length - 1, next));
    paint();
  };
  const showChrome = () => {
    chrome?.classList.remove("hidden");
    clearTimeout(chromeTimer);
    chromeTimer = window.setTimeout(() => chrome?.classList.add("hidden"), 2200);
  };
  document.addEventListener("keydown", (event) => {
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      go(index + 1);
      showChrome();
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      go(index - 1);
      showChrome();
    } else if (event.key === "Home") {
      go(0);
      showChrome();
    } else if (event.key === "End") {
      go(slides.length - 1);
      showChrome();
    } else if (event.key === "Escape") {
      chrome?.classList.toggle("hidden");
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest(".chrome")) return;
    go(index + 1);
    showChrome();
  });
  paint();
  showChrome();
})();
</script>
</body>
</html>
`;
};

// Video render plan

export const STUDIO_DEFAULT_FPS = 30;
export const STUDIO_DEFAULT_SECONDS_PER_SLIDE = 3;

export interface StudioRenderPlanSlide {
  readonly index: number;
  readonly durationSeconds: number;
  readonly frames: number;
}

/**
 * The deterministic timeline a renderer follows: every slide lasts the same
 * number of seconds at the requested frame rate. No randomness, no wall clock,
 * so two machines produce the same frame count and the same duration.
 */
export interface StudioRenderPlan {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly secondsPerSlide: number;
  readonly slides: ReadonlyArray<StudioRenderPlanSlide>;
  readonly totalFrames: number;
  readonly durationSeconds: number;
}

export const STUDIO_FRAME_SIZES: Readonly<Record<StudioAspect, { width: number; height: number }>> =
  {
    "16:9": { width: 1920, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
    "1:1": { width: 1080, height: 1080 },
  };

const clampInteger = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback;

const clampSeconds = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;

export const studioRenderPlan = (
  project: StudioProject,
  options: { readonly fps?: number; readonly secondsPerSlide?: number } = {},
): StudioRenderPlan => {
  const fps = clampInteger(options.fps ?? STUDIO_DEFAULT_FPS, 1, 60, STUDIO_DEFAULT_FPS);
  const secondsPerSlide = clampSeconds(
    options.secondsPerSlide ?? STUDIO_DEFAULT_SECONDS_PER_SLIDE,
    0.25,
    60,
    STUDIO_DEFAULT_SECONDS_PER_SLIDE,
  );
  const framesPerSlide = Math.max(1, Math.round(secondsPerSlide * fps));
  const size = STUDIO_FRAME_SIZES[project.aspect];
  const slides = project.slides.map((_, index) => ({
    index,
    durationSeconds: framesPerSlide / fps,
    frames: framesPerSlide,
  }));
  return {
    width: size.width,
    height: size.height,
    fps,
    secondsPerSlide: framesPerSlide / fps,
    slides,
    totalFrames: framesPerSlide * project.slides.length,
    durationSeconds: (framesPerSlide * project.slides.length) / fps,
  };
};

/**
 * One slide, one static page: what the video renderer screenshots per slide.
 * It uses the same stylesheet as the deck, so a frame and the exported deck
 * cannot drift apart.
 */
export const renderStudioSlideHtml = (project: StudioProject, index: number): string => {
  const slide = project.slides[index];
  if (slide === undefined) {
    throw new Error(`Studio project "${project.id}" has no slide at index ${index}.`);
  }
  const palette = STUDIO_THEME_PALETTES[project.theme];
  const ratio = studioAspectRatio(project.aspect);
  // The deck reveals slides through the `.active` class; a single frame must be
  // visible from the first paint, so the captured slide is marked active.
  const slideHtml = renderSlide(slide, index, project.slides.length).replace(
    'class="slide ',
    'class="slide active ',
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="CodeitLab Studio">
<title>${escapeStudioHtml(project.name)} — slide ${index + 1}</title>
<style>
${studioCss(palette, ratio)}
</style>
</head>
<body data-studio-project="${escapeStudioHtml(project.id)}" data-studio-slide="${index}">
<main class="stage" role="region" aria-label="${escapeStudioHtml(project.name)}">
${slideHtml}
</main>
</body>
</html>
`;
};
