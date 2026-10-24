import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { Badge } from "../ui/badge";
import { Skeleton } from "../ui/skeleton";
import { cn } from "~/lib/utils";

/**
 * Shared CodeitLab panel furniture. Kept in the feature folder (not
 * components/ui) because the phosphor treatments belong to this feature only.
 */
export function CodeitlabSectionHeading({
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

export function CodeitlabCard({ className, children, ...props }: ComponentProps<"div">) {
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

export function CodeitlabSettingRow({
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

export function CodeitlabStat({
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
        <p className="mt-0.5 truncate text-2xs text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}

export function CodeitlabSourceNote({ source }: { readonly source: "server" | "local" }) {
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

export function CodeitlabEmptyBlock({
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

export function CodeitlabLoadingRows({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function CodeitlabSlider({
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

export function CodeitlabMeter({ value }: { readonly value: number }) {
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
