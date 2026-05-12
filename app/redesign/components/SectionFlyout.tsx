"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useShell } from "../ShellContext";
import { useNavOrderedPerspectives } from "../useNavOrderedPerspectives";
import { flattenSectionPages, type NavPage } from "@/app/lib/nav-v2";
import Icon from "./Icon";

export default function SectionFlyout() {
  const { perspective, activeSection, setPerspectiveId } = useShell();
  const filteredPerspectives = useNavOrderedPerspectives();
  const pathname = usePathname() ?? "";
  const [query, setQuery] = useState("");

  const filterPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (pages: NavPage[]) =>
      q ? pages.filter((p) => p.name.toLowerCase().includes(q)) : pages;
  }, [query]);

  if (!activeSection) return <aside className="rd-flyout" aria-label="Section" />;

  const placeholder = `Search ${activeSection.name.toLowerCase()}…`;
  const allPages = flattenSectionPages(activeSection);
  const isActivePage = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className="rd-flyout" aria-label={`${activeSection.name} pages`}>
      <h3 className="rd-flyout__title">{activeSection.name}</h3>

      <label className="rd-flyout__search">
        <Search size={14} strokeWidth={1.75} className="rd-flyout__search-icon" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="rd-flyout__search-input"
          aria-label={placeholder}
        />
      </label>

      <div className="rd-flyout__list">
        {activeSection.groups ? (
          activeSection.groups.map((g) => {
            const pages = filterPages(g.pages);
            if (pages.length === 0) return null;
            return (
              <div key={g.id} className="rd-flyout__group">
                <div className="rd-flyout__group-label">{g.name}</div>
                {pages.map((p) => (
                  <PageRow key={p.id} page={p} active={isActivePage(p.href)} />
                ))}
              </div>
            );
          })
        ) : (
          <div className="rd-flyout__group">
            {filterPages(allPages).map((p) => (
              <PageRow key={p.id} page={p} active={isActivePage(p.href)} />
            ))}
          </div>
        )}
      </div>

      <div className="rd-flyout__seg" role="tablist" aria-label="Switch perspective">
        {filteredPerspectives.map((p) => {
          const active = p.id === perspective.id;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`rd-flyout__seg-btn${active ? " is-active" : ""}`}
              onClick={() => setPerspectiveId(p.id)}
              title={p.name}
            >
              {p.initials}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function PageRow({ page, active }: { page: NavPage; active: boolean }) {
  return (
    <Link
      href={page.href}
      className={`rd-flyout__row${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {page.icon ? <Icon name={page.icon} size={14} /> : <span className="rd-flyout__row-dot" />}
      <span className="rd-flyout__row-label">{page.name}</span>
    </Link>
  );
}
