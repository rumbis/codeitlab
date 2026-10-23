import { assert, describe, it } from "vite-plus/test";

import {
  renderStudioHtml,
  STUDIO_THEME_PALETTES,
  studioAspectRatio,
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
