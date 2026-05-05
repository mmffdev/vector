"use client";

// PLA-0006/00332 — top toolbar lifted out of page.tsx so the page body
// owns state + canvas only. Pure presentational: every interactive
// control fires a callback supplied by the parent.

import { BsArrowsFullscreen, BsFullscreenExit } from "react-icons/bs";
import ToggleBtnN from "@/app/components/ToggleBtnN";
import type { Workspace } from "@/app/lib/workspacesApi";
import type { RankDir, EdgeKind, CanvasMode } from "./types";

export function TopologyToolbar({
  tenantName,
  workspaces,
  wsRef,
  onWorkspaceChange,
  canvasMode,
  onCanvasModeChange,
  rankdir,
  onRankdirChange,
  edgeKind,
  onEdgeKindChange,
  onResetView,
  expanded,
  onToggleExpanded,
  onFinish,
}: {
  tenantName: string;
  workspaces: Workspace[] | null;
  wsRef: string | null;
  onWorkspaceChange: (next: string) => void;
  canvasMode: CanvasMode;
  onCanvasModeChange: (next: CanvasMode) => void;
  rankdir: RankDir;
  onRankdirChange: (next: RankDir) => void;
  edgeKind: EdgeKind;
  onEdgeKindChange: (next: EdgeKind) => void;
  onResetView: () => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  onFinish: () => void;
}) {
  return (
    <header className="topo-overlay__bar">
      <div className="topo-overlay__title">
        <span className="topo-overlay__brand">Vector</span>
        <span className="topo-overlay__sep">/</span>
        <span>{tenantName}</span>
        <span className="topo-overlay__sep">/</span>
        <strong>Topology</strong>
      </div>
      <div className="topo-overlay__actions">
        {workspaces && workspaces.length > 1 && (
          <select
            className="form__select form__select--sm topo-overlay__ws-select"
            aria-label="Switch workspace"
            value={wsRef ?? ""}
            onChange={(e) => onWorkspaceChange(e.target.value)}
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <ToggleBtnN
          ariaLabel="Authoring mode"
          size="sm"
          value={canvasMode}
          onChange={onCanvasModeChange}
          className="topo-overlay__mode-toggle"
          options={[
            { value: "sandbox", label: "Sandbox", title: "Practice / plan changes without affecting the live topology" },
            { value: "live", label: "Live", title: "Edit the live topology that drives the rest of the app" },
          ]}
        />
        <ToggleBtnN
          ariaLabel="Layout direction"
          size="sm"
          value={rankdir}
          onChange={onRankdirChange}
          options={[
            { value: "TB", label: "TB", title: "Top-to-bottom layout" },
            { value: "LR", label: "LR", title: "Left-to-right layout" },
          ]}
        />
        <ToggleBtnN
          ariaLabel="Edge style"
          size="sm"
          value={edgeKind}
          onChange={onEdgeKindChange}
          options={[
            { value: "default", label: "Curved", title: "Curved (parabolic) connectors" },
            { value: "step", label: "Orthogonal", title: "Orthogonal (right-angle) connectors" },
            { value: "straight", label: "Straight", title: "Straight diagonal connectors" },
          ]}
        />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={onResetView}
          title="Fit all nodes in view"
        >
          Reset view
        </button>
        <button
          type="button"
          className="btn btn--icon btn--sm btn--ghost"
          onClick={onToggleExpanded}
          title={expanded ? "Collapse to embedded view" : "Expand to fill the screen"}
          aria-label={expanded ? "Collapse to embedded view" : "Expand to fill the screen"}
        >
          {expanded ? <BsFullscreenExit aria-hidden="true" /> : <BsArrowsFullscreen aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm topo-overlay__finish"
          onClick={onFinish}
        >
          Finish
        </button>
      </div>
    </header>
  );
}
