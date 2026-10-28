import { Toolbar } from "@base-ui/react/toolbar";
import { type ProviderInstanceId } from "@codeitlab/contracts";
import { memo, useLayoutEffect, useRef, useState } from "react";
import { SparklesIcon, StarIcon } from "lucide-react";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { cn } from "~/lib/utils";
import {
  isProviderInstancePickerReady,
  shouldShowInstanceBadge,
  type ProviderInstanceEntry,
} from "../../providerInstances";

function describeUnavailableInstance(entry: ProviderInstanceEntry): string {
  const label = entry.displayName;
  if (!entry.enabled || entry.status === "disabled") {
    return `${label} — Disabled in settings.`;
  }
  if (entry.status === "ready" && entry.isAvailable) {
    return label;
  }
  const kind =
    entry.status === "error" ? "Unavailable" : entry.status === "warning" ? "Limited" : "Not ready";
  const msg = entry.snapshot.message?.trim();
  return msg ? `${label} — ${kind}. ${msg}` : `${label} — ${kind}.`;
}

const SELECTED_INDICATOR_CLASS =
  "pointer-events-none absolute -top-1 left-1/2 z-10 h-0.75 w-5 -translate-x-1/2 rounded-b-full bg-primary";
const BADGE_BASE_CLASS =
  "pointer-events-none absolute -right-0.5 top-0.5 z-10 flex size-3.5 items-center justify-center rounded-full bg-transparent shadow-sm ";
const NEW_BADGE_CLASS = `${BADGE_BASE_CLASS} text-update-foreground `;

const PICKER_TOOLTIP_SIDE = "top" as const;
const PICKER_TOOLTIP_SIDE_OFFSET = 8;

export const ModelPickerSidebar = memo(function ModelPickerSidebar(props: {
  selectedInstanceId: ProviderInstanceId | "favorites";
  onSelectInstance: (instanceId: ProviderInstanceId | "favorites") => void;
  onFocusSearch: () => void;
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  showFavorites?: boolean;
  disabledInstanceIds?: ReadonlySet<ProviderInstanceId>;
  selectableUnavailableInstanceIds?: ReadonlySet<ProviderInstanceId>;
  getDisabledInstanceTooltip?: (entry: ProviderInstanceEntry) => string;
  newBadgeInstanceIds?: ReadonlySet<ProviderInstanceId>;
  /** The magic fan is open for the active provider. */
  magicOpen?: boolean;
  onToggleMagic?: () => void;
}) {
  const handleSelect = (instanceId: ProviderInstanceId | "favorites") => {
    props.onSelectInstance(instanceId);
  };
  const showFavorites = props.showFavorites ?? true;
  const [hoveredInstanceId, setHoveredInstanceId] = useState<ProviderInstanceId | null>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const [selectedIndicatorLeft, setSelectedIndicatorLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const content = sidebarContentRef.current;
    if (!content) {
      return;
    }
    const selectedItem = Array.from(
      content.querySelectorAll<HTMLElement>("[data-model-picker-provider]"),
    ).find((item) => item.dataset.modelPickerProvider === props.selectedInstanceId);
    if (!selectedItem) {
      setSelectedIndicatorLeft(null);
      return;
    }
    setSelectedIndicatorLeft(selectedItem.offsetLeft + selectedItem.offsetWidth / 2 - 10);
  }, [
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Adding, removing or reordering providers moves the selected item, so the indicator re-measures.
    props.instanceEntries,
    props.selectedInstanceId,
    showFavorites,
  ]);

  return (
    <Toolbar.Root
      className="h-11 w-full shrink-0 overflow-hidden border-b border-border/70 bg-muted/30 pt-1.5"
      data-model-picker-sidebar="true"
      aria-label="Providers"
      orientation="horizontal"
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowRight") {
          event.preventDefault();
          props.onFocusSearch();
          return;
        }
      }}
    >
      <div className="w-full overflow-x-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div
          ref={sidebarContentRef}
          className="relative flex min-w-full flex-row items-center gap-0.5 p-0.5"
        >
          {selectedIndicatorLeft !== null ? (
            <div
              data-model-picker-selected-indicator="true"
              className={cn(
                SELECTED_INDICATOR_CLASS,
                "cil-picker-spring translate-x-0 transition-[left] duration-300",
              )}
              style={{ left: selectedIndicatorLeft }}
            />
          ) : null}
          {props.onToggleMagic ? (
            <div className="relative size-9 shrink-0" data-model-picker-provider="magic">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toolbar.Button
                      className={cn(
                        "relative isolate flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-[transform,background-color] duration-200 cil-picker-spring hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
                        props.magicOpen && "-translate-y-1 bg-primary/15 text-primary",
                      )}
                      onClick={() => props.onToggleMagic?.()}
                      type="button"
                      aria-label="Quick picks"
                      aria-pressed={props.magicOpen === true}
                    >
                      <SparklesIcon className="size-4" aria-hidden />
                    </Toolbar.Button>
                  }
                />
                <TooltipPopup side={PICKER_TOOLTIP_SIDE} sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}>
                  Quick picks
                </TooltipPopup>
              </Tooltip>
            </div>
          ) : null}
          {showFavorites ? (
            <>
              <div className="relative size-9 shrink-0" data-model-picker-provider="favorites">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Toolbar.Button
                        className={cn(
                          "relative isolate flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
                        )}
                        onClick={() => handleSelect("favorites")}
                        type="button"
                        aria-label="Favorites"
                        aria-pressed={props.selectedInstanceId === "favorites"}
                      >
                        <StarIcon className="size-5 fill-current shrink-0" aria-hidden />
                      </Toolbar.Button>
                    }
                  />
                  <TooltipPopup
                    side={PICKER_TOOLTIP_SIDE}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    Favorites
                  </TooltipPopup>
                </Tooltip>
              </div>
              <div className="h-6 border-r border-border/70" aria-hidden="true" />
            </>
          ) : null}

          {props.instanceEntries.map((entry) => {
            const isUnavailable = !isProviderInstancePickerReady(entry);
            const isContextDisabled = props.disabledInstanceIds?.has(entry.instanceId) ?? false;
            const unavailableSelectionIsReachable =
              props.selectableUnavailableInstanceIds?.has(entry.instanceId) ?? false;
            const isDisabled =
              (isUnavailable && !unavailableSelectionIsReachable) || isContextDisabled;
            const isSelected = props.selectedInstanceId === entry.instanceId;
            const isHovered = hoveredInstanceId === entry.instanceId;
            const showNewBadge = props.newBadgeInstanceIds?.has(entry.instanceId) ?? false;
            const showInstanceBadge = shouldShowInstanceBadge(entry, props.instanceEntries);

            const tooltip = isUnavailable
              ? describeUnavailableInstance(entry)
              : isContextDisabled
                ? (props.getDisabledInstanceTooltip?.(entry) ?? entry.displayName)
                : showNewBadge
                  ? `${entry.displayName} — New`
                  : entry.displayName;

            const button = (
              <Toolbar.Button
                className={cn(
                  "relative isolate flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md transition-[transform,background-color] duration-200 cil-picker-spring hover:bg-foreground/10 focus-visible:bg-foreground/10 focus-visible:outline-none",
                  "before:absolute before:-z-1 before:size-8 before:rounded-full before:bg-[color:var(--picker-accent,var(--primary))] before:opacity-0 before:transition-opacity before:duration-200",
                  entry.instanceId === props.selectedInstanceId &&
                    "-translate-y-1 before:opacity-100",
                  isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
                )}
                data-provider-accent-color={entry.accentColor}
                onClick={() => !isDisabled && handleSelect(entry.instanceId)}
                onMouseEnter={() => setHoveredInstanceId(entry.instanceId)}
                onMouseLeave={() =>
                  setHoveredInstanceId((current) => (current === entry.instanceId ? null : current))
                }
                onFocus={() => setHoveredInstanceId(entry.instanceId)}
                onBlur={() =>
                  setHoveredInstanceId((current) => (current === entry.instanceId ? null : current))
                }
                disabled={isDisabled}
                focusableWhenDisabled={!isDisabled}
                aria-pressed={isSelected}
                type="button"
                aria-label={
                  isUnavailable || isContextDisabled
                    ? tooltip
                    : showNewBadge
                      ? `${entry.displayName}, new`
                      : entry.displayName
                }
              >
                <ProviderInstanceIcon
                  driverKind={entry.driverKind}
                  displayName={entry.displayName}
                  accentColor={entry.accentColor}
                  acpRegistryAgentId={entry.acpRegistryAgentId}
                  acpRegistryIconUrl={entry.acpRegistryIconUrl}
                  showBadge={showInstanceBadge}
                  className="size-6 z-30"
                  iconClassName="size-5"
                  indicatorBackground={
                    isHovered && !isDisabled
                      ? "var(--muted)"
                      : isSelected
                        ? "var(--background)"
                        : "color-mix(in oklab, var(--muted) 30%, transparent)"
                  }
                  {...(entry.accentColor ? { badgeClassName: "h-3 min-w-3 px-0.5 text-5xs" } : {})}
                />
                {showNewBadge ? (
                  <span className={NEW_BADGE_CLASS} aria-hidden>
                    <SparklesIcon className="size-2" />
                  </span>
                ) : null}
              </Toolbar.Button>
            );

            const trigger = isDisabled ? (
              <span
                className="relative block size-9 shrink-0"
                style={
                  entry.accentColor === undefined
                    ? undefined
                    : ({ "--picker-accent": entry.accentColor } as React.CSSProperties)
                }
              >
                {button}
              </span>
            ) : (
              button
            );

            return (
              <div
                key={entry.instanceId}
                className="relative size-9 shrink-0"
                data-model-picker-provider={entry.instanceId}
              >
                <Tooltip>
                  <TooltipTrigger render={trigger} />
                  <TooltipPopup
                    side={PICKER_TOOLTIP_SIDE}
                    sideOffset={PICKER_TOOLTIP_SIDE_OFFSET}
                    align="center"
                  >
                    {tooltip}
                  </TooltipPopup>
                </Tooltip>
              </div>
            );
          })}
        </div>
      </div>
    </Toolbar.Root>
  );
});
