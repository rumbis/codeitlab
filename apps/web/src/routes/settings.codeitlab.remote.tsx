import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabRemotePage } from "../components/codeitlab/CodeitlabRemotePage";

export const Route = createFileRoute("/settings/codeitlab/remote")({
  component: CodeitlabRemotePage,
});
