import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabMemoryPage } from "../components/codeitlab/CodeitlabMemoryPage";

export const Route = createFileRoute("/settings/codeitlab/memory")({
  component: CodeitlabMemoryPage,
});
