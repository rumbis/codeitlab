import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabCredentialsPage } from "../components/codeitlab/CodeItLabCredentialsPage";

export const Route = createFileRoute("/settings/codeitlab/credentials")({
  component: CodeItLabCredentialsPage,
});
