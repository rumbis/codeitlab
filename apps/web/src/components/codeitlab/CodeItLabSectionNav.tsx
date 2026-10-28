import { Link } from "@tanstack/react-router";
import { useEffect, useRef, type KeyboardEvent } from "react";

import { cn } from "~/lib/utils";
import { playCodeItLabSfx, unlockCodeItLabAudio } from "../../codeitlab/audio";
import { CODEITLAB_SECTIONS } from "../../codeitlab/panel";
import { CODEITLAB_SECTION_ICONS, nextSectionIndex } from "../../codeitlab/sectionNav";

/**
 * The panel's section row. It behaves like one control: a single tab stop, and
 * arrow keys move between sections without tabbing through fourteen links.
 * Navigation itself stays a real `<Link>`, so middle-click and copy-link work.
 */
export function CodeItLabSectionNav({
  pathname,
  onNavigate,
}: {
  readonly pathname: string;
  readonly onNavigate?: () => void;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const activeIndex = CODEITLAB_SECTIONS.findIndex((section) => section.to === pathname);
  const activeId = activeIndex === -1 ? null : CODEITLAB_SECTIONS[activeIndex]?.id;

  // On a narrow window the row scrolls; keep the active section visible when
  // the panel is opened from the palette or a deep link.
  useEffect(() => {
    if (activeId === null) return;
    navRef.current
      ?.querySelector<HTMLElement>(`[data-codeitlab-section="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Move relative to the tab that has focus, not to the active route: the
    // row is one control and focus is what the next arrow key should follow.
    const focusedId = navRef.current
      ?.querySelector<HTMLElement>("[data-codeitlab-section]:focus")
      ?.getAttribute("data-codeitlab-section");
    const focusedIndex = CODEITLAB_SECTIONS.findIndex((section) => section.id === focusedId);
    const from = focusedIndex === -1 ? Math.max(activeIndex, 0) : focusedIndex;
    const next = nextSectionIndex(from, event.key, CODEITLAB_SECTIONS.length);
    if (next === null) return;
    event.preventDefault();
    const target = CODEITLAB_SECTIONS[next];
    if (target === undefined) return;
    navRef.current
      ?.querySelector<HTMLAnchorElement>(`[data-codeitlab-section="${target.id}"]`)
      ?.focus();
  };

  return (
    <nav
      ref={navRef}
      aria-label="CodeItLab sections"
      onKeyDown={onKeyDown}
      className="sticky top-0 z-10 -mx-4 flex gap-1 overflow-x-auto bg-background/85 px-4 py-2 backdrop-blur-md supports-[backdrop-filter]:bg-background/70"
    >
      {CODEITLAB_SECTIONS.map((section) => {
        const active = section.to === pathname;
        const Icon = CODEITLAB_SECTION_ICONS[section.id];
        return (
          <Link
            key={section.id}
            to={section.to}
            aria-current={active ? "page" : undefined}
            tabIndex={active ? 0 : -1}
            className={cn(
              "group inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-[color,background-color,border-color,box-shadow] duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              active
                ? "border-codeitlab-green/40 bg-codeitlab-green/12 text-codeitlab-green shadow-xs/5"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            data-codeitlab-section={section.id}
            onClick={() => {
              onNavigate?.();
              unlockCodeItLabAudio();
              playCodeItLabSfx("click");
            }}
          >
            <Icon
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-150 group-hover:scale-110",
                active ? "opacity-100" : "opacity-70",
              )}
            />
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}
