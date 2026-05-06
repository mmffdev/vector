"use client";

import { useEffect, useState } from "react";
import Table from "@/app/components/Table";
import { api } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

interface FlowState {
  id: string;
  flow_position: number;
  name: string;
  canonical_code: string;
  description?: string | null;
}

interface FlowGroup {
  target_kind: "system" | "tenant" | "portfolio";
  target_id: string;
  target_label: string;
  states: FlowState[] | null;
}

interface FlowsResponse {
  system: FlowGroup[] | null;
  tenant: FlowGroup[] | null;
  portfolio: FlowGroup[] | null;
}

export default function WorkItemsPage() {
  const [data,    setData]    = useState<FlowsResponse | null>(null);
  const [error,   setError]   = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api<FlowsResponse>("/api/flows/")
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

  if (loading) return <div className="empty-state">Loading flows…</div>;
  if (error)   return <div className="empty-state">Could not load flows — reload the page to try again.</div>;
  if (!data)   return null;

  const sections: Array<{ title: string; subtitle: string; groups: FlowGroup[] }> = [
    {
      title: "System types",
      subtitle: "Vendor-defined artefact types (work items, defects, tasks, test cases, epics, strategic).",
      groups: data.system ?? [],
    },
    {
      title: "Portfolio layers",
      subtitle: "Each strategy layer your tenant has defined (Feature, Initiative, Theme, …) has its own independent flow.",
      groups: data.portfolio ?? [],
    },
    {
      title: "Custom types",
      subtitle: "Tenant-invented artefact types. Empty until a gadmin creates one.",
      groups: data.tenant ?? [],
    },
  ];

  return (
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
                <div key={g.target_id}>
                  <Table<FlowState>
                    pageId="workspace-settings"
                    slot={`flows__${g.target_id.replace(/-/g, "_")}`}
                    ariaLabel={g.target_label}
                    rows={g.states ?? []}
                    rowKey={(s) => s.id}
                    toolbar={{ meta: <strong>{g.target_label}</strong> }}
                    cellClassName={(_s, c) =>
                      c.key === "flow_position" ? "tree_accordion-dense__cell--mono" : undefined
                    }
                    columns={[
                      { key: "flow_position", header: "#",          width: 56,  kind: "numeric" },
                      { key: "name",          header: "Name",       width: 200 },
                      {
                        key: "canonical_code",
                        header: "Canonical",
                        width: 160,
                        kind: "pill",
                        pillVariant: () => "neutral",
                        pillLabel: (s) => s.canonical_code,
                      },
                      {
                        key: "description",
                        header: "Description",
                        kind: "custom",
                        render: (s) => s.description ?? "",
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
  );
}
