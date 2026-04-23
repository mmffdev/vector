"use client";

import { useEffect, useState } from "react";
import PageShell from "@/app/components/PageShell";
import PinButton from "@/app/components/PinButton";
import { api } from "@/app/lib/api";

interface EntityRow {
  kind: "portfolio" | "product";
  id: string;
  name: string;
}

interface EntitiesResp {
  entities: EntityRow[];
}

export default function Portfolio() {
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<EntitiesResp>("/api/nav/entities");
        if (!cancelled) setRows(r.entities ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <PageShell title="Portfolio" subtitle="Pin portfolios and products to your sidebar bookmarks.">
      {loading && <p>Loading…</p>}
      {error && <p className="error">Error: {error}</p>}
      {!loading && !error && rows.length === 0 && (
        <div className="empty-state">
          <h3>No entities yet</h3>
          <p>Portfolios and products will appear here once they exist.</p>
        </div>
      )}
      {rows.length > 0 && (
        <ul className="entity-list">
          {rows.map((row) => (
            <li key={`${row.kind}:${row.id}`} className="entity-list__row">
              <div className="entity-list__main">
                <span className="entity-list__kind">{row.kind}</span>
                <span className="entity-list__name">{row.name}</span>
              </div>
              <PinButton kind={row.kind} id={row.id} />
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
