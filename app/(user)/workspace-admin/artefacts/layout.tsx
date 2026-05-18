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
                className={`rd-flyout__row rd-flyout__row--button${pathname.startsWith(href) ? " is-active" : ""}`}
              >
                <span className="rd-flyout__row-label">{label}</span>
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
