import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabMarketplacePage } from "../components/codeitlab/CodeItLabMarketplacePage";

export const Route = createFileRoute("/settings/codeitlab/marketplace")({
  component: CodeItLabMarketplacePage,
});
