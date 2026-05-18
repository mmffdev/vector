"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Artefact Types",   href: "/workspace-admin/artefacts/artefact-types" },
  { label: "Transition Rules", href: "/workspace-admin/artefacts/transition-rules" },
  { label: "Flow States",      href: "/workspace-admin/artefacts/flow-states-v2"  },
] as const;

export default function ArtefactsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="anav-layout">
      <nav className="anav" aria-label="Artefacts sections">
        <ul className="anav__list" role="list">
          {NAV_ITEMS.map(({ label, href }) => (
            <li key={href}>
              <Link
                href={href}
                className={`sidebar-item sidebar-item--button${pathname.startsWith(href) ? " active" : ""}`}
              >
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="anav-content">
        {children}
      </div>
    </div>
  );
}
