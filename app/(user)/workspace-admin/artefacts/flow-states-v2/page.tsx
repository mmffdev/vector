"use client";

// Flow States v2 — Orbit visualisation across every artefact type.
//
// Mirrors the structure of /workspace-admin/flow-states (Work Types +
// Strategy Types grouped sections) but renders the flow as a <CircularAdditor>
// orbit per flow instead of the linear pill list. Insert/remove actions
// persist to the same backend (flowStatesApi.createState / deleteState) so
// the v2 orbit and the v1 pill editor stay in sync.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { notify } from "@/app/lib/toast";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import PageAnchorNav, { type AnchorNavItem } from "@/app/components/PageAnchorNav";
import CircularAdditor, {
  type OrbitItem,
} from "@/app/components/catalogue/c_circular_additor/circularAdditor";
import {
  flowStatesApi,
  type FlowGroup,
  type FlowState,
  type FlowsResponse,
} from "@/app/lib/flowStatesApi";
import { usePageTitle } from "@/app/hooks/usePageTitle";

// Kind → fallback stroke when the state has no custom colour. Mirrors the
// palette used by /flow-states so both pages render the same colour story.
const KIND_STROKE: Record<string, string> = {
  backlog:     "#cbd5e1",
  todo:        "#94a3b8",
  in_progress: "#93c5fd",
  done:        "#86efac",
  accepted:    "#d8b4fe",
  cancelled:   "#fca5a5",
};

function stateToOrbit(s: FlowState): OrbitItem {
  return {
    id: s.id,
    label: s.name,
    colour: s.colour ?? (KIND_STROKE[s.kind] ?? "#94a3b8"),
  };
}

// Mirror /flow-states: infer a sensible kind for a new state inserted
// between left/right neighbours so the new pill sits in the right band.
const KIND_ORDER: Record<string, number> = {
  backlog: 0,
  todo: 1,
  in_progress: 2,
  done: 3,
  accepted: 4,
  cancelled: 5,
};
const KIND_KEYS = ["backlog", "todo", "in_progress", "done", "accepted", "cancelled"];

function inferKind(left: FlowState | null, right: FlowState | null): string {
  if (!left) return right?.kind ?? "todo";
  if (!right) return left?.kind ?? "in_progress";
  const l = KIND_ORDER[left.kind] ?? 1;
  const r = KIND_ORDER[right.kind] ?? 1;
  if (r > l) {
    const mid = Math.round((l + r) / 2);
    return KIND_KEYS[mid] ?? left.kind;
  }
  return left.kind;
}

function groupByType(groups: FlowGroup[]): Map<string, { name: string; flows: FlowGroup[] }> {
  const map = new Map<string, { name: string; flows: FlowGroup[] }>();
  for (const g of groups) {
    if (!map.has(g.type_id)) map.set(g.type_id, { name: g.type_name, flows: [] });
    map.get(g.type_id)!.flows.push(g);
  }
  return map;
}

interface PendingInsert {
  insertAt: number;
  name: string;
}

function FlowOrbit({ group }: { group: FlowGroup }) {
  // Local mirror of the flow's states. Initialised from the parent's prop
  // and re-synced whenever the parent reloads (sort-key bumps the deps).
  const [states, setStates] = useState<FlowState[]>(group.states);
  const [pending, setPending] = useState<PendingInsert | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setStates(group.states);
  }, [group.states]);

  useEffect(() => {
    if (pending) nameRef.current?.focus();
  }, [pending?.insertAt]);

  const items: OrbitItem[] = useMemo(() => states.map(stateToOrbit), [states]);

  const handleInsert = useCallback((insertAt: number /*, angle: number*/) => {
    // CircularAdditor's `insertAt` is 0..N (where N = states.length).
    // Capture it and open the naming bar — the API call fires on commit so
    // the user can choose the new state's name (no browser prompt).
    setPending({ insertAt, name: "" });
  }, []);

  const commitInsert = useCallback(async () => {
    if (!pending || saving) return;
    const trimmed = pending.name.trim();
    if (!trimmed) return;
    const insertAt = pending.insertAt;
    const left = insertAt > 0 ? states[insertAt - 1] : null;
    const right = insertAt < states.length ? states[insertAt] : null;
    const kind = inferKind(left, right);
    const sort_order = (insertAt + 1) * 10;
    setSaving(true);
    try {
      const created = await flowStatesApi.createState(group.flow_id, {
        name: trimmed,
        kind,
        sort_order,
      });
      setStates((prev) => {
        const next = [...prev];
        next.splice(insertAt, 0, created);
        return next;
      });
      setPending(null);
    } catch (err) {
      notify.apiError(err, "Failed to create state.");
    } finally {
      setSaving(false);
    }
  }, [pending, saving, states, group.flow_id]);

  const cancelInsert = useCallback(() => setPending(null), []);

  const handleRemove = useCallback(async (id: string) => {
    const state = states.find((s) => s.id === id);
    if (!state) return;
    if (state.is_initial) {
      notify.error?.("Cannot remove the initial state.");
      return;
    }
    setSaving(true);
    try {
      await flowStatesApi.deleteState(id);
      setStates((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      notify.apiError(err, "Failed to remove state.");
    } finally {
      setSaving(false);
    }
  }, [states]);

  return (
    <section className="fs-flow-block" aria-labelledby={`flow-${group.flow_id}`}>
      <h4 id={`flow-${group.flow_id}`} className="fs-flow-block__title">
        {group.flow_name}
      </h4>
      <div className="orbit-poc__toolbar">
        <span className="orbit-poc__count">
          {states.length} state{states.length === 1 ? "" : "s"} on orbit
        </span>
        {saving && <span className="orbit-poc__saving">Saving…</span>}
      </div>

      {pending && (
        <div className="orbit-poc__insert-bar">
          <span className="orbit-poc__insert-label">
            Insert at position {pending.insertAt + 1}:
          </span>
          <input
            ref={nameRef}
            className="form__input orbit-poc__insert-input"
            placeholder="State name…"
            value={pending.name}
            maxLength={60}
            disabled={saving}
            onChange={(e) =>
              setPending((p) => (p ? { ...p, name: e.target.value } : p))
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitInsert();
              else if (e.key === "Escape") cancelInsert();
            }}
          />
          <button
            type="button"
            className="btn btn--xs btn--primary"
            disabled={saving || !pending.name.trim()}
            onClick={commitInsert}
          >
            {saving ? "Adding…" : "Add"}
          </button>
          <button
            type="button"
            className="btn btn--xs btn--ghost"
            onClick={cancelInsert}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      )}

      <CircularAdditor
        items={items}
        onInsert={handleInsert}
        onRemove={handleRemove}
      />
    </section>
  );
}

function TypeSection({
  typeId,
  typeName,
  groups,
}: {
  typeId: string;
  typeName: string;
  groups: FlowGroup[];
}) {
  return (
    <section id={`type-${typeId}`}>
      <h3 className="fs-type-heading">{typeName}</h3>
      {groups.map((g) => (
        <FlowOrbit key={g.flow_id} group={g} />
      ))}
    </section>
  );
}

export default function FlowStatesV2Page() {
  const { full } = usePageTitle();
  const [data, setData] = useState<FlowsResponse | null>(null);
  const [loadError, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await flowStatesApi.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load flow states.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loadError) {
    return (
      <PageContent>
        <div className="settings-panel">
          <p className="form__error">{loadError}</p>
          <button type="button" className="btn btn--ghost" onClick={load}>
            Retry
          </button>
        </div>
      </PageContent>
    );
  }

  if (!data) {
    return (
      <PageContent>
        <div className="settings-panel">
          <p className="form__hint">Loading flow states…</p>
        </div>
      </PageContent>
    );
  }

  const workByType = groupByType(
    [...data.work].sort((a, b) => a.type_name.localeCompare(b.type_name)),
  );
  const strategyByType = groupByType(
    [...data.strategy].sort((a, b) => a.type_name.localeCompare(b.type_name)),
  );

  const tocItems: AnchorNavItem[] = [
    ...(workByType.size > 0
      ? [
          { id: "section-work", label: "Work Types", depth: 0 },
          ...[...workByType.entries()].map(([id, { name }]) => ({
            id: `type-${id}`,
            label: name,
            depth: 1,
          })),
        ]
      : []),
    ...(strategyByType.size > 0
      ? [
          { id: "section-strategy", label: "Strategy Types", depth: 0 },
          ...[...strategyByType.entries()].map(([id, { name }]) => ({
            id: `type-${id}`,
            label: name,
            depth: 1,
          })),
        ]
      : []),
  ];

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
        <div className="anav-layout">
          <PageAnchorNav items={tocItems} />
          <div className="anav-content">
            {workByType.size > 0 && (
              <section id="section-work">
                <Panel name="work_types" title="Work Types" helpable={false}>
                  {[...workByType.entries()].map(([typeId, { name, flows }]) => (
                    <TypeSection key={typeId} typeId={typeId} typeName={name} groups={flows} />
                  ))}
                </Panel>
              </section>
            )}
            {strategyByType.size > 0 && (
              <section id="section-strategy">
                <Panel name="strategy_types" title="Strategy Types" helpable={false}>
                  {[...strategyByType.entries()].map(([typeId, { name, flows }]) => (
                    <TypeSection key={typeId} typeId={typeId} typeName={name} groups={flows} />
                  ))}
                </Panel>
              </section>
            )}
          </div>
        </div>
      </div>

    </PageContent>
  );
}
