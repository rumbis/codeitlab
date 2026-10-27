import { createFileRoute } from "@tanstack/react-router";

import { CodeItLabWallpaperPage } from "../components/codeitlab/CodeItLabWallpaperPage";

export const Route = createFileRoute("/settings/codeitlab/wallpaper")({
  component: CodeItLabWallpaperPage,
});
