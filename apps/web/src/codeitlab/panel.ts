/**
 * CodeitLab settings section registry. The panel shell renders these as tabs;
 * settingsSearch and the command palette reuse the same list so a new subpage
 * only has to be added here, to routes/settings.codeitlab.*, and to
 * settingsSearch's path union.
 */
export const CODEITLAB_SECTIONS = [
  { id: "overview", label: "Overview", to: "/settings/codeitlab" },
  { id: "effects", label: "Effects", to: "/settings/codeitlab/effects" },
  { id: "nexus", label: "Nexus", to: "/settings/codeitlab/nexus" },
  { id: "memory", label: "Memory", to: "/settings/codeitlab/memory" },
  { id: "routing", label: "Routing", to: "/settings/codeitlab/routing" },
  { id: "uncensored", label: "Uncensored", to: "/settings/codeitlab/uncensored" },
  { id: "rea", label: "REA", to: "/settings/codeitlab/rea" },
  { id: "ecosystem", label: "Ecosystem", to: "/settings/codeitlab/ecosystem" },
  { id: "remote", label: "Remote", to: "/settings/codeitlab/remote" },
  { id: "credentials", label: "Privacy", to: "/settings/codeitlab/credentials" },
  { id: "shorts", label: "Shorts", to: "/settings/codeitlab/shorts" },
  { id: "crew", label: "Crew", to: "/settings/codeitlab/crew" },
  { id: "search", label: "Search", to: "/settings/codeitlab/search" },
] as const;

export type CodeitlabSection = (typeof CODEITLAB_SECTIONS)[number];
export type CodeitlabSectionPath = CodeitlabSection["to"];

export function isCodeitlabPath(pathname: string): boolean {
  return pathname === "/settings/codeitlab" || pathname.startsWith("/settings/codeitlab/");
}
