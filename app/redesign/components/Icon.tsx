"use client";

import {
  LayoutDashboard,
  Compass,
  ListTree,
  Kanban,
  FolderTree,
  Network,
  FlaskConical,
  Settings,
  Users,
  ShieldCheck,
  Library,
  BookOpen,
  Star,
  BarChart3,
  Activity,
  GitBranch,
  Wrench,
  Bell,
  Search,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import type { IconKey } from "@/app/lib/nav-v2";

const MAP: Record<IconKey, LucideIcon> = {
  LayoutDashboard,
  Compass,
  ListTree,
  Kanban,
  FolderTree,
  Network,
  FlaskConical,
  Settings,
  Users,
  ShieldCheck,
  Library,
  BookOpen,
  Star,
  BarChart3,
  Activity,
  GitBranch,
  Wrench,
  Bell,
  Search,
  UserCircle,
};

interface IconProps {
  name: IconKey;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export default function Icon({ name, size = 20, strokeWidth = 1.75, className }: IconProps) {
  const C = MAP[name];
  if (!C) return null;
  return <C size={size} strokeWidth={strokeWidth} className={className} />;
}
