// The installable PWA. Every "get the free app" call to action points here; the
// app decides how it installs from the browser. Overridable like the marketplace
// URL, so a local run can point at a locally served app instead of production.
export const APP_URL = import.meta.env.APP_URL ?? "https://app.codeitlab.com";

export const GITHUB_REPOSITORY_URL = "https://github.com/rumbis/codeitlab";

// The marketplace is a separate service behind the same origin. The static site
// only links to it, so a site deploy can never take the money path down.
// Overridable so the local demo links to the marketplace running beside it
// instead of sending the browser to production.
export const MARKETPLACE_URL = import.meta.env.MARKETPLACE_URL ?? "https://codeitlab.com/market";
export const MARKETPLACE_JOIN_URL = `${MARKETPLACE_URL}/join`;
export const MARKETPLACE_JOBS_URL = `${MARKETPLACE_URL}/jobs`;

// Upstream project CodeItLab is forked from, kept for honest attribution.
export const UPSTREAM_PROJECT_URL = "https://github.com/rumbis/codeitlab";
