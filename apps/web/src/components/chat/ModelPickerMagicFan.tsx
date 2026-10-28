import { memo } from "react";

import { cn } from "~/lib/utils";

export interface ModelPickerMagicFanItem {
  readonly key: string;
  readonly label: string;
  readonly initial: string;
  readonly accentColor?: string | undefined;
  readonly selected: boolean;
}

/**
 * The colour-picker move, for models: the active provider's quick picks arc out
 * of the strip as round chips, springing into place with a short stagger, and
 * collapse again on pick. Only transform/opacity animate, and the whole thing
 * disappears under `prefers-reduced-motion`, so it stays out of the way of the
 * list behind it.
 */
export const ModelPickerMagicFan = memo(function ModelPickerMagicFan(props: {
  items: ReadonlyArray<ModelPickerMagicFanItem>;
  title: string;
  onSelect: (key: string) => void;
  onDismiss: () => void;
}) {
  if (props.items.length === 0) return null;
  const count = props.items.length;
  const radius = 104;
  const spread = Math.PI * 0.82;

  return (
    <div className="absolute inset-x-0 top-10 bottom-0 z-20" data-model-picker-magic-fan="true">
      <button
        type="button"
        aria-label={`Close ${props.title}`}
        className="absolute inset-0 cursor-default bg-background/55 backdrop-blur-[1px]"
        onClick={props.onDismiss}
      />
      <div className="pointer-events-none absolute left-1/2 top-0 size-0">
        <div className="cil-picker-glow absolute -left-24 -top-24 size-48 rounded-full bg-primary/25" />
        {props.items.map((item, index) => {
          // Fan downward into the free space under the strip.
          const angle = Math.PI / 2 - spread / 2 + (spread * (index + 0.5)) / count;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          return (
            <span
              key={item.key}
              className="absolute left-0 top-0"
              style={{ transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))` }}
            >
              <button
                type="button"
                title={item.label}
                aria-label={item.label}
                onClick={() => props.onSelect(item.key)}
                style={{
                  animationDelay: `${index * 20}ms`,
                  ...(item.accentColor === undefined
                    ? {}
                    : { borderColor: item.accentColor, color: item.accentColor }),
                }}
                className={cn(
                  "cil-picker-chip pointer-events-auto cil-picker-spring flex size-12 items-center justify-center rounded-full border-2 bg-popover text-xs font-semibold shadow-lg",
                  "transition-[scale,box-shadow] duration-200 hover:scale-110 focus-visible:scale-110 focus-visible:outline-none",
                  item.selected && "bg-primary text-primary-foreground",
                )}
              >
                {item.initial}
              </button>
            </span>
          );
        })}
      </div>
    </div>
  );
});
