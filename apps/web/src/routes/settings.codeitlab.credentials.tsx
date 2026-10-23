import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabCredentialsPage } from "../components/codeitlab/CodeitlabCredentialsPage";

export const Route = createFileRoute("/settings/codeitlab/credentials")({
  component: CodeitlabCredentialsPage,
});
