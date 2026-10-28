import { wallpaperBackground } from "@codeitlab/core/wallpaper";
import { useEffect } from "react";

import { useCodeItLabSettingsWriter } from "../../codeitlab/effectsSettings";

/**
 * Opt-in artwork behind the chrome. The layer sits behind the app and the
 * sidebar/inset surfaces turn translucent while it is on (see index.css), so
 * text keeps a solid backing instead of sitting on the image.
 */
export function CodeItLabWallpaperLayer() {
  const { codeitlab } = useCodeItLabSettingsWriter();
  const background = wallpaperBackground(codeitlab.wallpaper);
  const active = background !== null;

  useEffect(() => {
    const root = document.documentElement;
    if (active) {
      root.dataset.codeitlabWallpaper = "true";
    } else {
      delete root.dataset.codeitlabWallpaper;
    }
    return () => {
      delete root.dataset.codeitlabWallpaper;
    };
  }, [active]);

  if (background === null) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
      data-codeitlab-wallpaper-layer
      style={{
        backgroundImage: background.backgroundImage,
        opacity: background.opacity / 100,
      }}
    />
  );
}
