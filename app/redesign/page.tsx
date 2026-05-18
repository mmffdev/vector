"use client";

import { Plus } from "lucide-react";
import { useShell } from "./ShellContext";

export default function RedesignLanding() {
  const { activeSection } = useShell();

  return (
    <div className="rd-page">
      <div className="rd-page__topbar">
        <nav className="rd-page__crumbs" aria-label="Breadcrumb">
          <span className="rd-page__crumb">Vector</span>
          <span className="rd-page__crumb-sep">/</span>
          <span className="rd-page__crumb rd-page__crumb--current">
            {activeSection?.name ?? "Vector"}
          </span>
        </nav>
        <button type="button" className="rd-page__action">
          <Plus size={16} strokeWidth={1.75} />
          <span>New</span>
        </button>
      </div>

      <div className="rd-page__body">
        <header className="rd-page__heading">
          <h1 className="rd-page__title">{activeSection?.name ?? "Welcome"}</h1>
        </header>

        <div className="rd-empty">
          <p>This is the redesign shell — content area.</p>
          <p className="rd-empty__hint">
            Pick a section on the left rail to switch the flyout. Pages link to existing
            URLs (they still render in the legacy shell for now).
          </p>
        </div>
      </div>

    </div>
  );
}
