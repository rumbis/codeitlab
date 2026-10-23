import type { SVGProps } from "react";

// Upstream file/export name kept so imports and internal identifiers stay
// stable; the artwork is CodeitLab's original hex-and-node mark, not the T3
// wordmark.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2.2 20.5 7v10L12 21.8 3.5 17V7L12 2.2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 9.4V6.4M12 14.6v3M9.4 12H6.4M14.6 12h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
