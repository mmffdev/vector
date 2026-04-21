import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { UiAppManifest, UiAppProps } from "./shared/types";

import nameManifest from "./ui_apps/ui_app_name/c_store_app_name.manifest";

export interface RegistryEntry {
  manifest: UiAppManifest;
  component: ComponentType<UiAppProps>;
}

export const appRegistry: Record<string, RegistryEntry> = {
  [nameManifest.id]: {
    manifest: nameManifest,
    component: dynamic(() => import("./ui_apps/ui_app_name/c_store_app_name-index"), {
      loading: () => null,
      ssr: false,
    }),
  },
};

export function listAppsForRole(role: string): UiAppManifest[] {
  return Object.values(appRegistry)
    .map((e) => e.manifest)
    .filter((m) => m.allowedRoles.includes(role as never));
}
