import { ChevronLeftIcon, ChevronRightIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { renderStudioHtml, type StudioProject } from "@codeitlab/core/studio";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { playCodeItLabSfx, unlockCodeItLabAudio } from "../../codeitlab/audio";
import { Button } from "../ui/button";

const PLAY_INTERVAL_MS = 3200;

function dispatchStudioKey(frame: HTMLIFrameElement | null, key: string) {
  frame?.contentDocument?.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
}

/**
 * Full-screen deck player. The shared renderer owns the slide markup and its
 * transform transitions; this component only drives it (arrow keys, autoplay)
 * and adds a pointer-driven tilt that stops the moment the pointer leaves.
 */
export function StudioPlayer({
  project,
  onClose,
}: {
  readonly project: StudioProject;
  readonly onClose: () => void;
}) {
  const [html] = useState(() => renderStudioHtml(project));
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");
  const total = project.slides.length;

  const indexRef = useRef(0);

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(total - 1, next));
    const previous = indexRef.current;
    indexRef.current = clamped;
    setIndex(clamped);
    dispatchStudioKey(iframeRef.current, clamped < previous ? "ArrowLeft" : "ArrowRight");
    playCodeItLabSfx("click");
  };

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const current = indexRef.current;
      if (current >= total - 1) {
        setPlaying(false);
        playCodeItLabSfx("success");
        return;
      }
      indexRef.current = current + 1;
      setIndex(current + 1);
      dispatchStudioKey(iframeRef.current, "ArrowRight");
      playCodeItLabSfx("click");
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, total]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        setPlaying((current) => !current);
        return;
      }
      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") {
        event.preventDefault();
        goTo(indexRef.current + 1);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        goTo(indexRef.current - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, goTo]);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion) return;
    const stage = stageRef.current;
    if (stage === null) return;
    const rect = stage.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    stage.style.setProperty("--studio-tilt-x", `${(y * -6).toFixed(2)}deg`);
    stage.style.setProperty("--studio-tilt-y", `${(x * 8).toFixed(2)}deg`);
  };

  const resetTilt = () => {
    const stage = stageRef.current;
    if (stage === null) return;
    stage.style.setProperty("--studio-tilt-x", "0deg");
    stage.style.setProperty("--studio-tilt-y", "0deg");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/92 p-3 backdrop-blur-sm sm:p-6"
      data-studio-player
      role="dialog"
      aria-modal="true"
      aria-label={`${project.name} player`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="codeitlab-mono-label text-codeitlab-green">STUDIO // PLAY</span>
          <span className="truncate text-sm font-medium text-foreground">{project.name}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close player">
          <XIcon className="size-4" />
          Close
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div
          ref={stageRef}
          className="studio-player-stage h-full w-full"
          onPointerMove={handlePointerMove}
          onPointerLeave={resetTilt}
        >
          <iframe
            ref={iframeRef}
            title={`${project.name} preview`}
            srcDoc={html}
            sandbox="allow-scripts"
            className="studio-player-frame size-full rounded-xl border border-codeitlab-green/25 bg-black"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => goTo(index - 1)}
          aria-label="Previous slide"
        >
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            unlockCodeItLabAudio();
            setPlaying((current) => !current);
          }}
          aria-label={playing ? "Pause deck" : "Play deck"}
          data-studio-play-toggle
        >
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
          {playing ? "Pause" : "Play"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => goTo(index + 1)} aria-label="Next slide">
          <ChevronRightIcon className="size-4" />
        </Button>
        <span className="ml-2 font-mono text-xs text-muted-foreground" data-studio-player-counter>
          {index + 1} / {total}
        </span>
        <span className="font-mono text-2xs text-muted-foreground/70">
          ← → advance · space play/pause · esc close
        </span>
      </div>
    </div>
  );
}
