"use client";

import { useEffect, useState } from "react";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { apiSite } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

interface FlowState {
  id: string;
  name: string;
  kind: "todo" | "in_progress" | "done" | "cancelled";
  sort_order: number;
  is_initial: boolean;
  colour?: string | null;
}

interface FlowGroup {
  flow_id: string;
  type_id: string;
  type_name: string;
  type_scope: "work" | "strategy";
  states: FlowState[] | null;
}

interface FlowsResponse {
  work:     FlowGroup[] | null;
  strategy: FlowGroup[] | null;
}

export default function WorkItemsPage() {
  const { full } = usePageTitle();
  const [data,    setData]    = useState<FlowsResponse | null>(null);
  const [error,   setError]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiSite<FlowsResponse>("/flows/")
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        notify.apiError(e, "Could not load flows.");
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <PageContent><div className="empty-state">Loading flows…</div></PageContent>;
  if (error)   return <PageContent><div className="empty-state">Could not load flows — reload the page to try again.</div></PageContent>;
  if (!data)   return null;

  const sections: Array<{ title: string; subtitle: string; groups: FlowGroup[] }> = [
    {
      title: "Work types",
      subtitle: "Sprint-tracked execution types (work items, defects, tasks, …). Each has an independent flow.",
      groups: data.work ?? [],
    },
    {
      title: "Strategy types",
      subtitle: "Hierarchical portfolio layers (Feature, Initiative, Theme, …). Each has an independent flow.",
      groups: data.strategy ?? [],
    },
  ];

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Configure work item type definitions and workflow settings." />
      <Panel
        name="panel_work_items_settings_header"
        className="page-panel-heading"
        title="Work Items"
        description="Manage work item type definitions, default fields, and workflow configuration for the workspace."
      />
    <div>
      <div className="toolbar">
        <div className="toolbar__meta">
          Read-only view — editing arrives in the next iteration. Each row below is a state in the named flow, in execution order.
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.title} className="flow-editor__section">
          <h3 className="flow-editor__section-title">{section.title}</h3>
          <p className="flow-editor__section-subtitle">{section.subtitle}</p>

          {section.groups.length === 0 ? (
            <div className="empty-state">No flows in this section.</div>
          ) : (
            <div className="u-stack--gap-3">
              {section.groups.map((g) => (
                <div key={g.flow_id}>
                  <Table<FlowState>
                    pageId="workspace-settings"
                    slot={`flows__${g.flow_id.replace(/-/g, "_")}`}
                    ariaLabel={g.type_name}
                    rows={g.states ?? []}
                    rowKey={(s) => s.id}
                    toolbar={{ meta: <strong>{g.type_name}</strong> }}
                    cellClassName={(_s, c) =>
                      c.key === "sort_order" ? "tree_accordion-dense__cell--mono" : undefined
                    }
                    columns={[
                      { key: "sort_order", header: "#",    width: 56,  kind: "numeric" },
                      { key: "name",       header: "Name", width: 200 },
                      {
                        key: "kind",
                        header: "Kind",
                        width: 160,
                        kind: "pill",
                        pillVariant: () => "neutral",
                        pillLabel: (s) => s.kind,
                      },
                      {
                        key: "is_initial",
                        header: "Initial",
                        width: 80,
                        kind: "custom",
                        render: (s) => s.is_initial ? "✓" : "",
                      },
                    ]}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
    </PageContent>
  );
}
