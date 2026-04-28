"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { api } from "@/app/lib/api";

interface EntityRow {
  kind: "portfolio" | "product";
  id: string;
  name: string;
}

interface EntitiesResp {
  entities: EntityRow[];
}

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<EntitiesResp>("/api/nav/entities");
        if (cancelled) return;
        const match = (r.entities ?? []).find((e) => e.kind === "product" && e.id === id);
        setName(match?.name ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const title = name ? `Product: ${name}` : "Product";

  return (
    <PageShell title={title} subtitle="Product detail view — placeholder.">
      {loading && (
        <div className="placeholder">
          <h3 className="placeholder__title">Loading</h3>
          <p className="placeholder__body">Fetching product…</p>
        </div>
      )}
      {error && (
        <div className="placeholder">
          <h3 className="placeholder__title">Couldn’t load product</h3>
          <p className="placeholder__body">{error}</p>
        </div>
      )}
      {!loading && !error && !name && (
        <div className="placeholder">
          <h3 className="placeholder__title">Product not found</h3>
          <p className="placeholder__body">No product with id <code>{id}</code> in your tenant.</p>
        </div>
      )}
      {!loading && !error && name && (
        <div className="placeholder">
          <h3 className="placeholder__title">{name}</h3>
          <p className="placeholder__body">
            The product detail UI hasn’t been built yet. This placeholder confirms
            the bookmark route resolves; replace this page when the real view ships.
          </p>
        </div>
      )}
    </PageShell>
  );
}
