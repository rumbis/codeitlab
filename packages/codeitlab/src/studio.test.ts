import { assert, describe, it } from "vite-plus/test";

import {
  renderStudioHtml,
  renderStudioSlideHtml,
  STUDIO_THEME_PALETTES,
  studioAspectRatio,
  studioRenderPlan,
  studioStarterSlides,
  type StudioProject,
} from "./studio.ts";

const project = (overrides: Partial<StudioProject> = {}): StudioProject => ({
  id: "deck-1",
  name: "Quarterly <Review>",
  kind: "deck",
  theme: "matrix",
  aspect: "16:9",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  slides: studioStarterSlides("deck"),
  ...overrides,
});

describe("studio renderer", () => {
  it("renders one section per slide and marks the first one active", () => {
    const html = renderStudioHtml(project());
    const sections = html.match(/<section class="slide/g) ?? [];
    assert.strictEqual(sections.length, 4);
    assert.match(html, /<section class="slide layout-title" data-index="0"[^>]*>/);
    assert.include(html, 'data-studio-theme="matrix"');
    assert.include(html, 'data-studio-kind="deck"');
  });

  it("escapes every user-controlled string", () => {
    const html = renderStudioHtml(
      project({
        name: '"><script>alert(1)</script>',
        slides: [
          {
            id: "s1",
            layout: "title",
            title: "<img src=x onerror=alert(1)>",
            body: "body & <b>markup</b>",
          },
        ],
      }),
    );
    assert.notInclude(html, "<script>alert(1)</script>");
    assert.notInclude(html, "<img src=x");
    assert.include(html, "&lt;img src=x onerror=alert(1)&gt;");
    assert.include(html, "body &amp; &lt;b&gt;markup&lt;/b&gt;");
  });

  it("turns dash lines into bullets and keeps plain lines as plain items", () => {
    const html = renderStudioHtml(
      project({
        slides: [{ id: "s1", layout: "bullets", title: "List", body: "- one\n- two\nthree" }],
      }),
    );
    assert.include(html, "<li>one</li>");
    assert.include(html, "<li>two</li>");
    assert.include(html, '<li class="plain">three</li>');
  });

  it("renders a blockquote for quote layouts", () => {
    const html = renderStudioHtml(
      project({ slides: [{ id: "s1", layout: "quote", title: "Q", body: "Say this." }] }),
    );
    assert.include(html, "<blockquote>Say this.</blockquote>");
  });

  it("applies the theme palette and the aspect ratio", () => {
    const html = renderStudioHtml(project({ theme: "aurora", aspect: "9:16" }));
    assert.include(html, STUDIO_THEME_PALETTES.aurora.accent);
    assert.include(html, "--ratio: 9 / 16;");
    assert.strictEqual(studioAspectRatio("1:1"), "1 / 1");
  });

  it("is deterministic for the same project", () => {
    const first = renderStudioHtml(project());
    const second = renderStudioHtml(project());
    assert.strictEqual(first, second);
  });

  it("keeps speaker notes in the markup but out of the slide body", () => {
    const html = renderStudioHtml(
      project({
        slides: [{ id: "s1", layout: "title", title: "T", body: "B", notes: "Remember this" }],
      }),
    );
    assert.include(html, '<aside class="notes">Remember this</aside>');
  });

  it("seeds different starters for decks and videos", () => {
    const deck = studioStarterSlides("deck").map((slide) => slide.id);
    const video = studioStarterSlides("video").map((slide) => slide.id);
    assert.strictEqual(deck.length, 4);
    assert.strictEqual(video.length, 4);
    assert.notDeepEqual(deck, video);
  });
});

describe("studio render plan", () => {
  it("is deterministic and sized from the aspect ratio", () => {
    const plan = studioRenderPlan(project(), { fps: 30, secondsPerSlide: 3 });
    assert.deepStrictEqual(plan, studioRenderPlan(project(), { fps: 30, secondsPerSlide: 3 }));
    assert.strictEqual(plan.width, 1920);
    assert.strictEqual(plan.height, 1080);
    assert.strictEqual(plan.fps, 30);
    assert.strictEqual(plan.slides.length, 4);
    assert.strictEqual(plan.slides[0]?.frames, 90);
    assert.strictEqual(plan.totalFrames, 360);
    assert.strictEqual(plan.durationSeconds, 12);

    const vertical = studioRenderPlan(project({ aspect: "9:16" }));
    assert.strictEqual(vertical.width, 1080);
    assert.strictEqual(vertical.height, 1920);

    const square = studioRenderPlan(project({ aspect: "1:1" }));
    assert.strictEqual(square.width, 1080);
    assert.strictEqual(square.height, 1080);
  });

  it("clamps hostile frame rates and slide durations", () => {
    const plan = studioRenderPlan(project(), { fps: 1000, secondsPerSlide: 0.01 });
    assert.strictEqual(plan.fps, 60);
    assert.ok(plan.secondsPerSlide >= 0.25);
    assert.ok(plan.totalFrames >= plan.slides.length);

    const fallback = studioRenderPlan(project(), { fps: Number.NaN, secondsPerSlide: Number.NaN });
    assert.strictEqual(fallback.fps, 30);
    assert.strictEqual(fallback.secondsPerSlide, 3);
  });
});

describe("single-slide renderer", () => {
  it("renders exactly one active slide with the shared stylesheet", () => {
    const html = renderStudioSlideHtml(project(), 1);
    assert.include(html, 'class="slide active layout-');
    assert.include(html, 'data-studio-slide="1"');
    assert.include(html, STUDIO_THEME_PALETTES.matrix.background);
    assert.notInclude(html, "<script");
    assert.strictEqual(html, renderStudioSlideHtml(project(), 1));
  });

  it("escapes user content and rejects a missing slide", () => {
    const html = renderStudioSlideHtml(
      project({
        slides: [{ id: "s1", layout: "title", title: "<script>alert(1)</script>", body: "&" }],
      }),
      0,
    );
    assert.notInclude(html, "<script>alert(1)</script>");
    assert.include(html, "&lt;script&gt;alert(1)&lt;/script&gt;");
    assert.throws(() => renderStudioSlideHtml(project(), 99), /no slide at index 99/);
  });
});
