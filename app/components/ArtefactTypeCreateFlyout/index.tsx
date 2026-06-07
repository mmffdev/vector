"use client";

import { useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import { ColourPicker } from "@/app/components/ColourPicker";
import { notify } from "@/app/lib/toast";
import { ApiError } from "@/app/lib/api";
import {
  artefactTypesApi, type ArtefactType, type InsertLayerPreview,
} from "@/app/lib/artefactTypesApi";

type Scope = "work" | "strategy";

export function ArtefactTypeCreateFlyout({
  types, onClose, onCreated,
}: {
  types: ArtefactType[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [scope, setScope] = useState<Scope | null>(null);
  const [tag, setTag] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colour, setColour] = useState<string | null>(null);
  const [behavesLike, setBehavesLike] = useState("");
  const [childTypeId, setChildTypeId] = useState("");
  const [preview, setPreview] = useState<InsertLayerPreview | null>(null);
  const [busy, setBusy] = useState(false);

  const workTypes = useMemo(() => types.filter((t) => t.scope === "work"), [types]);

  // Valid gaps: every strategy type that HAS a parent (so we never insert above
  // the root) — selecting it inserts between it and its current parent.
  const gapChildren = useMemo(
    () => types.filter((t) => t.scope === "strategy" && t.parent_type_id != null)
      .sort((a, b) => (a.layer_depth ?? 99) - (b.layer_depth ?? 99)),
    [types],
  );

  const submitWork = async () => {
    setBusy(true);
    try {
      await artefactTypesApi.create({
        scope: "work", tag, name,
        description: description || null, colour,
        behaves_like_type_id: behavesLike,
      });
      notify.success(`Created work type “${name}”.`);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.violations) {
        notify.error(err.violations.map((v) => v.message).join("; "));
      } else notify.apiError(err, "Failed to create type.");
    } finally { setBusy(false); }
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const p = await artefactTypesApi.previewInsertLayer({
        tag, name, description: description || null, colour, child_type_id: childTypeId,
      });
      setPreview(p);
      if (p.rejection) notify.error(p.rejection);
    } catch (err) { notify.apiError(err, "Preview failed."); }
    finally { setBusy(false); }
  };

  const confirmInsert = async () => {
    setBusy(true);
    try {
      const res = await artefactTypesApi.insertLayer({
        tag, name, description: description || null, colour, child_type_id: childTypeId,
      });
      notify.success(`Inserted “${name}” — ${res.created_count} pass-through artefacts created.`);
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.violations) {
        notify.error(err.violations.map((v) => v.message).join("; "));
      } else notify.apiError(err, "Insert failed.");
    } finally { setBusy(false); }
  };

  return (
    <aside className="topo-flyout" role="dialog" aria-label="Create artefact type">
      <header className="topo-flyout__head">
        <h2 className="modal__title">New artefact type</h2>
        <button type="button" className="btn btn--icon btn--ghost btn--sm" aria-label="Close panel" onClick={onClose}>×</button>
      </header>
      <Panel name="artefact_type_create_flyout" className="panel--bare topo-flyout__panel">
        <div className="topo-flyout__body">
          <fieldset className="form__row">
            <legend className="form__label">Scope</legend>
            <label><input type="radio" name="scope" checked={scope === "work"} onChange={() => setScope("work")} /> Work</label>
            <label><input type="radio" name="scope" checked={scope === "strategy"} onChange={() => setScope("strategy")} /> Strategy</label>
          </fieldset>

          {scope && (
            <>
              <label className="form__row">
                <span className="form__label">Tag</span>
                <input className="form__input" aria-label="Tag" value={tag}
                  maxLength={4} onChange={(e) => setTag(e.target.value.toUpperCase())} />
              </label>
              <label className="form__row">
                <span className="form__label">Name</span>
                <input className="form__input" aria-label="Name" value={name}
                  maxLength={64} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="form__row">
                <span className="form__label">Description</span>
                <textarea className="form__textarea" value={description} rows={3}
                  onChange={(e) => setDescription(e.target.value)} />
              </label>
              <div className="form__row">
                <span className="form__label">Colour</span>
                <ColourPicker value={colour} onChange={setColour} />
              </div>
            </>
          )}

          {scope === "work" && (
            <label className="form__row">
              <span className="form__label">Behaves like</span>
              <select className="form__input" aria-label="Behaves like" value={behavesLike}
                onChange={(e) => setBehavesLike(e.target.value)}>
                <option value="">— choose a rung —</option>
                {workTypes.map((t) => <option key={t.id} value={t.id}>{t.prefix} — {t.name}</option>)}
              </select>
            </label>
          )}

          {scope === "strategy" && (
            <>
              <label className="form__row">
                <span className="form__label">Insert between</span>
                <select className="form__input" aria-label="Insert between" value={childTypeId}
                  onChange={(e) => { setChildTypeId(e.target.value); setPreview(null); }}>
                  <option value="">— choose a gap —</option>
                  {gapChildren.map((t) => {
                    const parent = types.find((p) => p.id === t.parent_type_id);
                    return <option key={t.id} value={t.id}>{parent?.name} → {t.name}</option>;
                  })}
                </select>
              </label>
              {preview && !preview.rejection && (
                <div className="form__row at-impact">
                  <p className="form__hint">
                    Inserting “{name}” between {preview.parent_layer.name} and {preview.child_layer.name} will
                    create {preview.passthrough_count} pass-through artefacts.
                  </p>
                  <ul className="at-impact__list">
                    {preview.impacted.map((i) => (
                      <li key={i.id}>{i.name}{i.current_parent_name ? ` (under ${i.current_parent_name})` : ""}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          <div className="topo-flyout__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
            {scope === "work" && (
              <button type="button" className="btn btn--primary" onClick={submitWork}
                disabled={busy || !tag || !name || !behavesLike}>Create</button>
            )}
            {scope === "strategy" && !preview && (
              <button type="button" className="btn btn--primary" onClick={runPreview}
                disabled={busy || !tag || !name || !childTypeId}>Preview impact</button>
            )}
            {scope === "strategy" && preview && !preview.rejection && (
              <button type="button" className="btn btn--primary" onClick={confirmInsert}
                disabled={busy}>Confirm insert</button>
            )}
          </div>
        </div>
      </Panel>
    </aside>
  );
}
