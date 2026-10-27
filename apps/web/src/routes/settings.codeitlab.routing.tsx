import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabModelsPage } from "../components/codeitlab/CodeItLabModelsPage";

// Routing is a tab of the Models page now; the route stays so old deep links
// keep landing on the same controls.
function RoutingTab() {
  return <CodeItLabModelsPage tab="routing" />;
}

export const Route = createFileRoute("/settings/codeitlab/routing")({
  component: RoutingTab,
});
