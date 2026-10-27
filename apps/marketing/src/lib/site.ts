// The installable PWA. "Install the app" always points here; the app decides
// how it installs from the browser.
export const APP_URL = "https://app.codeitlab.com";

export const GITHUB_REPOSITORY_URL = "https://github.com/rumbis/codeitlab";

// The marketplace is a separate service behind the same origin. The static site
// only links to it, so a site deploy can never take the money path down.
export const MARKETPLACE_URL = "https://codeitlab.com/market";
export const MARKETPLACE_JOIN_URL = `${MARKETPLACE_URL}/join`;
export const MARKETPLACE_JOBS_URL = `${MARKETPLACE_URL}/jobs`;

// Upstream project CodeItLab is forked from, kept for honest attribution.
export const UPSTREAM_PROJECT_URL = "https://github.com/rumbis/codeitlab";
