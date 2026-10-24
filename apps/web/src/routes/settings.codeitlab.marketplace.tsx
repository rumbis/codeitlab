import { createFileRoute } from "@tanstack/react-router";

import { CodeitlabMarketplacePage } from "../components/codeitlab/CodeitlabMarketplacePage";

export const Route = createFileRoute("/settings/codeitlab/marketplace")({
  component: CodeitlabMarketplacePage,
});
