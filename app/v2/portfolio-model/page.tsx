"use client";

// Phase 2 PoC: Portfolio Model v2 - hits vector_artefacts directly via
// /api/v2/* route handlers. Mirrors the v2 work-items page but for the
// strategy scope (Theme > Business Objective > Feature).
//
// Visible 'PoC' marker so anyone landing on this page knows they're not
// on the production portfolio-model adoption surface at /portfolio-model.

import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";

interface ArtefactType {
  id: string;
  scope: "work" | "strategy";
  source: "system" | "tenant";
  name: string;
  prefix: string;
  parent_type_id: string | null;
  sort_order: number;
}

interface StrategyItem {
  id: string;
  number: string;
  title: string;
  description: string | null;
  position: number;
  type_id: string;
  type_name: string;
  type_prefix: string;
  layer_depth: number | null;
  parent_artefact_id: string | null;
  parent_title: string | null;
  parent_prefix: string | null;
  parent_number: string | null;
}

export default function PortfolioModelV2Page() {
  const [types, setTypes] = useState<ArtefactType[]>([]);
  const [items, setItems] = useState<StrategyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState({
    artefact_type_id:   "",
    parent_artefact_id: "",
    title:              "",
  });
  const [saving, setSaving] = useState(false);
  const [archiveArmed, setArchiveArmed] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const strategyTypes = useMemo(
    () => types.filter((t) => t.scope === "strategy"),
    [types],
  );

  const selectedType = useMemo(
    () => strategyTypes.find((t) => t.id === draft.artefact_type_id) ?? null,
    [strategyTypes, draft.artefact_type_id],
  );

  // Candidate parents = items whose type matches selectedType.parent_type_id.
  const parentCandidates = useMemo(() => {
    if (!selectedType?.parent_type_id) return [];
    return items.filter((i) => i.type_id === selectedType.parent_type_id);
  }, [items, selectedType]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [tRes, iRes] = await Promise.all([
        fetch("/api/v2/artefact-types").then((r) => r.json()),
        fetch("/api/v2/strategy-items").then((r) => r.json()),
      ]);
      if (tRes.error) throw new Error(tRes.error);
      if (iRes.error) throw new Error(iRes.error);
      setTypes(tRes.items as ArtefactType[]);
      setItems(iRes.items as StrategyItem[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Default to the first strategy type once they're loaded.
  useEffect(() => {
    if (!draft.artefact_type_id && strategyTypes.length > 0) {
      setDraft((d) => ({ ...d, artefact_type_id: strategyTypes[0].id }));
    }
  }, [strategyTypes, draft.artefact_type_id]);

  // Reset parent selection when type changes - the candidate set changes too.
  useEffect(() => {
    setDraft((d) => ({ ...d, parent_artefact_id: "" }));
  }, [draft.artefact_type_id]);

  const parentRequired = !!selectedType?.parent_type_id;
  const parentReady    = !parentRequired || !!draft.parent_artefact_id;

  async function createItem() {
    if (!draft.artefact_type_id || !draft.title.trim() || !parentReady) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/v2/strategy-items", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          artefact_type_id:   draft.artefact_type_id,
          parent_artefact_id: draft.parent_artefact_id || null,
          title:              draft.title.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setDraft((d) => ({ ...d, title: "" }));
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  }

  async function renameItem(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const res = await fetch(`/api/v2/strategy-items/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ title: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to rename");
    }
  }

  async function archiveItem(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/v2/strategy-items/${id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setArchiveArmed(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to archive");
    }
  }

  // Variants for the type pill so each strategy layer reads distinctly.
  function variantForLayer(depth: number | null): "neutral" | "info" | "success" {
    if (depth === 0) return "info";
    if (depth === 1) return "success";
    return "neutral";
  }

  return (
    <>
      <header style={{ marginBottom: "16px" }}>
        <h1 className="page-title">Portfolio Model (v2)</h1>
        <p className="page-subtitle">
          Phase 2 PoC against vector_artefacts. Theme &gt; Business Objective &gt; Feature.
        </p>
      </header>
      <div className="form__row form__row--inline" style={{ alignItems: "center" }}>
        <span className="pill pill--warning">Vector Artefacts · PoC</span>
        <span className="form__hint">
          This page reads/writes the new <code>vector_artefacts</code> database
          directly. Production <a href="/portfolio-model">/portfolio-model</a> is unaffected.
        </span>
      </div>

      <Panel name="portfolio_model_v2_list" title="Strategy artefacts">
        {error && <p className="form__error">{error}</p>}

        <div className="settings-panel__header">
          <h3 className="eyebrow">Strategy artefacts in PoC subscription</h3>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => setShowCreate((v) => !v)}
            disabled={strategyTypes.length === 0}
          >
            {showCreate ? "Cancel" : "+ New strategy item"}
          </button>
        </div>

        {showCreate && (
          <div className="form__row">
            <label className="form__label">
              Type
              <select
                className="form__select"
                value={draft.artefact_type_id}
                onChange={(e) => setDraft((d) => ({ ...d, artefact_type_id: e.target.value }))}
              >
                {strategyTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.prefix} · {t.name}</option>
                ))}
              </select>
            </label>

            {parentRequired && (
              <label className="form__label">
                Parent
                <select
                  className="form__select"
                  value={draft.parent_artefact_id}
                  onChange={(e) => setDraft((d) => ({ ...d, parent_artefact_id: e.target.value }))}
                >
                  <option value="">— pick a parent —</option>
                  {parentCandidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.type_prefix}-{p.number} · {p.title}
                    </option>
                  ))}
                </select>
                {parentCandidates.length === 0 && (
                  <span className="form__hint">
                    No eligible parent yet — create one first.
                  </span>
                )}
              </label>
            )}

            <label className="form__label" style={{ flex: 1 }}>
              Title
              <input
                type="text"
                className="form__input"
                placeholder="Improve activation rate"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") void createItem(); }}
              />
            </label>
            <div className="form__actions">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={createItem}
                disabled={
                  saving
                  || !draft.title.trim()
                  || (parentRequired && !draft.parent_artefact_id)
                }
              >
                {saving ? "Saving…" : "Create"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="form__hint">Loading…</p>
        ) : items.length === 0 ? (
          <div className="empty-state">
            No strategy items yet. Create the first one above.
          </div>
        ) : (
          <Table<StrategyItem>
            pageId="portfolio-model-v2"
            slot="list"
            ariaLabel="Strategy artefacts in PoC subscription"
            rows={items}
            rowKey={(r) => r.id}
            columns={[
              { key: "id", header: "ID", width: 110,
                kind: "custom",
                render: (r) => <code className="form__hint">{r.type_prefix}-{r.number}</code>,
              },
              { key: "type",  header: "Type", width: 180,
                kind: "pill",
                pillVariant: (r) => variantForLayer(r.layer_depth),
                pillLabel:   (r) => r.type_name,
              },
              { key: "title", header: "Title",
                kind: "custom",
                render: (r) => editingId === r.id ? (
                  <input
                    type="text"
                    className="form__input"
                    autoFocus
                    defaultValue={r.title}
                    onBlur={(e) => void renameItem(r.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renameItem(r.id, e.currentTarget.value);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ justifyContent: "flex-start", textAlign: "left", width: "100%" }}
                    onClick={() => setEditingId(r.id)}
                  >
                    {r.title}
                  </button>
                ),
              },
              { key: "parent", header: "Parent", width: 240,
                kind: "custom",
                render: (r) => r.parent_artefact_id ? (
                  <span className="form__hint">
                    {r.parent_prefix}-{r.parent_number} · {r.parent_title}
                  </span>
                ) : <span className="form__hint">—</span>,
              },
              { key: "actions", header: "", width: 180,
                kind: "custom",
                render: (r) => archiveArmed === r.id ? (
                  <span className="form__actions form__actions--inline">
                    <button
                      type="button"
                      className="btn btn--danger btn--sm"
                      onClick={() => archiveItem(r.id)}
                    >
                      Confirm archive
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setArchiveArmed(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setArchiveArmed(r.id)}
                  >
                    Archive
                  </button>
                ),
              },
            ]}
          />
        )}
      </Panel>
    </>
  );
}
