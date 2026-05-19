"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { apiSite } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { usePageTitle } from "@/app/hooks/usePageTitle";

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
  const { full } = usePageTitle();
  const id = params?.id ?? "";
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await apiSite<EntitiesResp>("/nav/entities");
        if (cancelled) return;
        const match = (r.entities ?? []).find((e) => e.kind === "product" && e.id === id);
        setName(match?.name ?? null);
      } catch (e) {
        if (!cancelled) {
          notify.apiError(e, "Failed to load product.");
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="View and manage this portfolio entity." />
      <Panel
        name="panel_product_detail_header"
        className="page-panel-heading"
        title="Product"
        description="View and manage the details, relationships, and configuration for this portfolio entity."
      />
      {loading && (
        <div className="placeholder">
          <h3 className="placeholder__title">Loading</h3>
          <p className="placeholder__body">Fetching product…</p>
        </div>
      )}
      {error && (
        <div className="placeholder">
          <h3 className="placeholder__title">Couldn’t load product</h3>
          <p className="placeholder__body">Reload the page to try again.</p>
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
    </PageContent>
  );
}
