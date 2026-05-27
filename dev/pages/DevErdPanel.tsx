"use client";

import { useCallback, useEffect, useState } from "react";
import Panel from "@/app/components/Panel";
import DevErdCanvas from "./DevErdCanvas";
import DevErdFilterRail from "./DevErdFilterRail";
import DevErdInspector from "./DevErdInspector";
import "../styles/dev-erd.css";

export type ErdColumn = { name: string; type: string; is_pk: boolean; is_fk: boolean; nullable: boolean };
export type ErdNode = { id: string; database: string; table: string; group: string; row_count: number; columns: ErdColumn[] };
export type ErdEdge = { id: string; from: string; to: string; from_column?: string; to_column?: string; kind: "hard_fk" | "soft_ref"; on_delete?: string; evidence?: string };
export type ErdResponse = {
  generated_at: string;
  databases: { name: string; table_count: number; fk_count: number }[];
  groups: { id: string; label: string; source: string }[];
  nodes: ErdNode[];
  edges: ErdEdge[];
};

export type Filters = {
  databases: Set<string>;
  groups: Set<string>;
  edgeKinds: Set<"hard_fk" | "soft_ref">;
};

export default function DevErdPanel() {
  const [data, setData] = useState<ErdResponse | null>(null);
  const [filters, setFilters] = useState<Filters | null>(null);
  const [selected, setSelected] = useState<ErdNode | ErdEdge | null>(null);
  const [snapshotting, setSnapshotting] = useState(false);

  const reload = useCallback(async () => {
    const res = await fetch("/_site/admin/dev/erd", { credentials: "include" });
    if (!res.ok) {
      console.error("erd reload failed", res.status);
      return;
    }
    const body = (await res.json()) as ErdResponse;
    setData(body);
    setFilters({
      databases: new Set(body.databases.map((d) => d.name)),
      groups: new Set(body.groups.map((g) => g.id)),
      edgeKinds: new Set(["hard_fk", "soft_ref"]),
    });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const snapshot = useCallback(async () => {
    setSnapshotting(true);
    try {
      const res = await fetch("/_site/admin/dev/erd", { method: "POST", credentials: "include" });
      if (!res.ok) console.error("snapshot failed", res.status);
    } finally {
      setSnapshotting(false);
    }
  }, []);

  return (
    <Panel name="dev_erd" title="ERD">
      <div className="dui-erd-shell">
        <DevErdFilterRail data={data} filters={filters} setFilters={setFilters} />
        <div className="dui-erd-shell__main">
          <DevErdCanvas data={data} filters={filters} onSelect={setSelected} />
          <div className="dui-erd-shell__toolbar" role="toolbar">
            <button type="button">Fit</button>
            <button type="button" onClick={() => void reload()}>Reload</button>
            <button type="button" onClick={() => void snapshot()} disabled={snapshotting}>
              {snapshotting ? "Snapshotting…" : "Snapshot"}
            </button>
            {data && (
              <span className="dui-erd-shell__stamp" aria-live="polite">
                ○ Live · {new Date(data.generated_at).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <DevErdInspector selected={selected} />
      </div>
    </Panel>
  );
}
