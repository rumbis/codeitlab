import type { APIRoute } from "astro";

import { buildCilProjectFileJsonSchema } from "@codeitlab/shared/cilProjectFile";

export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildCilProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
