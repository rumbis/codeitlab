import type { CodeItLabIntegrationId } from "@codeitlab/contracts";
import { cn } from "~/lib/utils";

/**
 * Original CodeItLab marks for the whitelabel surfaces. These are ours: a 9:16
 * play frame for Shorts, linked bot heads for Crew, and a lens for Search.
 * Deliberately not derived from any upstream logo.
 */
export function IntegrationMark({
  id,
  className,
}: {
  readonly id: CodeItLabIntegrationId;
  readonly className?: string;
}) {
  const shared = {
    viewBox: "0 0 48 48",
    fill: "none",
    "aria-hidden": true,
    className: cn("size-10", className),
  } as const;

  if (id === "shorts") {
    return (
      <svg {...shared}>
        <rect x="13" y="6" width="22" height="36" rx="6" stroke="currentColor" strokeWidth="2.5" />
        <path d="M21 19.5v9l8-4.5-8-4.5Z" fill="currentColor" />
        <path d="M17 40.5h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path
          d="M9 16.5v15M39 16.5v15"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
    );
  }

  if (id === "crew") {
    return (
      <svg {...shared}>
        <path d="M12 34h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M12 34v-6M24 34v-8M36 34v-6" stroke="currentColor" strokeWidth="2.5" />
        <rect
          x="6"
          y="16"
          width="12"
          height="10"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="18"
          y="12"
          width="12"
          height="10"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <rect
          x="30"
          y="16"
          width="12"
          height="10"
          rx="3.5"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <circle cx="10" cy="21" r="1.6" fill="currentColor" />
        <circle cx="22" cy="17" r="1.6" fill="currentColor" />
        <circle cx="34" cy="21" r="1.6" fill="currentColor" />
        <path d="M24 12V7" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="24" cy="5.5" r="2" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg {...shared}>
      <circle cx="21" cy="21" r="11" stroke="currentColor" strokeWidth="2.5" />
      <path d="M29.5 29.5 39 39" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <path
        d="M21 14.5v13M14.5 21h13"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M35 9.5 36.4 13l3.5 1.4-3.5 1.4L35 19.3l-1.4-3.5L30.1 14.4l3.5-1.4L35 9.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
