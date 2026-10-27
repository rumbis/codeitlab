import { useRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { cn } from "~/lib/utils";

/**
 * Shared CodeItLab panel furniture. Kept in the feature folder (not
 * components/ui) because the phosphor treatments belong to this feature only.
 */
export function CodeItLabSectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly description?: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="codeitlab-mono-label text-codeitlab-green/80">{eyebrow}</p>
        <h2 className="mt-1 font-display text-lg font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {description === undefined ? null : (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{action}</div>
      )}
    </div>
  );
}

export interface CodeItLabToggleOption<T extends string | number> {
  readonly value: T;
  readonly label: ReactNode;
  readonly ariaLabel?: string;
  readonly className?: string;
}

/**
 * A row of mutually exclusive choices. UI.md asks a group to be one tab stop with
 * arrows, so the selected option holds tabIndex 0 and the rest are reachable with
 * ArrowLeft/ArrowRight (plus Home/End), exactly like the section navigation.
 */
export function CodeItLabToggleGroup<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "xs",
  selectedVariant = "secondary",
  idleVariant = "ghost-muted",
  className,
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<CodeItLabToggleOption<T>>;
  readonly onChange: (value: T) => void;
  readonly size?: ComponentProps<typeof Button>["size"];
  readonly selectedVariant?: ComponentProps<typeof Button>["variant"];
  readonly idleVariant?: ComponentProps<typeof Button>["variant"];
  readonly className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const move = (index: number, step: number) => {
    const next = (index + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="group"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <Button
            key={option.value}
            ref={(node: HTMLButtonElement | null) => {
              refs.current[index] = node;
            }}
            aria-label={option.ariaLabel}
            aria-pressed={selected}
            className={option.className}
            size={size}
            tabIndex={selected ? 0 : -1}
            variant={selected ? selectedVariant : idleVariant}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(index, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                onChange(options[0]!.value);
                refs.current[0]?.focus();
              } else if (event.key === "End") {
                event.preventDefault();
                onChange(options[options.length - 1]!.value);
                refs.current[options.length - 1]?.focus();
              }
            }}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

export function CodeItLabCard({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card/50 shadow-xs/5 transition-[border-color,box-shadow,transform] duration-200",
        "hover:-translate-y-px hover:border-codeitlab-green/25 hover:shadow-sm focus-within:border-codeitlab-green/30",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CodeItLabSettingRow({
  title,
  description,
  control,
  htmlFor,
}: {
  readonly title: string;
  readonly description?: string;
  readonly control: ReactNode;
  readonly htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border/50 px-4 py-4 first:border-t-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <label
          className="text-sm font-medium text-foreground"
          {...(htmlFor === undefined ? {} : { htmlFor })}
        >
          {title}
        </label>
        {description === undefined ? null : (
          <p className="mt-0.5 max-w-prose text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}

export function CodeItLabStat({
  label,
  value,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly hint?: string | undefined;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-3">
      <p className="codeitlab-mono-label text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {hint === undefined ? null : (
        <p className="mt-0.5 truncate text-2xs tabular-nums text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function CodeItLabSourceNote({ source }: { readonly source: "server" | "local" }) {
  if (source === "server") return null;
  return (
    <p className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
      <Badge variant="warning" size="sm">
        Preview
      </Badge>
      Server wiring is still landing; this page is showing the typed local adapter. Controls that
      need the server report their result here once the RPC is available.
    </p>
  );
}

export function CodeItLabEmptyBlock({
  title,
  description,
  action,
}: {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 px-6 py-10 text-center">
      <p className="font-display text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

export function CodeItLabLoadingRows({
  rows = 3,
  label = "Loading",
}: {
  readonly rows?: number;
  readonly label?: string;
}) {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-2" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function CodeItLabSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly valueLabel: string;
  readonly onChange: (value: number) => void;
}) {
  const progress = max === min ? 0 : Math.round(((value - min) / (max - min)) * 100);
  const style = { "--settings-slider-progress": `${progress}%` } as CSSProperties;
  return (
    <div className="flex w-full items-center gap-3 sm:w-56">
      <output
        className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
        htmlFor={id}
      >
        {valueLabel}
      </output>
      <input
        aria-label={label}
        className="settings-slider min-w-0 flex-1"
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        style={style}
        type="range"
        value={value}
      />
    </div>
  );
}

export function CodeItLabMeter({ value }: { readonly value: number }) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-codeitlab-green"
          style={{ width: `${Math.round(clamped * 100)}%` }}
        />
      </div>
      <span className="font-mono text-2xs tabular-nums text-muted-foreground">
        {Math.round(clamped * 100)}%
      </span>
    </div>
  );
}
