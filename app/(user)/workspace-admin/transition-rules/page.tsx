"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import PageAnchorNav, { type AnchorNavItem } from "@/app/components/PageAnchorNav";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import Panel from "@/app/components/Panel";
import OrbitView from "@/app/components/flow-rules/OrbitView";
import { flowStatesApi, type FlowGroup, type FlowTransition, type FlowsResponse } from "@/app/lib/flowStatesApi";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { useTenantName } from "@/app/contexts/TenantContext";

function groupByType(groups: FlowGroup[]): Map<string, { name: string; flows: FlowGroup[] }> {
  const map = new Map<string, { name: string; flows: FlowGroup[] }>();
  for (const g of groups) {
    if (!map.has(g.type_id)) map.set(g.type_id, { name: g.type_name, flows: [] });
    map.get(g.type_id)!.flows.push(g);
  }
  return map;
}

function FlowSection({ group, typeName, typeId, showSubtitle, onTransitionsChange }: {
  group: FlowGroup;
  typeName: string;
  typeId: string;
  showSubtitle: boolean;
  onTransitionsChange: (next: FlowTransition[]) => void;
}) {
  return (
    <section className="fs-flow-block" aria-labelledby={`flow-${group.flow_id}`}>
      <OrbitView
        flowId={group.flow_id}
        typeName={typeName}
        typeAnchorId={`type-${typeId}`}
        flowSubtitle={showSubtitle ? group.flow_name : null}
        flowAnchorId={`flow-${group.flow_id}`}
        states={group.states}
        transitions={group.transitions}
        onTransitionsChange={onTransitionsChange}
      />
    </section>
  );
}

function TypeSection({
  typeId,
  typeName,
  groups,
  onReplaceGroup,
}: {
  typeId: string;
  typeName: string;
  groups: FlowGroup[];
  onReplaceGroup: (flowId: string, transitions: FlowTransition[]) => void;
}) {
  return (
    <section className="fs-type-section">
      {groups.map((g) => (
        <FlowSection
          key={g.flow_id}
          group={g}
          typeName={typeName}
          typeId={typeId}
          showSubtitle={groups.length > 1 && !g.is_default}
          onTransitionsChange={(next) => onReplaceGroup(g.flow_id, next)}
        />
      ))}
    </section>
  );
}

export default function TransitionRulesPage() {
  const { user } = useAuth();
  const canManageFlows = useHasPermission("flows.manage");
  const router = useRouter();
  const workspaceName = useTenantName() || "ACME Bank Workspace";

  useEffect(() => {
    if (user && !canManageFlows) router.replace("/workspace-settings");
  }, [user, canManageFlows, router]);

  const [data, setData]   = useState<FlowsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await flowStatesApi.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load transition rules.");
    }
  }, []);

  useEffect(() => { if (user && canManageFlows) load(); }, [user, canManageFlows, load]);

  const handleReplaceGroup = useCallback((flowId: string, transitions: FlowTransition[]) => {
    setData((prev) => {
      if (!prev) return prev;
      const swap = (g: FlowGroup): FlowGroup => (g.flow_id === flowId ? { ...g, transitions } : g);
      return { work: prev.work.map(swap), strategy: prev.strategy.map(swap) };
    });
  }, []);

  const { workByType, strategyByType, tocItems } = useMemo(() => {
    if (!data) return { workByType: new Map(), strategyByType: new Map(), tocItems: [] as AnchorNavItem[] };
    const workByType     = groupByType([...data.work].sort((a, b) => a.type_name.localeCompare(b.type_name)));
    const strategyByType = groupByType([...data.strategy].sort((a, b) => a.type_name.localeCompare(b.type_name)));
    const tocItems: AnchorNavItem[] = [
      ...(workByType.size > 0
        ? [{ id: "section-work", label: "Work Types", depth: 0 } as AnchorNavItem,
           ...[...workByType.entries()].map(([id, { name }]) => ({ id: `type-${id}`, label: name, depth: 1 } as AnchorNavItem))]
        : []),
      ...(strategyByType.size > 0
        ? [{ id: "section-strategy", label: "Strategy Types", depth: 0 } as AnchorNavItem,
           ...[...strategyByType.entries()].map(([id, { name }]) => ({ id: `type-${id}`, label: name, depth: 1 } as AnchorNavItem))]
        : []),
    ];
    return { workByType, strategyByType, tocItems };
  }, [data]);

  if (!user || !canManageFlows) return null;

  if (error) {
    return (
      <div className="settings-panel">
        <p className="form__error">{error}</p>
        <button type="button" className="btn btn--ghost" onClick={load}>Retry</button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="settings-panel">
        <p className="form__hint">Loading transition rules…</p>
      </div>
    );
  }

  return (
    <PageContent>
    <div className="settings-panel settings-panel--wide">
      <div className="anav-layout">
        <PageAnchorNav items={tocItems} />
        <div className="anav-content">
          <PageDescription>
            <div className="fs-page-description">
              <p>
                Configure the permitted state changes for every artefact type in <strong>{workspaceName}</strong>.
                For each artefact type, work through its states one at a time and choose where users are allowed
                to move next.
              </p>
              <ol>
                <li>Select a state in the <strong>Source State</strong> panel.</li>
                <li>In the <strong>Transition Selector</strong>, tap the surrounding states to allow or block moves out of the selected state.</li>
                <li>Repeat for every source state, in every artefact type.</li>
                <li>As you build the rules, the <strong>Transition Map</strong> updates live so you can see the full flow at a glance.</li>
              </ol>
            </div>
          </PageDescription>
          {workByType.size > 0 && (
            <section id="section-work">
              <Panel name="work_types" title="Work Types" helpable={false}>
                {[...workByType.entries()].map(([typeId, { name, flows }]) => (
                  <TypeSection
                    key={typeId}
                    typeId={typeId}
                    typeName={name}
                    groups={flows}
                    onReplaceGroup={handleReplaceGroup}
                  />
                ))}
              </Panel>
            </section>
          )}
          {strategyByType.size > 0 && (
            <section id="section-strategy">
              <Panel name="strategy_types" title="Strategy Types" helpable={false}>
                {[...strategyByType.entries()].map(([typeId, { name, flows }]) => (
                  <TypeSection
                    key={typeId}
                    typeId={typeId}
                    typeName={name}
                    groups={flows}
                    onReplaceGroup={handleReplaceGroup}
                  />
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
