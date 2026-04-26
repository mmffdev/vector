"use client";

// /portfolio — pinnable list of portfolios / products.
// Story 00088 restyle: the page header (28px title + ink-muted
// subtitle) comes from PageShell + the .page__head rules added
// in 00080. The list rows are .entity-list__row — surface cards
// on --canvas with a 1px --border, --radius-md, no shadow; the
// kind label uses the eyebrow micro-label spec (--text-xs /
// uppercase / 0.08em / --ink-subtle / 600). The empty state has
// been migrated from the legacy .empty-state to the Vector
// .placeholder kit (story 00079) for consistency. No
// .tag classes, no lime-green, no decorative colour.

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
      {loading && (
        <div className="placeholder">
          <h3 className="placeholder__title">Loading</h3>
          <p className="placeholder__body">Fetching your portfolios and products…</p>
        </div>
      )}
      {error && (
        <div className="placeholder">
          <h3 className="placeholder__title">Couldn’t load entities</h3>
          <p className="placeholder__body">{error}</p>
        </div>
      )}
      {!loading && !error && rows.length === 0 && (
        <div className="placeholder">
          <h3 className="placeholder__title">No entities yet</h3>
          <p className="placeholder__body">Portfolios and products will appear here once they exist.</p>
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
