import type { UiAppManifest } from "@/app/store/shared/types";

const manifest: UiAppManifest = {
  id: "ui_app_name",
  name: "App Name",
  description: "One-line description shown in the app store.",
  icon: "square",
  version: "0.1.0",
  author: "MMFFDev",
  category: "utility",
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  allowedRoles: ["user", "padmin", "gadmin"],
  requiredScopes: [],
  configurable: false,
};

export default manifest;
