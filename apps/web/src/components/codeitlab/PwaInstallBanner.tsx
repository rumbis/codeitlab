import { DownloadIcon, ShareIcon, XIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  getPwaInstallStore,
  resolvePwaInstallBanner,
  type PwaInstallStore,
} from "../../pwa/install";
import { Button } from "../ui/button";

/**
 * Lightweight install prompt for the CodeItLab panel. Android/Chromium get the
 * captured `beforeinstallprompt`; iOS Safari has no prompt event, so the banner
 * falls back to Add to Home Screen instructions.
 */
export function PwaInstallBanner({
  store = getPwaInstallStore(),
}: {
  readonly store?: PwaInstallStore;
}) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const mode = resolvePwaInstallBanner(snapshot);
  if (mode === "hidden") return null;

  return (
    <section
      aria-label="Install CodeItLab"
      data-pwa-install-banner={mode}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-codeitlab-green/30 bg-codeitlab-green/8 px-4 py-3"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-codeitlab-green/30 bg-codeitlab-green/10 text-codeitlab-green"
        >
          {mode === "prompt" ? (
            <DownloadIcon className="size-4" />
          ) : (
            <ShareIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Install CodeItLab</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {mode === "prompt"
              ? "Add CodeItLab to your home screen for a full-screen app window."
              : "In Safari, tap Share, then choose “Add to Home Screen”."}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {mode === "prompt" ? (
          <Button size="sm" onClick={() => void store.install()}>
            Install
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => store.dismiss()}>
            Got it
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-label="Dismiss install banner"
          onClick={() => store.dismiss()}
        >
          <XIcon />
        </Button>
      </div>
    </section>
  );
}
