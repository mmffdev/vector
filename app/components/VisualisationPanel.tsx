"use client";

// <VisualisationPanel> — three-panel composite that sits below the
// PageSummaryHeader on /work-items, /portfolio-items, /risk:
//
//   1. Action panel (no title, flush against summary). Three .btn-primitive
//      toggles (aria-pressed driven) — Charts (toggles the chart flyout),
//      and two stubs.
//   2. Visualisation panel (titled). Slides 0 → 150px when Charts is
//      armed; pushes ObjectTree down via normal block flow.
//
// Charts surface: C-02 FillPetalEqualChart, one petal per artefact type
// breakdown, max = total (the reference for the petal radii — total has
// no petal of its own). Per-type counts come from the page's existing
// summary payload (no new wire calls). When `byType` is empty (e.g.
// summary still loading or no types in scope), the panel renders an
// empty state rather than a half-shape.

import { useMemo, useState } from "react";
import { MdAdd, MdAccountTree } from "react-icons/md";
import Panel from "@/app/components/Panel";
import FillPetalEqualChart, {
  type FillPetalEqual,
} from "@/app/components/FillPetalEqualChart";
import ArtefactTree from "@/app/components/ArtefactTree";
import BlankCanvasOverlay from "@/app/components/BlankCanvasOverlay";

export interface VisualisationPanelProps {
  // Explicit petal set, in render order. Each entry defines a slot;
  // missing keys in `byType` resolve to 0, so every declared key gets
  // a petal regardless of count. Lets the parent (which knows the
  // wizard sidecar's createableTypeSlots) own the contract — same
  // source as the summary cells, so the two strips can't drift.
  petalKeys: Array<{ key: string; label: string }>;
  // Per-key counts. Key matches petalKeys[i].key (e.g. lowercase
  // artefact name like "epic" / "task" for work-items, or severity
  // buckets like "critical" / "high" for /risk).
  byType: Record<string, number>;
  // Total count — used as the petal-radius reference. Each petal's fill
  // ratio = count / total. Total is NOT a petal itself.
  total: number;
  // Per-page localstorage / addressable namespace. Used to keep the
  // child panel names unique when this component is mounted on more
  // than one page in the same session.
  pageKey: string;
  // Endpoint the <ArtefactTree> flyout walks. "/portfolio-items" for
  // strategy scope, "/work-items" for work scope. Default keeps the
  // /portfolio-items page's existing behaviour.
  treeResourceUrl?: string;
}

export default function VisualisationPanel({
  petalKeys,
  byType,
  total,
  pageKey,
  treeResourceUrl = "/portfolio-items",
}: VisualisationPanelProps) {
  const [chartsOpen, setChartsOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [canvasOpen, setCanvasOpen] = useState(false);

  // One petal per declared key. Missing key in byType → value 0; the
  // petal still renders so the chart's slot layout matches the
  // summary-strip cell layout even when a bucket is empty. Slot angle
  // (360°/N) is driven by petalKeys.length, not by which petals have
  // data, so the geometry stays stable as counts change.
  const petals = useMemo<FillPetalEqual[]>(() => {
    return petalKeys.map(({ key, label }) => ({
      label,
      value: byType[key] ?? 0,
    }));
  }, [petalKeys, byType]);

  const chartReady = petals.length > 0;

  return (
    <>
      <Panel
        name={`panel_${pageKey}_visualisation_actions`}
        className="viz-actions-panel"
        helpable={false}
      >
        <div className="viz-actions" role="toolbar" aria-label="Visualisation actions">
          <button
            type="button"
            className="btn"
            aria-pressed={chartsOpen}
            aria-expanded={chartsOpen}
            onClick={() => setChartsOpen((v) => !v)}
          >
            <span className="btn__icon">
              <MdAdd size={14} />
            </span>
            <span>Charts</span>
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={treeOpen}
            aria-expanded={treeOpen}
            onClick={() => setTreeOpen((v) => !v)}
          >
            <span className="btn__icon">
              <MdAccountTree size={14} />
            </span>
            <span>Tree</span>
          </button>
          <button
            type="button"
            className="btn"
            aria-pressed={canvasOpen}
            aria-expanded={canvasOpen}
            onClick={() => setCanvasOpen((v) => !v)}
          >
            <span className="btn__icon">
              <MdAdd size={14} />
            </span>
            <span>Canvas</span>
          </button>
        </div>
      </Panel>

      {chartsOpen && (
        <section className="viz-flyout" data-open="true">
          <Panel
            name={`panel_${pageKey}_visualisation`}
            className="viz-flyout-panel"
            title="Visualisation"
            helpable={false}
          >
            <div className="viz-flyout__body">
              {chartReady ? (
                <FillPetalEqualChart petals={petals} max={Math.max(1, total)} />
              ) : (
                <p className="viz-flyout__empty">No data to visualise yet.</p>
              )}
            </div>
          </Panel>
        </section>
      )}

      {/* Tree is overlay-only: when treeOpen flips true, ArtefactTree
          mounts in forceExpanded mode and renders its own fixed
          page-shell overlay. No inline panel chrome ever appears here. */}
      {treeOpen && (
        <ArtefactTree
          pageKey={pageKey}
          resourceUrl={treeResourceUrl}
          forceExpanded
          onRequestClose={() => setTreeOpen(false)}
        />
      )}

      {canvasOpen && (
        <BlankCanvasOverlay onRequestClose={() => setCanvasOpen(false)} />
      )}
    </>
  );
}
