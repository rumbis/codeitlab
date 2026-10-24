import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { playCodeitlabSfx, unlockCodeitlabAudio } from "~/codeitlab/audio";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/** The app route the overlay hands the prompt to; it creates the real thread. */
export function quickOverlayHref(prompt: string): string {
  return `/new?prompt=${encodeURIComponent(prompt)}`;
}

function isQuickOverlayChord(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.shiftKey &&
    (event.key === " " || event.code === "Space")
  );
}

/**
 * Quick capture. The desktop shell owns the global shortcut and raises this
 * window; the overlay itself stays in the renderer so the prompt goes through
 * the same new-thread path as every other entry point (project picker, model
 * defaults, prompt links) instead of a second, weaker creation flow.
 */
export function QuickOverlayLauncher({
  onSubmit,
}: {
  /** Test seam; production always navigates to the new-thread route. */
  readonly onSubmit?: (prompt: string) => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const close = () => {
    setOpen(false);
    setPrompt("");
  };

  useEffect(() => {
    const stopDesktopOpen = window.desktopBridge?.onQuickOverlayOpen?.(() => setOpen(true));
    const stopUnavailable = window.desktopBridge?.onQuickOverlayUnavailable?.((message) => {
      toastManager.add({ type: "error", title: "Quick overlay unavailable", description: message });
    });
    // Browser fallback: the desktop shell supplies the real global shortcut, but
    // the same chord works while the window is focused (dev, web, tests).
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isQuickOverlayChord(event)) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      stopDesktopOpen?.();
      stopUnavailable?.();
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    unlockCodeitlabAudio();
    playCodeitlabSfx("click");
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const submit = () => {
    const trimmed = prompt.trim();
    if (trimmed === "") return;
    playCodeitlabSfx("send");
    close();
    if (onSubmit !== undefined) {
      onSubmit(trimmed);
      return;
    }
    void navigate({ href: quickOverlayHref(trimmed) });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-24 sm:pt-28 backdrop-blur-sm motion-reduce:backdrop-blur-none"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <div
        aria-label="Quick task"
        aria-modal="true"
        className="w-full max-w-xl overflow-hidden rounded-xl border border-codeitlab-green/30 bg-card shadow-lg codeitlab-page-enter"
        role="dialog"
      >
        <div aria-hidden className="h-0.5 w-full bg-codeitlab-green/70" />
        <div className="flex items-center justify-between px-4 pt-3">
          <p className="codeitlab-mono-label text-codeitlab-green/90">CodeitLab // quick capture</p>
          <span className="codeitlab-mono-label text-muted-foreground/70">esc to dismiss</span>
        </div>
        <textarea
          ref={inputRef}
          aria-label="Task prompt"
          className="min-h-28 w-full resize-none bg-transparent px-4 py-3 font-display text-base text-foreground outline-none placeholder:text-muted-foreground/70"
          onChange={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="What should CodeitLab do? It opens a real thread."
          value={prompt}
        />
        <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
          <span className={cn("codeitlab-mono-label", "text-muted-foreground/70")}>
            enter open · shift+enter newline
          </span>
          <div className="flex items-center gap-2">
            <Button onClick={close} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button disabled={prompt.trim() === ""} onClick={submit} size="sm">
              Open thread
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
