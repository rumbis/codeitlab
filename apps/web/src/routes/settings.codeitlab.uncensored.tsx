import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabUncensoredPage } from "../components/codeitlab/CodeitlabUncensoredPage";

export const Route = createFileRoute("/settings/codeitlab/uncensored")({
  component: CodeitlabUncensoredPage,
});
