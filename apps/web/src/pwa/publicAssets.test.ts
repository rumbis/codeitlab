// @effect-diagnostics nodeBuiltinImport:off - validates the real files shipped in public/.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeVM from "node:vm";

import { describe, expect, it } from "vite-plus/test";

const publicDir = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../public",
);

interface ManifestIcon {
  readonly src: string;
  readonly sizes: string;
  readonly type: string;
  readonly purpose?: string;
}

interface Manifest {
  readonly id: string;
  readonly name: string;
  readonly short_name: string;
  readonly start_url: string;
  readonly scope: string;
  readonly display: string;
  readonly orientation: string;
  readonly background_color: string;
  readonly theme_color: string;
  readonly categories: ReadonlyArray<string>;
  readonly icons: ReadonlyArray<ManifestIcon>;
}

function readPublicFile(name: string): string {
  return NodeFS.readFileSync(NodePath.join(publicDir, name), "utf8");
}

function readManifest(): Manifest {
  return JSON.parse(readPublicFile("manifest.webmanifest")) as Manifest;
}

function pngDimensions(file: string): { readonly width: number; readonly height: number } {
  const buffer = NodeFS.readFileSync(file);
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${file} is not a PNG`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe("service worker file", () => {
  it("is standalone JavaScript that compiles", () => {
    const source = readPublicFile("sw.js");
    expect(() => new NodeVM.Script(source, { filename: "sw.js" })).not.toThrow();
    expect(source).not.toMatch(/^\s*(?:import|export)\s/m);
  });

  it("owns the offline shell and cache lifecycle", () => {
    const source = readPublicFile("sw.js");
    expect(source).toContain("/offline.html");
    expect(source).toContain("skipWaiting");
    expect(source).toContain("clients.claim");
    expect(source).toContain("caches.delete");
  });
});

describe("web app manifest", () => {
  it("is installable as a standalone portrait app", () => {
    const manifest = readManifest();
    expect(manifest.id).toBe("/");
    expect(manifest.name).toBe("CodeItLab");
    expect(manifest.short_name).toBe("CodeItLab");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
    expect(manifest.background_color).toBe("#05080a");
    expect(manifest.theme_color).toBe("#05080a");
    expect(manifest.categories).toEqual(["developer", "productivity"]);
  });

  it("declares the required icon sizes including a maskable one", () => {
    const icons = readManifest().icons;
    expect(icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(
      icons.some((icon) => icon.sizes === "512x512" && icon.purpose?.includes("maskable")),
    ).toBe(true);
    expect(icons.some((icon) => icon.sizes === "180x180")).toBe(true);
  });

  it("points every icon at a file that exists in public/", () => {
    for (const icon of readManifest().icons) {
      expect(icon.src.startsWith("/"), icon.src).toBe(true);
      const file = NodePath.join(publicDir, icon.src);
      expect(NodeFS.existsSync(file), `missing manifest icon: ${icon.src}`).toBe(true);
    }
  });

  it("declares the real pixel dimensions of every icon", () => {
    for (const icon of readManifest().icons) {
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngDimensions(NodePath.join(publicDir, icon.src)), icon.src).toEqual({
        width,
        height,
      });
    }
  });
});

describe("offline page", () => {
  it("is a self-contained HTML page with a reload link", () => {
    const html = readPublicFile("offline.html");
    expect(html).toContain('href="/"');
    expect(html).toContain("offline");
    expect(html).not.toContain("<script");
  });
});
