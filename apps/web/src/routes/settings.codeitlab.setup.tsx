import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabSetupPage } from "../components/codeitlab/CodeItLabSetupPage";

export const Route = createFileRoute("/settings/codeitlab/setup")({
  component: CodeItLabSetupPage,
});
