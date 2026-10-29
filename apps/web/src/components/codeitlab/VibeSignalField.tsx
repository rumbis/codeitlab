import { cn } from "~/lib/utils";
import type { VibeSignalTone } from "../../codeitlab/vibeSignal";

/**
 * The ambient instrument behind the coding surface.
 *
 * Every CodeItLab screen already reads each other through one vocabulary:
 * phosphor green means settled, cyan means the agent is working. This field
 * makes that vocabulary spatial, so the workspace has an identity that is not
 * borrowed from a dashboard template: a perspective floor of phosphor lines,
 * a horizon that breathes at the speed the agent is actually working, and a
 * soft well where the prompt arrives.
 *
 * Pure CSS gradients plus one slow transform per layer. No canvas, no
 * `requestAnimationFrame`, no per-frame JavaScript: the whole thing is
 * compositor work, so it stays cheap on high-refresh displays.
 * `data-motion="still"` removes every animation.
 *
 * The hook class is applied directly rather than through `cn`, because
 * tailwind-merge treats an unrecognised utility-shaped class as conflicting
 * with the layout utilities beside it and silently drops it.
 */
export function VibeSignalField({
  tone = "idle",
  motion = "live",
  className,
}: {
  /** Reflects what the agent is doing, in the colours used everywhere else. */
  readonly tone?: VibeSignalTone;
  /** "still" for reduced motion and for the off effects setting. */
  readonly motion?: "live" | "still";
  readonly className?: string;
}) {
  return (
    <div
      aria-hidden
      data-slot="vibe-signal-field"
      data-tone={tone}
      data-motion={motion}
      className={[
        "vibe-signal-field",
        cn("pointer-events-none absolute inset-0 overflow-hidden", className),
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="vibe-signal-wall absolute inset-0" data-slot="vibe-wall" />
      <div className="vibe-signal-horizon absolute inset-0" data-slot="vibe-horizon" />
      <div
        className="vibe-signal-floor absolute inset-x-0 bottom-0 h-[46%]"
        data-slot="vibe-floor"
      />
      <div className="vibe-signal-well absolute inset-0" data-slot="vibe-well" />
    </div>
  );
}
