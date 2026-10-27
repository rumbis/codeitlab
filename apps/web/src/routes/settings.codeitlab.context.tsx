import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabModelsPage } from "../components/codeitlab/CodeItLabModelsPage";

// Context sizes are a tab of the Models page now; the route stays so old deep
// links keep landing on the same controls.
function ContextTab() {
  return <CodeItLabModelsPage tab="context" />;
}

export const Route = createFileRoute("/settings/codeitlab/context")({
  component: ContextTab,
});
