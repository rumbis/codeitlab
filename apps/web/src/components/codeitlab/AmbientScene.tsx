import { useEffect, useRef } from "react";

import { cn } from "~/lib/utils";
import type { AmbientQuality, AmbientVariant } from "../../codeitlab/ambientScene";
import { loadAmbientSceneModule } from "../../codeitlab/ambientSceneLoader";

export type { AmbientQuality, AmbientVariant };

const MOBILE_QUERY = "(max-width: 767px)";

/**
 * Mounts the ambient three.js scene on a canvas inside the caller's positioned
 * container. three.js is dynamically imported by `mountAmbientScene`, so this
 * module is cheap to import from ordinary routes.
 *
 * Phones and `quality === "off"` render nothing at all: no canvas, no context,
 * no render loop.
 */
export function AmbientScene({
  variant = "orb",
  quality = "medium",
  maxFps = 30,
  respectReducedMotion = true,
  className,
}: {
  readonly variant?: AmbientVariant;
  readonly quality?: "off" | AmbientQuality;
  readonly maxFps?: number;
  readonly respectReducedMotion?: boolean;
  readonly className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const enabled = quality !== "off";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!enabled || canvas === null) return;
    if (typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches) return;
    const accent =
      getComputedStyle(canvas).getPropertyValue("--codeitlab-green").trim() || "#3dff9e";
    const secondary =
      getComputedStyle(canvas).getPropertyValue("--codeitlab-cyan").trim() || "#22d3ee";
    let disposed = false;
    let disposeScene: (() => void) | null = null;
    void loadAmbientSceneModule()
      .then(({ mountAmbientScene }) =>
        mountAmbientScene(canvas, {
          variant,
          quality,
          maxFps,
          respectReducedMotion,
          colors: { accent, secondary },
        }),
      )
      .then((dispose) => {
        if (disposed) dispose();
        else disposeScene = dispose;
      })
      .catch(() => {
        // WebGL unavailable (blocked, software renderer, or lost context):
        // the hero degrades to its static gradient.
      });
    return () => {
      disposed = true;
      disposeScene?.();
      disposeScene = null;
    };
  }, [enabled, variant, quality, maxFps, respectReducedMotion]);

  if (!enabled) return null;
  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 size-full opacity-60 max-md:hidden",
        className,
      )}
      data-codeitlab-ambient={variant}
    />
  );
}

/**
 * Full-bleed ambient backdrop for empty states. Sits behind the Empty content
 * and fades into the page background, so it never competes with copy.
 */
export function CodeitlabAmbientBackdrop({
  variant = "rain",
  quality = "medium",
}: {
  readonly variant?: AmbientVariant;
  readonly quality?: "off" | AmbientQuality;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 codeitlab-grid opacity-40" />
      <div className="absolute inset-0 codeitlab-scanlines opacity-30" />
      <AmbientScene variant={variant} quality={quality} className="opacity-35" />
      <div className="absolute inset-0 bg-linear-to-b from-transparent via-background/40 to-background" />
    </div>
  );
}
