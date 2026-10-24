import { describe, expect, it } from "vite-plus/test";

import {
  SETTINGS_SEARCH_ITEMS,
  SETTINGS_SECTION_LABELS,
} from "../components/settings/settingsSearch";
import { CODEITLAB_SECTIONS } from "./panel";
import { CODEITLAB_SECTION_ICONS } from "./sectionNav";

/**
 * The panel registry is the single list every surface reads: the settings tabs,
 * the sidebar icons and the search index. This test fails when a new section is
 * added without one of those, which is how a page silently becomes unreachable.
 */
describe("CodeItLab panel registry", () => {
  it("gives every section a unique label, path and icon", () => {
    const labels = CODEITLAB_SECTIONS.map((section) => section.label);
    const paths = CODEITLAB_SECTIONS.map((section) => section.to);
    expect(new Set(labels).size).toBe(labels.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const section of CODEITLAB_SECTIONS) {
      expect(section.label.trim()).not.toBe("");
      expect(CODEITLAB_SECTION_ICONS[section.id]).toBeDefined();
    }
  });

  it("labels and indexes every section for search", () => {
    for (const section of CODEITLAB_SECTIONS) {
      expect(SETTINGS_SECTION_LABELS[section.to]).toBeDefined();
      const indexed = SETTINGS_SEARCH_ITEMS.some((item) => item.to === section.to);
      expect(indexed, `${section.to} is missing from the settings search index`).toBe(true);
    }
  });
});
