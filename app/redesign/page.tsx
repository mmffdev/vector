"use client";

import { Plus } from "lucide-react";
import { useShell } from "./ShellContext";

export default function RedesignLanding() {
  const { perspective, activeSection } = useShell();

  return (
    <div className="rd-page">
      <div className="rd-page__topbar">
        <nav className="rd-page__crumbs" aria-label="Breadcrumb">
          <span className="rd-page__crumb">Vector</span>
          <span className="rd-page__crumb-sep">/</span>
          <span className="rd-page__crumb rd-page__crumb--current">
            {activeSection?.name ?? perspective.name}
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
          <p className="rd-page__subtitle">
            Perspective: <strong>{perspective.name}</strong>
          </p>
        </header>

        <div className="rd-empty">
          <p>This is the redesign shell — content area.</p>
          <p className="rd-empty__hint">
            Pick a section on the left rail to switch the flyout. Pages link to existing
            URLs (they still render in the legacy shell for now).
          </p>
        </div>
      </div>

      <style jsx>{`
        .rd-page { display: flex; flex-direction: column; min-height: 100vh; }
        .rd-page__topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 32px 0;
          gap: 16px;
        }
        .rd-page__crumbs { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; }
        .rd-page__crumb { color: var(--ink-muted); }
        .rd-page__crumb--current { color: var(--ink); font-weight: 500; }
        .rd-page__crumb-sep { color: var(--ink-faint); }
        .rd-page__action {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 30px;
          padding: 0 12px;
          background: var(--surface);
          color: var(--ink);
          border: 1px solid var(--border);
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background 150ms ease;
        }
        .rd-page__action:hover { background: var(--surface-sunken); }
        .rd-page__body { padding: 24px 32px 48px; }
        .rd-page__heading { margin-bottom: 24px; }
        .rd-page__title { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 4px; }
        .rd-page__subtitle { font-size: 13px; color: var(--ink-muted); margin: 0; }
        .rd-page__subtitle strong { color: var(--ink); font-weight: 600; }
        .rd-empty {
          border: 1px solid var(--border);
          background: var(--surface);
          padding: 32px;
          color: var(--ink-muted);
          font-size: 13px;
          line-height: 1.6;
        }
        .rd-empty__hint { color: var(--ink-subtle); margin-top: 8px; }
      `}</style>
    </div>
  );
}
