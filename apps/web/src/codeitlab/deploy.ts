import type { CodeitlabDeployTarget } from "@codeitlab/core/deploy";

export const DEPLOY_STARTERS: ReadonlyArray<{
  readonly name: string;
  readonly command: string;
  readonly notes: string;
}> = [
  { name: "Vercel", command: "vercel deploy --prod", notes: "Requires the Vercel CLI, logged in." },
  {
    name: "Netlify",
    command: "netlify deploy --prod",
    notes: "Requires the Netlify CLI, logged in.",
  },
  {
    name: "Cloudflare Pages",
    command: "wrangler pages deploy",
    notes: "Requires Wrangler, logged in; add the output directory if the project needs one.",
  },
  { name: "Railway", command: "railway up", notes: "Requires the Railway CLI, linked project." },
  { name: "Fly.io", command: "fly deploy", notes: "Requires flyctl and an existing app." },
  { name: "Custom", command: "", notes: "Any command your project already uses." },
];

let sequence = 0;

export function createDeployTarget(now: Date, name = "New target"): CodeitlabDeployTarget {
  sequence += 1;
  return {
    id: `deploy-${now.getTime().toString(36)}-${sequence.toString(36)}`,
    name,
    command: "",
    notes: "",
    enabled: true,
  };
}

export function starterDeployTarget(now: Date, starter: (typeof DEPLOY_STARTERS)[number]) {
  const target = createDeployTarget(now, starter.name);
  return { ...target, command: starter.command, notes: starter.notes };
}
