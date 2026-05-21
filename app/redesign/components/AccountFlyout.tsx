"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell } from "../ShellContext";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";

export default function AccountFlyout() {
  const { user } = useAuth();
  const { accountSection } = useShell();
  const pathname = usePathname() ?? "";

  if (!user) return <aside className="rail-2" aria-label="Account" />;

  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="rail-2" aria-label="Account">
      <div className="rail-2__header header-band">
        <h3 className="rail-2__title">Account</h3>
      </div>

      <div className="rail-2__content">
        <div className="rail-2__top">
          <div className="rail-2__account-card">
            <div className="rail-2__account-card_Email">{user.email}</div>
            <div className="rail-2__account-card_Role">{user.role.label}</div>
          </div>

          {accountSection && accountSection.pages.length > 0 && (
            <div className="rail-2__nav">
              {accountSection.pages.map((page) => {
                const active = isActivePage(page.href);
                return (
                  <div
                    key={page.itemKey}
                    className={`rail-2__nav-row${active ? " is-active" : ""}`}
                  >
                    <Link
                      href={page.href}
                      className="rail-2__nav-row_link"
                      aria-current={active ? "page" : undefined}
                    >
                      <span className="rail-2__nav-row_icon">
                        <NavIcon iconKey={page.icon} />
                      </span>
                      <span className="rail-2__nav-row_label">{page.name}</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
