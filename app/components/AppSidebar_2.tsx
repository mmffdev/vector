"use client";

import React, { useEffect, useState } from "react";
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
    label: "My Vista", href: "/my-vista", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" d2="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  },
  {
    label: "Portfolio", href: "/portfolio", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" d2="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />,
  },
  {
    label: "Favourites", href: "/favourites", roles: ["user", "padmin", "gadmin"],
    icon: <Icon d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />,
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

const STORAGE_KEY = "sidebar-collapsed";

export default function AppSidebar_2() {
  const pathname = usePathname();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [peeked, setPeeked] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "true") setCollapsed(true);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-sidebar-collapsed", collapsed ? "true" : "false");
    localStorage.setItem(STORAGE_KEY, collapsed ? "true" : "false");
  }, [collapsed]);

  useEffect(() => {
    document.documentElement.setAttribute("data-sidebar-peeked", peeked ? "true" : "false");
  }, [peeked]);

  if (!user) return null;
  const role = user.role;

  const visibleNavItems = navItems.filter((item) => item.roles.includes(role));
  const visibleAdminItems = adminItems.filter((item) => item.roles.includes(role));
  const visibleDevItems = devItems.filter((item) => item.roles.includes(role));

  const open = !collapsed || peeked;

  const renderItem = (item: NavItem, exact = false) => (
    <Link
      key={item.href}
      href={item.href}
      className={`sidebar-item ${(exact ? pathname === item.href : pathname.includes(item.href)) ? "active" : ""}`}
      title={!open ? item.label : undefined}
    >
      {item.icon}
      <span className="sidebar-item__label">{item.label}</span>
    </Link>
  );

  return (
    <nav
      id="app-sidebar-nav"
      aria-label="Primary"
      className="app-sidebar-container"
      data-collapsed={collapsed ? "true" : "false"}
      data-open={open ? "true" : "false"}
      onMouseEnter={() => { if (collapsed) setPeeked(true); }}
      onMouseLeave={() => { if (peeked) setPeeked(false); }}
      onFocus={() => { if (collapsed) setPeeked(true); }}
      onBlur={(e) => { if (peeked && !e.currentTarget.contains(e.relatedTarget as Node)) setPeeked(false); }}
    >
      <button
        type="button"
        className="sidebar-collapse-toggle"
        onClick={() => {
          setCollapsed((c) => !c);
          setPeeked(false);
        }}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar-nav"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {visibleNavItems.map((item) => renderItem(item))}
      {visibleAdminItems.map((item) => renderItem(item, true))}

      {visibleDevItems.length > 0 && (
        <div className="sidebar-dev-group">
          {visibleDevItems.map((item) => renderItem(item))}
        </div>
      )}
    </nav>
  );
}
