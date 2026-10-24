import type { JobCategory } from "../shared/contracts.ts";

/**
 * Starting points for a brief, not marketing copy. A company without time can
 * pick one, read what a complete brief looks like, then change every field —
 * the template only fills the form, it never posts. Budgets are honest ranges
 * for the work, and each one says why it is scoped that way.
 */
export interface JobTemplate {
  readonly id: string;
  readonly label: string;
  readonly blurb: string;
  readonly title: string;
  readonly description: string;
  readonly skills: string;
  readonly category: JobCategory;
  readonly budgetMinCents: number;
  readonly budgetMaxCents: number;
  readonly timeline: string;
}

export const JOB_TEMPLATES: readonly JobTemplate[] = [
  {
    id: "landing-page",
    label: "Landing page",
    blurb: "One page, copy supplied, a form that reaches you.",
    title: "Build a one-page landing site for a product launch",
    description:
      "We have the copy and a logo. Build a responsive one-page site with a headline, three feature blocks, a pricing table and a waitlist form that emails us each signup. Definition of done: deployed to our domain, mobile checked, form tested end to end, Lighthouse performance above 90.",
    skills: "HTML, CSS, TypeScript, accessibility",
    category: "web",
    budgetMinCents: 40_000,
    budgetMaxCents: 90_000,
    timeline: "1–2 weeks",
  },
  {
    id: "video-edit",
    label: "Video edit",
    blurb: "Existing footage, captions, one 60-second cut.",
    title: "Edit a 60-second launch video from existing footage",
    description:
      "We have 20 minutes of interview footage and a music track. Deliver one 60-second vertical cut with burned-in captions, a title card and a logo end card, plus the project file. Definition of done: MP4 in 1080x1920 and 1920x1080, captions checked for typos, and the project file opens on a clean machine.",
    skills: "Video editing, captions, motion graphics",
    category: "video",
    budgetMinCents: 25_000,
    budgetMaxCents: 60_000,
    timeline: "4–7 days",
  },
  {
    id: "data-cleanup",
    label: "Data cleanup",
    blurb: "A messy spreadsheet, one clean importable file.",
    title: "Clean and normalise a customer spreadsheet",
    description:
      "We have a 12,000-row spreadsheet exported from three systems. Deliver one CSV with deduplicated customers, normalised country and phone fields, and a short note listing the rules you applied and the rows you could not resolve. Definition of done: the file imports into our CRM without errors and every removed row is explained.",
    skills: "Python, data cleaning, CSV",
    category: "data",
    budgetMinCents: 20_000,
    budgetMaxCents: 50_000,
    timeline: "3–5 days",
  },
  {
    id: "ops-automation",
    label: "Ops automation",
    blurb: "A small script that removes a weekly manual job.",
    title: "Automate a weekly report we build by hand",
    description:
      "Every Monday we copy numbers from two dashboards into a report. Deliver a script that pulls both exports, produces the report as a spreadsheet with the same layout, and runs on a schedule with a log we can read. Definition of done: one dry run with last week's data matches our hand-made report, and the setup steps are written down.",
    skills: "Python, SQL, automation",
    category: "ops",
    budgetMinCents: 35_000,
    budgetMaxCents: 80_000,
    timeline: "1–2 weeks",
  },
];

export function findJobTemplate(id: string | null | undefined): JobTemplate | undefined {
  if (id === null || id === undefined) return undefined;
  return JOB_TEMPLATES.find((template) => template.id === id);
}
