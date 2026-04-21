"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, type Role } from "@/app/contexts/AuthContext";

interface NavItem {
  label: string;
  href: string;
  roles: Role[];
  icon: React.ReactNode;
}

const Icon = ({ d, d2 }: { d: string; d2?: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
    {d2 && <path d={d2} />}
  </svg>
);

const navItems: NavItem[] = [
  {
    label: "Dashboard", href: "/dashboard", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" d2="M9 22V12h6v10" />,
  },
  {
    label: "Backlog", href: "/backlog", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 12h6M9 16h4" />,
  },
  {
    label: "Planning", href: "/planning", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  },
  {
    label: "Risk", href: "/risk", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" d2="M12 9v4M12 17h.01" />,
  },
];

const adminItems: NavItem[] = [
  {
    label: "Settings", href: "/admin", roles: ["padmin", "gadmin"],
    icon: <Icon d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />,
  },
];

const devItems: NavItem[] = [
  {
    label: "Dev Setup", href: "/dev", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />,
  },
];

export default function AppSidebar_2() {
  const pathname = usePathname();
  const { user } = useAuth();
  if (!user) return null;
  const role = user.role;

  const visibleNavItems = navItems.filter((item) => item.roles.includes(role));
  const visibleAdminItems = adminItems.filter((item) => item.roles.includes(role));
  const visibleDevItems = devItems.filter((item) => item.roles.includes(role));

  return (
    <sideBar_2 className="app-sidebar-container">
      <div className="sidebar-section">Workspace</div>
      {visibleNavItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`sidebar-item ${pathname.includes(item.href) ? "active" : ""}`}
        >
          {item.icon}{item.label}
        </Link>
      ))}

      {visibleAdminItems.length > 0 && (
        <>
          <div className="sidebar-section">Admin</div>
          {visibleAdminItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item ${pathname === item.href ? "active" : ""}`}
            >
              {item.icon}{item.label}
            </Link>
          ))}
        </>
      )}

      {visibleDevItems.length > 0 && (
        <div className="sidebar-dev-group">
          <div className="sidebar-section">Dev</div>
          {visibleDevItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`sidebar-item ${pathname.includes(item.href) ? "active" : ""}`}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </sideBar_2>
  );
}
