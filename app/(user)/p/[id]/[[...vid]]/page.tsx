"use client";

// Custom page deep-link surface. Route shape:
//   /p/<id>           → renders the page with the first view active
//   /p/<id>/<vid>     → renders the page with view <vid> active
// vid was previously a ?vid= query param; retired with TD-URL-VID-VIEW-PICKER
// to honour feedback_url_is_path_only (PLA-0053). The catch-all segment
// [[...vid]] keeps the bare /p/<id> URL working (vid is optional).

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import { useAuth } from "@/app/contexts/AuthContext";
import { useNavPrefs } from "@/app/contexts/NavPrefsContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";
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
  const { full } = usePageTitle();
  const router = useRouter();
  // params.vid is the catch-all segment: undefined when URL is /p/<id>,
  // ["<vid>"] when URL is /p/<id>/<vid>. Only the first element is read
  // (extra segments are ignored — no /p/<id>/<vid>/<sub-vid> contract).
  const params = useParams<{ id: string; vid?: string[] }>();
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

  const requestedVid = params?.vid?.[0] ?? null;
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
    return <PageContent><div /></PageContent>;
  }
  if (err || !page) {
    return (
      <PageContent>
        <div className="placeholder">
          <p className="placeholder__body">{err ?? "This page no longer exists."}</p>
        </div>
      </PageContent>
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
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Custom page view." />
      <PageDescription>
        Renders a custom page or view configured for this workspace.
      </PageDescription>
      <Panel
        name="panel_custom_page_header"
        className="page-panel-heading"
        title="Custom Page"
        description="Renders a custom page or view configured for this workspace."
      />
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
              className="btn btn--ghost btn--sm custom-page__rename"
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
                  onClick={() => router.replace(`/p/${page.id}/${v.id}`)}
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
    </PageContent>
  );
}
