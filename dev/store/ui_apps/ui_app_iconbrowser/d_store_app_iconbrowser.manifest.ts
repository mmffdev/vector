import type { UiAppManifest } from "@/app/store/shared/types";

const manifest: UiAppManifest = {
  id: "ui_app_iconbrowser",
  name: "Icon Browser",
  description: "Browse all installed icon packs — Lucide, Heroicons, Feather, Iconoir, react-icons",
  icon: "square",
  version: "0.1.0",
  author: "MMFFDev",
  category: "utility",
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 4 },
  allowedRoles: ["gadmin"],
  requiredScopes: [],
  configurable: false,
};

export default manifest;
