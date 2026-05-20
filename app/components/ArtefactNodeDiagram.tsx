"use client";

// ArtefactNodeDiagram — full-ancestry hierarchy snapshot.
//
// Top rows: every ancestor from the topmost strategic root down to the
// immediate parent of the selected, ONE NODE PER ROW (no siblings on
// ancestor rows — the chain is 1-to-1 upwards).
// Bottom row: the selected + all its siblings (children of the
// immediate parent), wrapping to multiple rows if they overflow.
//
// Each node renders as a small chip with the type-prefix glyph and the
// `<prefix>-<key_num>` underlined link below. Clicking the link calls
// onNavigate(artefactId) so the host can re-target the surrounding
// surface (e.g. the ArtefactInlineForm re-loads with that artefact).
//
// Selected node gets the orange highlight from the form-open row
// marker so it ties visually to the surrounding form panel and the
// row above in the tree.
//
// Designed to drop into the ArtefactInlineForm under the Created /
// Last updated meta — but pure-prop, no form coupling, so it can
// stand alone on a portfolio dashboard, a sprint backlog, anywhere
// hierarchy context helps.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MdBlock } from "react-icons/md";
import { workItems, portfolioItems } from "@/app/lib/apiSite";

export interface ArtefactNodeDiagramProps {
  // The currently-focused artefact.
  artefactId: string;
  // Same as ArtefactInlineForm: "/work-items" or "/portfolio-items".
  resourceUrl: string;
  // Scope of the selected artefact. Strategic artefacts (Theme,
  // Product, Initiative, etc.) legitimately have no parent when they
  // sit at the top of the strategy ladder — so parent_id === null is
  // NOT an orphan there. Work artefacts (Task, Story, Defect, Epic,
  // Risk) should always be parented; parent_id === null implies
  // orphaned data and the diagram surfaces it in red.
  scope: "work" | "strategy";
  // parent_id on the loaded artefact. null = root. The component does
  // not re-fetch the selected itself — the host already has it loaded;
  // pass parent_id (and the slim selected refs) through so we avoid
  // duplicate round-trips.
  parentId: string | null;
  selected: NodeRef;
  // Click handler — host re-targets the surface to this id.
  onNavigate: (artefactId: string) => void;
}

export interface NodeRef {
  id: string;
  type_prefix: string;
  key_num: number;
  title: string;
  // Present on rows returned from listAncestors — used to detect the
  // top of the chain (parent_id === null means this ancestor is a
  // root; if the scope is "work" that means an orphaned subtree).
  parent_id?: string | null;
}

function pickBundle(resourceUrl: string) {
  if (resourceUrl.includes("/portfolio-items")) return portfolioItems;
  return workItems;
}

// Slim projection of the wire row — only what the diagram renders.
function asNodeRef(raw: unknown): NodeRef | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string") return null;
  return {
    id: r.id,
    type_prefix: typeof r.type_prefix === "string" ? r.type_prefix : "",
    key_num: typeof r.key_num === "number" ? r.key_num : 0,
    title: typeof r.title === "string" ? r.title : "",
    parent_id: typeof r.parent_id === "string" ? r.parent_id : r.parent_id === null ? null : undefined,
  };
}

export function ArtefactNodeDiagram({
  artefactId,
  resourceUrl,
  scope,
  parentId,
  selected,
  onNavigate,
}: ArtefactNodeDiagramProps) {
  // ancestors: immediate-parent-first chain (matches backend ordering).
  // Rendered top-down by reversing — so the topmost ancestor appears
  // at the top of the diagram and the immediate parent sits just
  // above the siblings row.
  const [ancestors, setAncestors] = useState<NodeRef[]>([]);
  const [siblings, setSiblings] = useState<NodeRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!parentId) {
      setAncestors([]);
      setSiblings([selected]);
      return;
    }
    setLoading(true);
    const bundle = pickBundle(resourceUrl);
    Promise.all([
      bundle.listAncestors(artefactId).catch(() => ({ ancestors: [] as unknown[] })),
      bundle.listChildren(parentId).catch(() => ({ items: [] as unknown[] })),
    ]).then(([anc, kids]) => {
      if (cancelled) return;
      const ancList = (anc as { ancestors?: unknown[] }).ancestors ?? [];
      setAncestors(ancList.map(asNodeRef).filter((n): n is NodeRef => n !== null));
      const list = (kids as { items?: unknown[] }).items ?? [];
      setSiblings(list.map(asNodeRef).filter((n): n is NodeRef => n !== null));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [artefactId, parentId, resourceUrl, selected]);

  // Top-down render order: topmost ancestor first, then walk down to
  // the immediate parent, then the siblings row. Backend returns
  // immediate-parent-first so we reverse here. The LAST entry in the
  // top-down chain (`immediateParent`) is the one whose branches fan
  // out to the siblings row.
  const topDown = [...ancestors].reverse();
  const immediateParent = topDown[topDown.length - 1] ?? null;
  const ancestorsAboveImmediate = topDown.slice(0, -1);

  // Work-scope prefix set — used by the orphan check + the scope
  // divider position calc below. Hard-coded set matches the
  // catalogue's work-scope types (tracked alongside
  // TD-PARENT-CANDIDATES-DYNAMIC for runtime resolution later).
  const WORK_PREFIXES = new Set(["EP", "US", "TA", "DE", "RSK"]);
  const isWorkPrefix = (prefix: string) =>
    WORK_PREFIXES.has(prefix.toUpperCase());

  // Scope divider position — walk the top-down ancestor chain and
  // find the first work-prefix entry. If NO ancestor is work-prefix
  // (e.g. selected EP whose ancestors are all strategic TH/BO/FE),
  // the divider sits between the immediate parent and the siblings
  // row — because the selected itself is the first work row.
  // firstWorkIndex of topDown.length signals "place divider just
  // before the siblings/selected row".
  let firstWorkIndex = topDown.findIndex((a) => isWorkPrefix(a.type_prefix));
  if (firstWorkIndex === -1 && isWorkPrefix(selected.type_prefix)) {
    firstWorkIndex = topDown.length;
  }
  // Show the divider when there IS a strategic layer above the work
  // layer (i.e. firstWorkIndex > 0). All-work or all-strategy chains
  // have no boundary to mark.
  const showDivider = firstWorkIndex > 0;

  // Orphan rule — a work-scope chain is orphaned only when the
  // CHAIN ROOT is itself a work-scope artefact with no parent. If
  // the chain roots into a strategic artefact (TH / BO / FE / etc.
  // with no parent), the work artefact is correctly rolled up and
  // there's no orphaning to surface.
  //
  // When the chain has no ancestors at all (selected itself is the
  // root), the same rule applies to the selected.
  const topMost = topDown[0] ?? null;
  const chainRootIsWork = topMost
    ? isWorkPrefix(topMost.type_prefix)
    : isWorkPrefix(selected.type_prefix);
  const chainRootParentId = topMost ? topMost.parent_id : parentId;
  const isOrphan =
    scope === "work" && chainRootIsWork && chainRootParentId == null;

  // Orphan render — work artefact with no ancestry. Treat the orphan
  // banner as if it were the (missing) strategic-zone content: render
  // banner → trail → ScopeDivider → trail → siblings row. Gives the
  // selected the SAME visual frame as a properly-parented artefact so
  // the user reads "this Epic should have a parent but doesn't".
  if (isOrphan) {
    return (
      <div className="artefact-node-diagram" role="img" aria-label="Orphaned artefact hierarchy">
        <div
          className="artefact-node-diagram__OrphanBanner"
          role="status"
          aria-label="This work artefact has no parent and is orphaned"
        >
          <MdBlock size={18} />
          <span>Orphaned</span>
        </div>
        <div
          className="artefact-node-diagram__Connector artefact-node-diagram__Connector--trail"
          aria-hidden="true"
        />
        <ScopeDivider />
        <div
          className="artefact-node-diagram__Connector artefact-node-diagram__Connector--trail"
          aria-hidden="true"
        />
        {/* hasParent=false: the orange trail connector above already
            joins the divider down to the siblings row, so we don't want
            BranchesAndSiblings to also draw its SVG branch — that would
            render as a second vertical line below "EXECUTION ZONE". */}
        <BranchesAndSiblings
          artefactId={artefactId}
          siblings={siblings}
          hasParent={false}
          loading={loading}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  return (
    <div className="artefact-node-diagram" role="img" aria-label="Artefact hierarchy">
      {ancestorsAboveImmediate.map((a, i) => {
        // Inject the strategy/work divider BEFORE the first work-scope
        // ancestor in the chain. When firstWorkIndex sits inside
        // ancestorsAboveImmediate the boundary is mid-chain; when it
        // equals topDown.length - 1 (the immediateParent), the
        // boundary sits between the last entry here and the immediate
        // parent — handled outside this map below.
        const dividerBeforeMe = showDivider && i === firstWorkIndex;
        return (
          <React.Fragment key={a.id}>
            {dividerBeforeMe && <ScopeDivider />}
            <div className="artefact-node-diagram__Row artefact-node-diagram__Row--ancestor">
              <NodeChip node={a} onNavigate={onNavigate} />
            </div>
            {/* Every connector in the ancestor chain wears the orange
                trail because the whole chain leads down to the selected
                artefact at the bottom. The trail terminates at the
                immediate-parent → selected branch in the SVG layer
                below (also orange). */}
            <div
              className="artefact-node-diagram__Connector artefact-node-diagram__Connector--trail"
              aria-hidden="true"
            />
          </React.Fragment>
        );
      })}
      {/* Boundary at the immediate parent — last ancestor in topDown
          is the first work row. Divider sits between the row above
          (last entry of ancestorsAboveImmediate) and the immediate
          parent. Trail line above the divider is drawn by the
          ancestor map's per-row connector; we add one BELOW the
          divider so the orange line continues into the immediate
          parent's chip. */}
      {showDivider && firstWorkIndex === topDown.length - 1 && (
        <>
          <ScopeDivider />
          <div
            className="artefact-node-diagram__Connector artefact-node-diagram__Connector--trail"
            aria-hidden="true"
          />
        </>
      )}
      {immediateParent && (
        <div className="artefact-node-diagram__Row artefact-node-diagram__Row--ancestor">
          <NodeChip node={immediateParent} onNavigate={onNavigate} />
        </div>
      )}
      {/* Boundary at the siblings row — no ancestor is a work prefix
          (every ancestor is strategic), so the selected itself is the
          first work-scope row. Divider sits between the immediate
          parent and the siblings row. Orange trail above the divider
          links the immediate parent into the band; the SVG branches
          below the divider in BranchesAndSiblings carry the line on
          to each sibling chip. */}
      {showDivider && firstWorkIndex === topDown.length && (
        <>
          <div
            className="artefact-node-diagram__Connector artefact-node-diagram__Connector--trail"
            aria-hidden="true"
          />
          <ScopeDivider />
        </>
      )}
      <BranchesAndSiblings
        artefactId={artefactId}
        siblings={siblings}
        hasParent={!!immediateParent}
        loading={loading}
        onNavigate={onNavigate}
      />
    </div>
  );
}

// BranchesAndSiblings owns the SVG branch layer + the siblings row.
// The SVG sits ABOVE the siblings row visually (in the gap between
// immediate-parent and siblings) and draws a cubic Bézier from a
// single top-centre anchor down to the top-centre of each sibling
// chip. Measurements happen after layout via useLayoutEffect so the
// paths land on the real DOM positions; a ResizeObserver triggers a
// re-measure when the container width changes (siblings wrapping to
// a new row, panel resizing). When the diagram has no parent at all
// (root artefacts) the SVG isn't drawn — siblings render as a flat
// row with no incoming branches.
function BranchesAndSiblings({
  artefactId,
  siblings,
  hasParent,
  loading,
  onNavigate,
}: {
  artefactId: string;
  siblings: NodeRef[];
  hasParent: boolean;
  loading: boolean;
  onNavigate: (id: string) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const chipRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [paths, setPaths] = useState<{ d: string; key: string; selected: boolean }[]>([]);
  const [svgSize, setSvgSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const computePaths = React.useCallback(() => {
    if (!hasParent) {
      setPaths([]);
      return;
    }
    const row = rowRef.current;
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    // SVG height equals the gap between parent row and siblings row;
    // we paint a 16px-tall layer (matches __Connector height) above
    // the siblings row.
    const svgH = 16;
    const svgW = rowRect.width;
    setSvgSize({ w: svgW, h: svgH });
    const startX = svgW / 2; // parent anchor centred above the siblings row
    const startY = 0;        // top edge of the SVG
    const next: { d: string; key: string; selected: boolean }[] = [];
    for (const [id, chip] of chipRefs.current.entries()) {
      const cr = chip.getBoundingClientRect();
      // x relative to the SVG (which spans the row's width)
      const targetX = cr.left - rowRect.left + cr.width / 2;
      const targetY = svgH; // bottom edge — touches top of the chip
      // Cubic Bézier with control points pulled vertically so the
      // line eases out of the parent straight down then curves toward
      // each sibling. Symmetrical, looks like a tree branch.
      const cp1x = startX;
      const cp1y = svgH * 0.6;
      const cp2x = targetX;
      const cp2y = svgH * 0.4;
      next.push({
        key: id,
        selected: id === artefactId,
        d: `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${targetX} ${targetY}`,
      });
    }
    setPaths(next);
  }, [hasParent, artefactId]);

  useLayoutEffect(() => {
    computePaths();
  }, [computePaths, siblings]);

  useEffect(() => {
    if (!rowRef.current) return;
    const ro = new ResizeObserver(() => computePaths());
    ro.observe(rowRef.current);
    return () => ro.disconnect();
  }, [computePaths]);

  return (
    <>
      {hasParent && (
        <svg
          className="artefact-node-diagram__Branches"
          width={svgSize.w}
          height={svgSize.h}
          viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
          aria-hidden="true"
        >
          {paths.map((p) => (
            <path
              key={p.key}
              d={p.d}
              className={
                "artefact-node-diagram__Branch" +
                (p.selected ? " artefact-node-diagram__Branch--selected" : "")
              }
              fill="none"
            />
          ))}
        </svg>
      )}
      <div
        ref={rowRef}
        className="artefact-node-diagram__Row artefact-node-diagram__Row--siblings"
      >
        {loading && siblings.length === 0 ? (
          <div className="artefact-node-diagram__Loading">Loading…</div>
        ) : (
          siblings.map((s) => (
            <div
              key={s.id}
              ref={(el) => {
                if (el) chipRefs.current.set(s.id, el);
                else chipRefs.current.delete(s.id);
              }}
            >
              <NodeChip
                node={s}
                isSelected={s.id === artefactId}
                onNavigate={onNavigate}
              />
            </div>
          ))
        )}
      </div>
    </>
  );
}

function NodeChip({
  node,
  isSelected,
  onNavigate,
}: {
  node: NodeRef;
  isSelected?: boolean;
  onNavigate: (artefactId: string) => void;
}) {
  const label = `${node.type_prefix}-${node.key_num}`;
  const className =
    "artefact-node-diagram__Chip" +
    (isSelected ? " artefact-node-diagram__Chip--selected" : "");
  return (
    <div className={className} title={node.title}>
      <span className="artefact-node-diagram__Chip_Glyph" aria-hidden="true">
        {node.type_prefix || label.slice(0, 2)}
      </span>
      <button
        type="button"
        className="artefact-node-diagram__Chip_Link"
        onClick={() => onNavigate(node.id)}
        aria-label={`Open ${label} — ${node.title}`}
      >
        {label}
      </button>
    </div>
  );
}

// ScopeDivider — visual separator between the strategy ladder above
// and the execution ladder below. Three stacked stripes:
//   ▲ orange-on-transparent /// at +45°  (strategy side, leaning right)
//   ─ thin horizontal rule
//   ▼ green-on-transparent  \\\ at -45°  (execution side, leaning left)
// All purely decorative; aria-hidden.
function ScopeDivider() {
  return (
    <div
      className="artefact-node-diagram__ScopeDivider"
      role="separator"
      aria-hidden="true"
    >
      <span className="artefact-node-diagram__ScopeDivider_Label artefact-node-diagram__ScopeDivider_Label--above">
        Strategic Zone
      </span>
      <div className="artefact-node-diagram__ScopeDivider_Stripes" />
      <span className="artefact-node-diagram__ScopeDivider_Label artefact-node-diagram__ScopeDivider_Label--below">
        Execution Zone
      </span>
    </div>
  );
}

export default ArtefactNodeDiagram;
