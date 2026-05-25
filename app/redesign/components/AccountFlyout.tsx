"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useShell } from "../ShellContext";
import { useSentinel } from "@/app/sentinel";
import { NavIcon } from "@/app/components/nav_primary_rail_NavPageIcons";
import { BookmarkBucket, isDevPath } from "./nav_primary_rail_2";

function formatNow(d: Date): string {
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date} · ${time}`;
}

export default function AccountFlyout() {
  const { user } = useAuth();
  const { accountSection, bookmarkPages } = useShell();
  const { sentinel_grants, sentinel_focus_node } = useSentinel();
  const pathname = usePathname() ?? "";
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!user) return <aside className="rail-2" aria-label="Account" />;

  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");

  // Rail-2 title MUST show the focused topology-node name (Sentinel scope
  // label) — never the page/section title. AccountFlyout follows the same
  // rule as SectionFlyout / ScopeFlyout for consistency across every
  // rail-2 surface.
  const activeGrant = sentinel_grants.find((g) => g.node_id === sentinel_focus_node) ?? null;
  const scopeLabel = activeGrant
    ? (activeGrant.label_override?.trim() || activeGrant.name)
    : null;

  return (
    <aside className="rail-2" aria-label="Account">
      <div className="rail-2__header header-band">
        <h3 className="rail-2__title">{scopeLabel ?? ""}</h3>
        <p className="rail-2__date" aria-live="off">{formatNow(now)}</p>
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

          {!isDevPath(pathname) && (
            <BookmarkBucket
              bookmarkPages={bookmarkPages}
              isActivePage={isActivePage}
              activeKey={bookmarkPages.find((p) => isActivePage(p.href))?.itemKey ?? null}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
