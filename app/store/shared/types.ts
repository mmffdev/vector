import type { Role } from "@/app/contexts/AuthContext";

export interface UiAppManifest {
  id: string;
  name: string;
  description: string;
  icon: string;
  version: string;
  author: string;
  category: "dashboard" | "planning" | "reporting" | "integration" | "utility" | "custom";
  defaultSize: { w: number; h: number };
  minSize?: { w: number; h: number };
  maxSize?: { w: number; h: number };
  allowedRoles: Role[];
  requiredScopes?: string[];
  configurable?: boolean;
}

export interface UiAppProps {
  appId: string;
  config?: Record<string, unknown>;
  onConfigChange?: (config: Record<string, unknown>) => void;
}
