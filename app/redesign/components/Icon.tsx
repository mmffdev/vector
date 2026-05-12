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
import { TbHome } from "react-icons/tb";
import {
  MdOutlinePersonOutline,
  MdOutlineAdminPanelSettings,
  MdOutlineViewTimeline,
} from "react-icons/md";
import { BsGraphUpArrow } from "react-icons/bs";
import type { IconType } from "react-icons";
import type { IconKey } from "@/app/lib/nav-v2";

const LUCIDE: Partial<Record<IconKey, LucideIcon>> = {
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

const REACT_ICONS: Partial<Record<IconKey, IconType>> = {
  TbHome,
  MdOutlinePersonOutline,
  MdOutlineAdminPanelSettings,
  MdOutlineViewTimeline,
  BsGraphUpArrow,
};

interface IconProps {
  name: IconKey;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export default function Icon({ name, size = 20, strokeWidth = 1.75, className }: IconProps) {
  const L = LUCIDE[name];
  if (L) return <L size={size} strokeWidth={strokeWidth} className={className} />;
  const R = REACT_ICONS[name];
  if (R) return <R size={size} className={className} aria-hidden />;
  return null;
}
