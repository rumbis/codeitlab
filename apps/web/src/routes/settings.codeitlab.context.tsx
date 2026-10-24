import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabContextPage } from "../components/codeitlab/CodeitlabContextPage";

export const Route = createFileRoute("/settings/codeitlab/context")({
  component: CodeitlabContextPage,
});
