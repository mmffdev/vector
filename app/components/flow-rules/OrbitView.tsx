"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flowStatesApi, type FlowState, type FlowTransition } from "@/app/lib/flowStatesApi";
import { notify } from "@/app/lib/toast";
import StateRail from "./StateRail";
import OrbitCanvas from "./OrbitCanvas";
import RoutesLinesView from "./RoutesLinesView";
import { fromTransitions, has, keyOf, type RuleKey } from "./rules";

export type OrbitViewProps = {
  flowId: string;
  typeName: string;
  typeAnchorId: string;
  flowSubtitle: string | null;
  flowAnchorId: string;
  states: FlowState[];
  transitions: FlowTransition[];
  onTransitionsChange: (next: FlowTransition[]) => void;
};

export default function OrbitView({ flowId, typeName, typeAnchorId, flowSubtitle, flowAnchorId, states, transitions, onTransitionsChange }: OrbitViewProps) {
  const sorted = useMemo(
    () => [...states].sort((a, b) => a.sort_order - b.sort_order),
    [states],
  );
  const initialFocus = sorted.find((s) => s.is_initial)?.id ?? sorted[0]?.id ?? null;
  const [focusedId, setFocusedId] = useState<string | null>(initialFocus);
  const [busyKey, setBusyKey]     = useState<RuleKey | null>(null);
  const [clearing, setClearing]   = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (confirmTimer.current) clearTimeout(confirmTimer.current); }, []);

  const stateIds = useMemo(() => new Set(sorted.map((s) => s.id)), [sorted]);
  const validTransitions = useMemo(
    () => transitions.filter((t) => stateIds.has(t.from) && stateIds.has(t.to)),
    [transitions, stateIds],
  );
  const rules    = useMemo(() => fromTransitions(validTransitions), [validTransitions]);
  const focused  = sorted.find((s) => s.id === focusedId) ?? sorted[0] ?? null;
  const orbiting = focused ? sorted.filter((s) => s.id !== focused.id) : [];

  const handleClear = useCallback(async () => {
    if (clearing || validTransitions.length === 0) return;
    if (!confirmingClear) {
      setConfirmingClear(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmingClear(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    setConfirmingClear(false);
    setClearing(true);
    try {
      const results = await Promise.allSettled(
        validTransitions.map((t) => flowStatesApi.deleteTransition(flowId, t.from, t.to)),
      );
      const failed = results.filter((r) => r.status === "rejected");
      const keep = new Set<string>();
      results.forEach((r, i) => {
        if (r.status === "rejected") keep.add(keyOf(validTransitions[i].from, validTransitions[i].to));
      });
      const remaining = transitions.filter((t) =>
        keep.has(keyOf(t.from, t.to)) || !stateIds.has(t.from) || !stateIds.has(t.to),
      );
      onTransitionsChange(remaining);
      if (failed.length > 0) notify.apiError(failed[0].reason, `Failed to clear ${failed.length} rule(s).`);
    } finally {
      setClearing(false);
    }
  }, [flowId, clearing, confirmingClear, validTransitions, transitions, stateIds, onTransitionsChange]);

  const handleToggle = useCallback(
    async (to: FlowState) => {
      if (!focused) return;
      const k = keyOf(focused.id, to.id);
      if (busyKey) return;
      setBusyKey(k);
      try {
        if (has(rules, focused.id, to.id)) {
          await flowStatesApi.deleteTransition(flowId, focused.id, to.id);
          onTransitionsChange(transitions.filter((t) => !(t.from === focused.id && t.to === to.id)));
        } else {
          const tr = await flowStatesApi.createTransition(flowId, focused.id, to.id);
          onTransitionsChange([...transitions, tr]);
        }
      } catch (err) {
        notify.apiError(err, "Failed to update transition.");
      } finally {
        setBusyKey(null);
      }
    },
    [flowId, focused, rules, transitions, busyKey, onTransitionsChange],
  );

  if (!focused || sorted.length < 2) {
    return (
      <p className="form__hint">
        Add at least two flow states before defining transitions.
      </p>
    );
  }

  const ruleCount = validTransitions.length;
  const sortOrderOf = (id: string) => sorted.find((s) => s.id === id)?.sort_order ?? 0;
  const happy: { key: string; label: string }[] = [];
  const unhappy: { key: string; label: string }[] = [];
  for (const t of validTransitions) {
    const fromName = sorted.find((s) => s.id === t.from)?.name ?? "?";
    const toName   = sorted.find((s) => s.id === t.to)?.name   ?? "?";
    const entry = { key: `${t.from}>${t.to}`, label: `${fromName} → ${toName}` };
    if (sortOrderOf(t.to) > sortOrderOf(t.from)) happy.push(entry);
    else unhappy.push(entry);
  }

  return (
    <div className="flow-rules">
      <h2 id={typeAnchorId} className="flow-rules__title">{typeName}</h2>
      {flowSubtitle && (
        <h3 id={flowAnchorId} className="flow-rules__subtitle">{flowSubtitle}</h3>
      )}
      <div className="flow-rules__body">
        <StateRail
          states={sorted}
          hasRules={rules.size > 0}
          rulesSize={rules.size}
          focusedId={focused.id}
          onFocus={setFocusedId}
          onClear={handleClear}
          clearing={clearing}
          confirming={confirmingClear}
        />
        <div className="flow-rules__canvas-wrap">
          <p className="flow-rules__eyebrow">TRANSITION SELECTOR</p>
          <OrbitCanvas
            focused={focused}
            orbiting={orbiting}
            rules={rules}
            busyKey={busyKey}
            onToggle={handleToggle}
          />
        </div>
        <div className="flow-rules__routes-wrap">
          <RoutesLinesView states={sorted} transitions={validTransitions} rules={rules} />
        </div>
      </div>
      <div className="flow-rules__footer">
        <p className="flow-rules__eyebrow">RULE COUNT</p>
        <div className="flow-rules__footer-body">
          <span className="flow-rules__footer-count">{ruleCount}</span>
          {ruleCount === 0 ? (
            <span className="flow-rules__footer-empty">No transitions allowed yet.</span>
          ) : (
            <div className="flow-rules__footer-paths">
              <div className="flow-rules__footer-path-row">
                <span className="flow-rules__footer-path-label flow-rules__footer-path-label--happy">Happy path</span>
                <span className="flow-rules__rail-count">{happy.length}</span>
                {happy.length === 0
                  ? <span className="flow-rules__footer-empty">None</span>
                  : <ul className="flow-rules__footer-list">
                      {happy.map((r) => <li key={r.key} className="flow-rules__footer-item flow-rules__footer-item--happy">{r.label}</li>)}
                    </ul>
                }
              </div>
              <div className="flow-rules__footer-path-row">
                <span className="flow-rules__footer-path-label flow-rules__footer-path-label--unhappy">Unhappy path</span>
                <span className="flow-rules__rail-count">{unhappy.length}</span>
                {unhappy.length === 0
                  ? <span className="flow-rules__footer-empty">None</span>
                  : <ul className="flow-rules__footer-list">
                      {unhappy.map((r) => <li key={r.key} className="flow-rules__footer-item flow-rules__footer-item--unhappy">{r.label}</li>)}
                    </ul>
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
