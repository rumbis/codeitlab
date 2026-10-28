import { useEffect } from "react";

import type { AppRouter } from "../../router";
import { setCodeItLabAudioVisible, unlockCodeItLabAudio } from "../../codeitlab/audio";
import { useCodeItLabEffectsAdoption } from "../../codeitlab/effectsSettings";

/**
 * App-wide CodeItLab wiring that has no visible chrome:
 * - adopts the environment's Effects block into the local copy on connect,
 * - unlocks WebAudio on the first user gesture (autoplay policy),
 * - stops the ambient hum while the tab is hidden,
 * - owns the global CodeItLab shortcut.
 *
 * Mounted once from AppRoot so it also covers the settings and usage routes.
 */
export function CodeItLabGlobalLayer({ router }: { readonly router: AppRouter }) {
  useCodeItLabEffectsAdoption();

  useEffect(() => {
    const unlock = () => unlockCodeItLabAudio();
    window.addEventListener("pointerdown", unlock, { capture: true, once: true });
    window.addEventListener("keydown", unlock, { capture: true, once: true });
    const onVisibilityChange = () => setCodeItLabAudioVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        (event.key === "k" || event.key === "K")
      ) {
        event.preventDefault();
        void router.navigate({ to: "/settings/codeitlab" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [router]);

  return null;
}
