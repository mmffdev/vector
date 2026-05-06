"use client";

// PLA-0006 — Archive map flyout (right rail of the topology canvas).
//
// Renders the closure of archived nodes reachable from a live anchor and
// lets the user restore them one at a time. Visual style mirrors
// TopologyTreeFlyout but uses dotted SVG connectors so the eye reads
// "ghosted / not in the live tree" at a glance. Width defaults to 50%
// of the viewport, clamped to [360, 90vw], drag-resizable from the
// left edge with the same pointer-capture pattern the tree flyout uses.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  topologyApi,
  type ArchivedDescendant,
} from "@/app/lib/topologyApi";
import { useHintOnce } from "@/app/lib/hints";
import { notify } from "@/app/lib/toast";
import Panel from "@/app/components/Panel";

const STEP = 24;
const ROW_H = 48;

// A row in the rendered tree. `kind: "archived"` rows carry the original
// API record and offer a Restore action. `kind: "live"` rows are synthetic
// breadcrumbs for live intermediates that bridge an archived node back to
// the anchor — they have no Restore action and render muted.
type FlatRow =
  | {
      kind: "archived";
      id: string;
      name: string;
      node: ArchivedDescendant;
      depth: number;
      isLast: boolean;
      ancestorMore: boolean[];
    }
  | {
      kind: "live";
      id: string;
      name: string;
      depth: number;
      isLast: boolean;
      ancestorMore: boolean[];
    };

// Build a tree from the flat archived-descendant list, synthesising live
// breadcrumb rows for any intermediate live node that sits between an
// archived twig and the anchor. The API returns archived nodes whose
// `parent_id` may point to a LIVE node (e.g. anchor=Bank 1, live A in
// between, archived B); a naive walk from the anchor would orphan those
// twigs and render an empty flyout. We stitch the live ancestors using
// the parent's `liveAncestors` map so the user sees the full path.
function buildRows(
  list: ArchivedDescendant[],
  anchorId: string,
  liveAncestors: Map<string, { name: string; parentId: string | null }>,
): FlatRow[] {
  // Index every archived node by its id for fast parent-chain lookups.
  const archById = new Map<string, ArchivedDescendant>();
  for (const n of list) archById.set(n.id, n);

  // Walk each archived node up through any live intermediates until we
  // hit the anchor (or run out of ancestors). The set of "synthetic"
  // ids we need to render as live breadcrumbs is the union of those
  // intermediate ids across all archived rows.
  const synthIds = new Set<string>();
  const parentInRender = new Map<string, string>(); // childId -> renderedParentId
  for (const a of list) {
    let childId = a.id;
    let pid = a.parent_id;
    while (pid && pid !== anchorId) {
      if (archById.has(pid)) {
        parentInRender.set(childId, pid);
        childId = pid;
        pid = archById.get(pid)!.parent_id;
        continue;
      }
      const live = liveAncestors.get(pid);
      if (!live) break;
      synthIds.add(pid);
      parentInRender.set(childId, pid);
      childId = pid;
      pid = live.parentId;
    }
    // childId now hangs directly under the anchor (or its chain broke,
    // in which case it ends up as a root for safety so we never silently
    // drop a row).
    parentInRender.set(childId, anchorId);
  }

  // Group children by their resolved render-parent.
  type Entry =
    | { kind: "archived"; id: string; name: string; node: ArchivedDescendant }
    | { kind: "live"; id: string; name: string };
  const byParent = new Map<string, Entry[]>();
  const push = (parentId: string, e: Entry) => {
    if (!byParent.has(parentId)) byParent.set(parentId, []);
    byParent.get(parentId)!.push(e);
  };
  for (const a of list) {
    const p = parentInRender.get(a.id) ?? anchorId;
    push(p, { kind: "archived", id: a.id, name: a.name, node: a });
  }
  for (const sid of synthIds) {
    const live = liveAncestors.get(sid);
    if (!live) continue;
    const p = parentInRender.get(sid) ?? anchorId;
    push(p, { kind: "live", id: sid, name: live.name });
  }
  for (const arr of byParent.values()) {
    // Live placeholders sort first to read like a path; then alpha by name.
    arr.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "live" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  const out: FlatRow[] = [];
  const walk = (parentId: string, depth: number, ancestorMore: boolean[]) => {
    const kids = byParent.get(parentId) ?? [];
    kids.forEach((entry, idx) => {
      const isLast = idx === kids.length - 1;
      if (entry.kind === "archived") {
        out.push({
          kind: "archived",
          id: entry.id,
          name: entry.name,
          node: entry.node,
          depth,
          isLast,
          ancestorMore,
        });
      } else {
        out.push({
          kind: "live",
          id: entry.id,
          name: entry.name,
          depth,
          isLast,
          ancestorMore,
        });
      }
      const childKids = byParent.get(entry.id) ?? [];
      if (childKids.length === 0) return;
      const childAncestor = depth === 0 ? [] : [...ancestorMore, !isLast];
      walk(entry.id, depth + 1, childAncestor);
    });
  };
  walk(anchorId, 0, []);
  return out;
}

type ArchiveMapFlyoutProps = {
  nodeId: string;
  nodeName: string;
  onClose: () => void;
  // Called after every successful restore so the parent can refresh the
  // canvas (which trims the warning triangle once the count hits zero).
  onChange: () => void;
  // Live rollup count from the parent's tree. Re-fetching when this
  // changes keeps the flyout in sync if the user archives or restores
  // a node OUTSIDE this flyout (kebab → Delete, etc.) while the
  // flyout is still open for the same anchor.
  archivedCount: number;
  // Map of every live OrgNode in the parent's loaded tree, keyed by id.
  // Used to render breadcrumb rows for live intermediates that bridge
  // archived twigs back to the anchor (without these, archived nodes
  // whose immediate parent is live would orphan and the flyout would
  // render empty — see PLA-0006 archive-map breadcrumb fix).
  liveAncestors: Map<string, { name: string; parentId: string | null }>;
};

export default function ArchiveMapFlyout({
  nodeId,
  nodeName,
  onClose,
  onChange,
  archivedCount,
  liveAncestors,
}: ArchiveMapFlyoutProps) {
  const [list, setList] = useState<ArchivedDescendant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const [width, setWidth] = useState<number | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useHintOnce("ARCHIVE_MAP_FIRST_OPEN");

  const reload = useCallback(async () => {
    try {
      const res = await topologyApi.archivedDescendants(nodeId);
      setList(res);
      setError(null);
    } catch (err) {
      notify.apiError(err, "Failed to load archive map");
    }
  }, [nodeId]);

  // Reset list to null whenever the anchor changes so a stale render from
  // the previous anchor can never bleed through while the new fetch is in
  // flight. Without this, `buildRows(prevList, newAnchor)` would walk a
  // stale tree and momentarily show "No archived descendants".
  useEffect(() => {
    setList(null);
    setRowError(null);
  }, [nodeId]);

  useEffect(() => {
    void reload();
  }, [reload, archivedCount]);

  const onResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!asideRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const startWidth = asideRef.current.getBoundingClientRect().width;
    dragStateRef.current = { startX: e.clientX, startWidth };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onResizeMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s) return;
    // Drag handle is on the LEFT edge — moving rightward shrinks; leftward grows.
    const delta = s.startX - e.clientX;
    const min = 360;
    const max = Math.max(min, window.innerWidth * 0.9);
    const next = Math.min(max, Math.max(min, s.startWidth + delta));
    setWidth(next);
  }, []);

  const onResizeUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current) return;
    dragStateRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const rows = useMemo(
    () => (list ? buildRows(list, nodeId, liveAncestors) : []),
    [list, nodeId, liveAncestors],
  );

  const onRestore = useCallback(
    async (id: string) => {
      setBusyId(id);
      setRowError(null);
      try {
        await topologyApi.restore(id);
        notify.success("Node restored.");
        onChange();
        await reload();
      } catch (err) {
        notify.apiError(err, "Restore failed");
        const message = err instanceof Error ? err.message : "Restore failed";
        setRowError({ id, message });
      } finally {
        setBusyId(null);
      }
    },
    [onChange, reload],
  );

  const defaultWidth =
    typeof window !== "undefined" ? Math.max(360, Math.min(window.innerWidth * 0.5, window.innerWidth * 0.9)) : 480;
  const effectiveWidth = width ?? defaultWidth;

  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    el.style.setProperty("--flyout-w", `${effectiveWidth}px`);
  }, [effectiveWidth]);

  return (
    <aside
      ref={asideRef}
      className="topo-archive-map archive-flyout-w"
      role="dialog"
      aria-label={`Archived descendants of ${nodeName}`}
    >
      {/* Left-edge resize handle. */}
      <div
        className="topo-archive-map__resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize archive map"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
      >
        <span className="topo-archive-map__resize-grip" aria-hidden="true">⋮</span>
      </div>

      <header className="topo-archive-map__head">
        <div>
          <h2>Archive map</h2>
          <p className="topo-archive-map__sub" title={nodeName}>{nodeName}</p>
        </div>
        <button
          type="button"
          className="btn btn--icon btn--ghost btn--sm topo-archive-map__close"
          aria-label="Close archive map"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <Panel name="archive_map" className="panel--bare topo-archive-map__panel">
        <div className="topo-archive-map__body">
          {error && <p className="form__error">{error}</p>}
          {!error && list === null && <p className="topo-archive-map__empty">Loading…</p>}
          {!error && list !== null && rows.length === 0 && (
            <p className="topo-archive-map__empty">No archived descendants.</p>
          )}
          {rows.length > 0 && (
            <table className="table topo-archive-map__table">
              <tbody>
                {rows.map((row) => {
                  const isArchived = row.kind === "archived";
                  const restoring = isArchived && busyId === row.id;
                  const showError = isArchived && rowError && rowError.id === row.id;
                  const rowClass = isArchived
                    ? "table__row topo-archive-map__row"
                    : "table__row topo-archive-map__row topo-archive-map__row--live";
                  const parentIsArchived =
                    isArchived && row.node.parent_is_archived && row.depth > 0;
                  return (
                    <tr key={`${row.kind}:${row.id}`} className={rowClass}>
                      <td className="table__cell topo-archive-map__tag-cell">
                        <div className="topo-archive-map__tag-inner">
                          {row.depth > 0 && (() => {
                            const H = ROW_H;
                            const MID = H / 2;
                            const W = row.depth * STEP;
                            const lineX = (row.depth - 1) * STEP + STEP / 2;
                            const throughPaths: string[] = [];
                            const paths: string[] = [];
                            row.ancestorMore.forEach((cont, i) => {
                              if (cont) {
                                const x = i * STEP + STEP / 2;
                                throughPaths.push(`M${x} 0 L${x} ${H}`);
                              }
                            });
                            if (row.isLast) {
                              paths.push(`M${lineX} 0 L${lineX} ${MID} L${W} ${MID}`);
                            } else {
                              paths.push(`M${lineX} 0 L${lineX} ${H}`);
                              paths.push(`M${lineX} ${MID} L${W} ${MID}`);
                            }
                            return (
                              <svg
                                width={W}
                                height={H}
                                viewBox={`0 0 ${W} ${H}`}
                                className="topo-archive-map__svg"
                                aria-hidden="true"
                              >
                                {throughPaths.map((d, i) => (
                                  <path
                                    key={`t${i}`}
                                    d={d}
                                    stroke="var(--text-muted, #94a3b8)"
                                    strokeWidth="1.25"
                                    strokeDasharray="2 3"
                                    fill="none"
                                    strokeLinecap="round"
                                  />
                                ))}
                                {paths.map((d, i) => (
                                  <path
                                    key={`c${i}`}
                                    d={d}
                                    stroke="var(--text-muted, #94a3b8)"
                                    strokeWidth="1.25"
                                    strokeDasharray="2 3"
                                    fill="none"
                                    strokeLinecap="round"
                                  />
                                ))}
                              </svg>
                            );
                          })()}
                          <span className="topo-archive-map__name" title={row.name}>
                            {row.name}
                          </span>
                          {isArchived ? (
                            <span className="topo-archive-map__when" aria-label="Archived at">
                              {formatWhen(row.node.archived_at)}
                            </span>
                          ) : (
                            <span
                              className="topo-archive-map__when topo-archive-map__live-tag"
                              aria-label="Live ancestor"
                              title="Live node — shown to provide context for archived descendants below"
                            >
                              live
                            </span>
                          )}
                        </div>
                        {showError && (
                          <p className="topo-archive-map__row-err">
                            {restorePrettyError(rowError!.message)}
                          </p>
                        )}
                      </td>
                      <td className="table__cell topo-archive-map__action-cell">
                        {isArchived && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--xs topo-archive-map__restore-btn"
                            disabled={restoring || parentIsArchived}
                            title={
                              parentIsArchived
                                ? "Restore the archived parent first"
                                : "Restore this node"
                            }
                            onClick={() => void onRestore(row.id)}
                          >
                            {restoring ? "Restoring…" : "Restore"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Panel>
    </aside>
  );
}

// Pretty-print API errors that come back as raw fetch text. The backend
// returns JSON for 409s ({"error":"parent_archived"} etc.) and plain
// text for other failures; the api() helper bubbles up the Response
// body verbatim, so we sniff for the well-known JSON shapes.
function restorePrettyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("parent_archived")) {
    return "Original parent is archived — restore it first, or move this node under a live parent.";
  }
  if (lower.includes("parent_missing")) {
    return "Original parent no longer exists. Pick a live parent and try again.";
  }
  if (lower.includes("not_archived")) {
    return "Already restored. Refreshing…";
  }
  return raw;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}
