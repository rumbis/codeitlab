import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { CpuIcon, SparklesIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { playCodeitlabSfx, unlockCodeitlabAudio } from "../../codeitlab/audio";
import { useCodeitlabEffectsSettings } from "../../codeitlab/effectsSettings";
import { CODEITLAB_SECTIONS } from "../../codeitlab/panel";
import { AmbientScene } from "./AmbientScene";
import { CodeitlabSoundToggle } from "./CodeitlabSoundToggle";

/**
 * Settings → CodeitLab shell. The hero is the one place the 3D scene is always
 * eligible to run (subject to the persisted Effects quality and the scene's
 * own offscreen/visibility/reduced-motion rules); subpages stay flat and fast.
 */
export function CodeitlabPanelShell() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const effects = useCodeitlabEffectsSettings();
  return (
    <div
      className="topbar-scroll-fade scrollbar-gutter-both flex-1 overflow-y-auto"
      data-settings-page-scroll
      data-codeitlab-panel
    >
      <section className="relative overflow-hidden border-b border-border/70">
        <div aria-hidden className="absolute inset-0 codeitlab-grid opacity-60" />
        <div aria-hidden className="absolute inset-0 codeitlab-hero-glow opacity-80" />
        <div aria-hidden className="absolute inset-0 codeitlab-scanlines opacity-40" />
        <AmbientScene
          className="opacity-45"
          maxFps={effects.maxFps}
          quality={effects.threeD}
          respectReducedMotion={effects.respectReducedMotion}
          variant="orb"
        />
        <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="codeitlab-mono-label text-codeitlab-green/90">
                CODEITLAB // CONTROL PLANE
              </p>
              <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                CodeitLab
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
                One place to tune the harness: ambient effects, the unified ACP catalog, persistent
                memory, multi-provider routing, policy, and REA. Everything here is local-first and
                syncs to the connected environment when its RPC is available.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <CodeitlabSoundToggle />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-codeitlab-green/30 bg-codeitlab-green/8 px-2.5 py-1 text-codeitlab-green">
              <CpuIcon className="size-3.5" />
              {effects.threeD === "off" ? "3D off" : `3D ${effects.threeD}`}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-codeitlab-cyan/30 bg-codeitlab-cyan/8 px-2.5 py-1 text-codeitlab-cyan">
              <SparklesIcon className="size-3.5" />
              {effects.sfxEnabled ? `SFX ${Math.round(effects.sfxVolume * 100)}%` : "SFX muted"}
            </span>
            <span className="codeitlab-mono-label text-muted-foreground/70">
              {effects.respectReducedMotion ? "reduced-motion aware" : "motion forced"}
            </span>
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-4 pb-16 sm:px-6">
        <nav aria-label="CodeitLab sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
          {CODEITLAB_SECTIONS.map((section) => {
            const active = section.to === pathname;
            return (
              <Link
                key={section.id}
                to={section.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active
                    ? "border-codeitlab-green/40 bg-codeitlab-green/12 text-codeitlab-green"
                    : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                data-codeitlab-section={section.id}
                onClick={() => {
                  unlockCodeitlabAudio();
                  playCodeitlabSfx("click");
                }}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>
        <Outlet />
      </div>
    </div>
  );
}
