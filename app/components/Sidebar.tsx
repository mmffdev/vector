"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth, type Role } from "@/app/contexts/AuthContext";

interface NavItem {
  label: string;
  href: string;
  roles: Role[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", roles: ["user", "padmin", "gadmin"] },
  { label: "Backlog", href: "/backlog", roles: ["user", "padmin", "gadmin"] },
  { label: "Planning", href: "/planning", roles: ["user", "padmin", "gadmin"] },
  { label: "Risk", href: "/risk", roles: ["user", "padmin", "gadmin"] },
];

const adminItems: NavItem[] = [
  { label: "Settings", href: "/admin", roles: ["padmin", "gadmin"] },
];

const devItems: NavItem[] = [
  { label: "Dev Setup", href: "/dev", roles: ["user", "padmin", "gadmin"] },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  if (!user) return null;
  const role = user.role;

  const visibleNavItems = navItems.filter((item) => item.roles.includes(role));
  const visibleAdminItems = adminItems.filter((item) => item.roles.includes(role));
  const visibleDevItems = devItems.filter((item) => item.roles.includes(role));

  return (
    <aside className="sidebar">
      <div className="sidebar-section">Workspace</div>
      {visibleNavItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`sidebar-item ${pathname.includes(item.href) ? "active" : ""}`}
        >
          {item.label}
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
              {item.label}
            </Link>
          ))}
        </>
      )}

      {visibleDevItems.length > 0 && (
        <>
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
        </>
      )}
    </aside>
  );
}
