"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";
import { useNavPrefs } from "@/app/contexts/NavPrefsContext";
import {
  type CustomPage,
  type CustomView,
  deleteCustomPage,
  getCustomPage,
  patchCustomPage,
} from "@/app/lib/customPages";

function ViewBody({ view }: { view: CustomView }) {
  return (
    <div className="placeholder">
      <h3 className="placeholder__title">{view.label}</h3>
      <p className="placeholder__body">
        {view.kind === "timeline" && "Timeline view — schedule and dependencies will render here."}
        {view.kind === "board" && "Board view — kanban columns will render here."}
        {view.kind === "list" && "List view — sortable, filterable rows will render here."}
      </p>
    </div>
  );
}

export default function CustomContainerPage() {
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();
  const { refetch: refetchNav } = useNavPrefs();

  const id = params?.id;
  const [page, setPage] = useState<CustomPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getCustomPage(id)
      .then((p) => {
        if (cancelled) return;
        setPage(p);
        setDraftLabel(p.label);
        setErr(null);
      })
      .catch(() => {
        if (cancelled) return;
        setErr("Page not found.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  const requestedVid = search?.get("vid") ?? null;
  const activeView = useMemo<CustomView | null>(() => {
    if (!page?.views || page.views.length === 0) return null;
    if (requestedVid) {
      const found = page.views.find((v) => v.id === requestedVid);
      if (found) return found;
    }
    return page.views[0];
  }, [page, requestedVid]);

  if (!user) return null;

  if (loading) {
    return <PageShell title="Loading…" subtitle=""><div /></PageShell>;
  }
  if (err || !page) {
    return (
      <PageShell title="Not found" subtitle="">
        <div className="placeholder">
          <p className="placeholder__body">{err ?? "This page no longer exists."}</p>
        </div>
      </PageShell>
    );
  }

  async function commitRename() {
    if (!page) return;
    const next = draftLabel.trim();
    if (!next || next === page.label) {
      setDraftLabel(page.label);
      setEditing(false);
      return;
    }
    try {
      const updated = await patchCustomPage(page.id, { label: next });
      setPage(updated);
      setDraftLabel(updated.label);
      await refetchNav();
    } catch {
      setDraftLabel(page.label);
    } finally {
      setEditing(false);
    }
  }

  async function onDelete() {
    if (!page) return;
    if (!window.confirm(`Delete "${page.label}"? This removes all its views.`)) return;
    await deleteCustomPage(page.id);
    await refetchNav();
    router.push("/dashboard");
  }

  return (
    <PageShell title={page.label} subtitle="">
      <div className="custom-page">
        <div className="custom-page__heading-row">
          {editing ? (
            <input
              autoFocus
              className="custom-page__title-input"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") { setDraftLabel(page.label); setEditing(false); }
              }}
            />
          ) : (
            <button
              type="button"
              className="custom-page__rename"
              onClick={() => setEditing(true)}
            >
              Rename
            </button>
          )}
        </div>
        {(page.views?.length ?? 0) > 1 && (
          <div className="custom-page__tabs" role="tablist">
            {page.views!.map((v) => {
              const active = activeView?.id === v.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`custom-page__tab ${active ? "custom-page__tab--active" : ""}`}
                  onClick={() => router.replace(`/p/${page.id}?vid=${v.id}`)}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        )}

        {activeView ? <ViewBody view={activeView} /> : (
          <div className="placeholder">
            <p className="placeholder__body">This page has no views yet.</p>
          </div>
        )}

        <div className="custom-page__actions">
          <button type="button" className="btn btn--danger" onClick={onDelete}>
            Delete page
          </button>
        </div>
      </div>
    </PageShell>
  );
}
