"use client";

// Flow States v2 — Orbit PoC.
// Thin wrapper around <CircularAdditor>. The rail + canvas
// sub-panel, its geometry, anchor logic and SVG decoration all live in the
// reusable component under
// app/components/catalogue/c_circular_additor/.

import { useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import CircularAdditor, {
  type OrbitItem,
} from "@/app/components/catalogue/c_circular_additor/circularAdditor";
import { usePageTitle } from "@/app/hooks/usePageTitle";

const SEED: OrbitItem[] = [
  { id: "n-backlog",   label: "Backlog",   colour: "#ef4444" },
  { id: "n-todo",      label: "To Do",     colour: "#f97316" },
  { id: "n-doing",     label: "Doing",     colour: "#eab308" },
  { id: "n-completed", label: "Completed", colour: "#3b82f6" },
  { id: "n-accepted",  label: "Accepted",  colour: "#94a3b8" },
];

export default function FlowStatesV2OrbitPocPage() {
  const { full } = usePageTitle();
  // Remount key forces the component to reseed from `defaultItems`.
  const [resetKey, setResetKey] = useState(0);
  // Mirror of the component's item count, so the toolbar pill stays in sync.
  // Lives at the page level because the toolbar is page chrome, not component chrome.
  const [count, setCount] = useState(SEED.length);

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Configure flow states for the v2 workflow engine." />
      <Panel
        name="panel_flow_states_v2_header"
        className="page-panel-heading"
        title="Flow States (v2)"
        description="Define and manage flow states used by the v2 workflow engine for work item progression."
      />
      <div className="settings-panel settings-panel--wide">
        <Panel name="orbit_poc" title="Orbit PoC — Add / Remove States" helpable={false}>
          <p className="form__hint" style={{ marginBottom: "var(--space-4)" }}>
            Click any <strong>+</strong> between two states to insert a new state at that
            angle. The other states animate to their new evenly-spaced positions. Click a
            state node (or any rail row on the left) to remove it. Two <strong>+</strong>
            slots sit between the last and first state so you can insert before the first
            or after the last.
          </p>

          <div className="orbit-poc__toolbar">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                setResetKey((k) => k + 1);
                setCount(SEED.length);
              }}
            >
              Reset to seed ({SEED.length} states)
            </button>
            <span className="orbit-poc__count">
              {count} state{count === 1 ? "" : "s"} on orbit
            </span>
          </div>

          <CircularAdditor
            key={resetKey}
            defaultItems={SEED}
            onInsert={() => setCount((c) => c + 1)}
            onRemove={() => setCount((c) => Math.max(0, c - 1))}
          />
        </Panel>
      </div>

      <style jsx>{`
        .orbit-poc__toolbar {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          margin-bottom: var(--space-4);
        }
        .orbit-poc__count {
          font-size: 0.85rem;
          color: var(--ink-muted);
        }
      `}</style>
    </PageContent>
  );
}
