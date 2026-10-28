import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabUncensoredPage } from "../components/codeitlab/CodeItLabUncensoredPage";

export const Route = createFileRoute("/settings/codeitlab/uncensored")({
  component: CodeItLabUncensoredPage,
});
