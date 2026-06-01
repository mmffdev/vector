"use client";

// <FormBuilderShell> — fullscreen drag-and-drop form layout builder.
//
// Opens above the rails + shell (fixed overlay). Layout:
//   ┌──────────────────────────────────────────────────────────┐
//   │ Save / Cancel                                  top-right  │
//   ├───────────────┬──────────────────────────────────────────┤
//   │ 20% sidebar   │ 80% canvas                                │
//   │  Core (must)  │  rows → cells (snap-to-slot grid)         │
//   │  Custom       │  + add-row (template picker)              │
//   │  + new field  │                                           │
//   └───────────────┴──────────────────────────────────────────┘
//
// Drag model (@dnd-kit):
//   - Sidebar field → empty cell  : place
//   - Sidebar field → row gap      : insert as new full-width row (push down)
//   - Placed cell   → empty cell  : move (swap-aware)
//   - Placed cell   → sidebar dropzone : remove (send back to list)
//
// SERVER IS THE GATE: save POSTs and the server re-validates mandatory
// core-field presence; we mirror it client-side only for live UX (the
// Save button shows which mandatory fields are still missing).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BsArrowReturnLeft, BsArrowCounterclockwise, BsArrowClockwise } from "react-icons/bs";
import { TbLayoutList } from "react-icons/tb";
import { JoinArrowIcon } from "./JoinArrowIcon";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  pointerWithin,
  rectIntersection,
  type DragStartEvent,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  getCoreFields,
  getLayoutForBuilder,
  saveLayout,
  saveDraft,
  extractValidation,
  type CoreFieldDescriptor,
  type FormCell,
  type FormRow,
  type RowTemplate,
} from "@/app/lib/formLayoutsApi";
import { ROW_TEMPLATES, TEMPLATE_SPANS } from "@/app/lib/formLayoutsApi";
import { useSentinel } from "@/app/sentinel";
import CustomFieldEditForm from "@/app/components/CustomFields/CustomFieldEditForm";
import { FormLayoutRenderer, type RenderCellArgs } from "./FormLayoutRenderer";
import type { MergeGroup } from "./mergeTransitions";
import { normalizeOwnership } from "./mergeTransitions";
import { type ArtefactType } from "@/app/lib/artefactTypesApi";
import { groupByScope } from "./artefactTypeGroups";
import { PreviewDataPicker } from "./PreviewDataPicker";
import {
  useFormBuilderState,
  type CellAddr,
} from "./useFormBuilderState";

export interface FormBuilderShellProps {
  nodeId: string;
  nodeName?: string;
  artefactTypeId: string;
  artefactTypeLabel?: string;
  /** Full artefact-type catalogue, for the in-builder type switcher. When
   *  provided (with onSelectType), the header renders a "Create new form"
   *  dropdown so the author can re-target to another type WITHOUT exiting. */
  types?: ArtefactType[];
  /** Called when the author picks a different type in the in-builder switcher.
   *  The parent updates the selected type → the shell reloads that layout. */
  onSelectType?: (typeId: string) => void;
  onClose: () => void;
  onSaved?: () => void;
}

// Live timestamp for the title sub-line — MUST match the rail-2 node block's
// date line exactly (app/redesign/components/nav_primary_rail_2.tsx formatNow),
// so the title is pixel-identical to the node title it overlays and nothing
// jumps when the builder opens.
function formatNow(d: Date): string {
  const date = d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${date} · ${time}`;
}

// Drag payload kinds. A sidebar drag carries a fieldKey; a canvas drag
// carries the source cell address.
type DragData =
  | { kind: "sidebar"; fieldKey: string }
  | { kind: "cell"; addr: CellAddr; fieldKey: string }
  | { kind: "row"; rowIndex: number; count: number };

// Droppable id schemes:
//   cell:<rowIndex>:<cellIndex>  — an empty/occupied slot
//   gap:<rowIndex>               — the gap above row rowIndex (insert-push)
//   sidebar-dropzone             — remove target
function cellDroppableId(addr: CellAddr) {
  return `cell:${addr.rowIndex}:${addr.cellIndex}`;
}
function parseDroppableId(id: string): { type: "cell"; addr: CellAddr } | { type: "gap"; rowIndex: number } | { type: "sidebar" } | null {
  if (id === "sidebar-dropzone") return { type: "sidebar" };
  if (id.startsWith("cell:")) {
    const [, r, c] = id.split(":");
    return { type: "cell", addr: { rowIndex: Number(r), cellIndex: Number(c) } };
  }
  if (id.startsWith("gap:")) {
    const [, r] = id.split(":");
    return { type: "gap", rowIndex: Number(r) };
  }
  return null;
}

// Collision detection: prefer pointerWithin (the cursor literally inside a
// droppable) so the THIN row-gaps between tall bands are reliably hittable when
// reordering a row; fall back to rectIntersection for the wider cell targets
// when the pointer isn't over any droppable. Default dnd-kit rectIntersection
// alone loses the thin gaps to the large adjacent band rects.
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : rectIntersection(args);
};

export function FormBuilderShell({
  nodeId,
  nodeName,
  artefactTypeId,
  artefactTypeLabel,
  types,
  onSelectType,
  onClose,
  onSaved,
}: FormBuilderShellProps) {
  const { sentinel_user } = useSentinel();
  const workspaceId = sentinel_user?.workspace_id ?? null;

  const [fields, setFields] = useState<CoreFieldDescriptor[]>([]);

  // Compulsory set drives only the save gate and the sidebar grouping —
  // never the canvas. The author places these fields wherever they like; the
  // gate (here for live UX, server-side for real) just requires each one be
  // placed SOMEWHERE before save. Derived from the catalogue, so it updates
  // once getCoreFields resolves.
  const compulsoryKeys = useMemo(
    () => fields.filter((f) => f.isCompulsory).map((f) => f.fieldKey),
    [fields],
  );

  const state = useFormBuilderState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [previewing, setPreviewing] = useState(false);
  // Baseline = the rows as loaded (published current OR a reloaded draft).
  // Cancel only prompts when the canvas diverges from this, so an untouched
  // open closes silently. Compared by serialising fieldKey/template shape.
  const [baseline, setBaseline] = useState<string>(serializeRows([]));
  // Persisted status of the layout currently loaded, for the title flag:
  //   "draft" — a saved WIP draft is the source; "live" — a published current
  //   version; "none" — nothing saved yet for this (node, type). Combined with
  //   isDirty below to produce the (Unsaved/Draft/Live) badge.
  const [savedStatus, setSavedStatus] = useState<"none" | "draft" | "live">("none");
  const [confirmCancel, setConfirmCancel] = useState(false);
  // In-builder type switch: when the author picks a different type with unsaved
  // edits, we stash the target here and raise the discard confirm; on confirm we
  // call onSelectType(pendingTypeId). Null = no pending switch.
  const [pendingTypeId, setPendingTypeId] = useState<string | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  // Transient "Draft saved" confirmation; cleared after a few seconds.
  const [draftToast, setDraftToast] = useState<string | null>(null);
  // Add-custom-field overlay: when true, the create form mounts above the
  // canvas with the current artefact type force-bound (lockedTypeId).
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  // Debug poles: NORMAL mode (default) draws the quiet sandy/white merge pole +
  // hides the blocked pole; DEBUG mode restores the bright yellow/black + red/white
  // diagnostic scheme. Toggled in the header; applied via .flb-debug-poles on the
  // overlay root (see globals.css). Off by default — bright poles are a dev aid.
  const [debugPoles, setDebugPoles] = useState(false);

  // Live clock for the title sub-line — ticks every second to mirror the
  // rail-2 node block's date line exactly (see formatNow above).
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  // Refetch just the sidebar field catalogue without disturbing the
  // in-progress layout (state.rows). Called after the add-custom-field
  // overlay creates a field so it appears in the Custom section immediately.
  const reloadFields = useCallback(async () => {
    try {
      const cat = await getCoreFields(artefactTypeId);
      setFields(cat);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to reload fields");
    }
  }, [artefactTypeId]);

  // Load the field catalogue + any existing layout for this (node, type).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // Draft-aware load: a saved draft takes precedence over the
        // published current, so reopening resumes WIP ("so when you go back
        // it's there"). The runtime renderer keeps using getCurrentLayout.
        const [cat, existing] = await Promise.all([
          getCoreFields(artefactTypeId),
          getLayoutForBuilder(nodeId, artefactTypeId),
        ]);
        if (cancelled) return;
        setFields(cat);
        // Canvas starts from whatever layout exists (empty for a fresh
        // form). Compulsory fields are NOT pre-placed — the author drags
        // them in and positions them freely; the save gate enforces presence.
        const initialRows = existing?.doc.rows ?? [];
        state.reset(initialRows);
        setBaseline(serializeRows(initialRows));
        setSavedStatus(!existing ? "none" : existing.isDraft ? "draft" : "live");
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load builder");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId, artefactTypeId]);

  const fieldByKey = useMemo(() => {
    const m = new Map<string, CoreFieldDescriptor>();
    for (const f of fields) m.set(f.fieldKey, f);
    return m;
  }, [fields]);

  // Compulsory fields not yet placed anywhere on the canvas (live UX mirror
  // of the server gate). Blocks save until every compulsory field is placed.
  // The server re-validates regardless (SERVER IS THE GATE).
  const missingCompulsory = useMemo(
    () => compulsoryKeys.filter((k) => !state.placedKeys.has(k)),
    [compulsoryKeys, state.placedKeys],
  );

  // Dirty = canvas diverges from what was loaded. Drives the Cancel confirm
  // (only prompt when there's unsaved work to lose).
  const isDirty = useMemo(
    () => serializeRows(state.rows) !== baseline,
    [state.rows, baseline],
  );
  // Title status flag, in precedence order: Unsaved (dirty edits) > Draft (saved
  // WIP) > Live (published current) > New (nothing saved for this node+type yet).
  const titleStatus = useMemo(() => {
    if (isDirty) return { label: "Unsaved", tone: "unsaved" };
    if (savedStatus === "live") return { label: "Live", tone: "live" };
    if (savedStatus === "draft") return { label: "Draft", tone: "draft" };
    return { label: "New", tone: "new" };
  }, [isDirty, savedStatus]);

  // Sidebar partitions fields into two labelled groups: Mandatory (the
  // per-type compulsory set, which MUST be placed to save) and Available
  // (everything else — optional core ∪ custom, distinguished by their
  // data-type tag). A search box filters both by label.
  const [fieldQuery, setFieldQuery] = useState("");
  const matchesQuery = useCallback(
    (f: CoreFieldDescriptor) =>
      fieldQuery.trim() === "" ||
      f.label.toLowerCase().includes(fieldQuery.trim().toLowerCase()),
    [fieldQuery],
  );
  const mandatoryFields = fields.filter((f) => f.isCompulsory && matchesQuery(f));
  const availableFields = fields.filter((f) => !f.isCompulsory && matchesQuery(f));

  function onDragStart(e: DragStartEvent) {
    setActiveDrag((e.active.data.current as DragData) ?? null);
  }

  function onDragEnd(e: DragEndEvent) {
    const drag = (e.active.data.current as DragData) ?? null;
    setActiveDrag(null);
    if (!drag || !e.over) return;
    const target = parseDroppableId(String(e.over.id));
    if (!target) return;

    if (target.type === "sidebar") {
      if (drag.kind === "cell") state.clearCell(drag.addr);
      return;
    }
    if (target.type === "gap") {
      // A row/group dragged onto a gap reorders the WHOLE group (merges intact);
      // a field reorders into a new full-width row at that position.
      if (drag.kind === "row") {
        state.moveGroup(drag.rowIndex, drag.count, target.rowIndex);
        return;
      }
      const key = drag.fieldKey;
      if (drag.kind === "cell") state.clearCell(drag.addr);
      state.insertFieldAsRow(key, target.rowIndex);
      return;
    }
    // target.type === "cell"
    if (drag.kind === "row") return; // rows only drop on gaps
    if (drag.kind === "sidebar") {
      state.placeField(drag.fieldKey, target.addr);
    } else {
      state.moveField(drag.addr, target.addr);
    }
  }

  async function handleSave() {
    setSaveError(null);
    if (missingCompulsory.length > 0) {
      setSaveError(
        "Place these required fields before saving: " +
          missingCompulsory.map((k) => fieldByKey.get(k)?.label ?? k).join(", "),
      );
      return;
    }
    setSaving(true);
    try {
      // Normalise tombstone ownership from the owners' spans before persisting,
      // so a stale/cross-wired absorbedBy (from an overlapping merge / drag /
      // undo) can never reach the server's rectangle validator. See
      // normalizeOwnership.
      await saveLayout({ nodeId, artefactTypeId, rows: normalizeOwnership(state.rows) });
      onSaved?.();
      onClose();
    } catch (err) {
      const v = extractValidation(err);
      if (v) {
        setSaveError(
          v.error + (v.missing.length ? " — missing: " + v.missing.join(", ") : ""),
        );
      } else {
        setSaveError(err instanceof Error ? err.message : "Save failed");
      }
    } finally {
      setSaving(false);
    }
  }

  // Save as Draft: persists WIP without the compulsory gate or version flip.
  // Stays open + toasts (per the design); the saved rows become the new
  // baseline so an immediate Cancel won't re-prompt over already-saved work.
  async function handleSaveDraft() {
    setSaveError(null);
    setDraftSaving(true);
    try {
      const normalized = normalizeOwnership(state.rows);
      await saveDraft({ nodeId, artefactTypeId, rows: normalized });
      setBaseline(serializeRows(normalized));
      setSavedStatus("draft"); // it's now a saved draft, no longer dirty
      setDraftToast("Draft saved — it'll be here when you come back.");
    } catch (err) {
      const v = extractValidation(err);
      setSaveError(
        v
          ? v.error + (v.missing.length ? " — missing: " + v.missing.join(", ") : "")
          : err instanceof Error
            ? err.message
            : "Could not save draft",
      );
    } finally {
      setDraftSaving(false);
    }
  }

  // Cancel: prompt only when there's unsaved work (isDirty). An untouched
  // canvas closes immediately — no nagging.
  function handleCancel() {
    if (isDirty) {
      setConfirmCancel(true);
      return;
    }
    onClose();
  }

  // In-builder type switch: re-target the open builder to another artefact type
  // for the SAME node, without exiting. Guards unsaved work — a dirty canvas
  // raises the discard confirm (which, on confirm, performs the stashed switch);
  // a clean canvas switches immediately. No-op if the chosen type is the current
  // one or the parent didn't wire onSelectType.
  function handleSwitchType(typeId: string) {
    if (!onSelectType || typeId === artefactTypeId || typeId === "") return;
    if (isDirty) {
      setPendingTypeId(typeId);
      setConfirmCancel(true);
      return;
    }
    onSelectType(typeId);
  }

  // Grouped catalogue for the in-builder switcher dropdown (Strategic / Execution).
  const typeGroups = useMemo(() => groupByScope(types ?? []), [types]);

  // Clear the draft toast a few seconds after it appears.
  useEffect(() => {
    if (!draftToast) return;
    const t = setTimeout(() => setDraftToast(null), 4000);
    return () => clearTimeout(t);
  }, [draftToast]);

  // Undo / redo keyboard shortcuts — ⌘Z / Ctrl+Z (undo), ⌘⇧Z / Ctrl+Y (redo).
  // Scoped to the builder (the overlay is modal). Ignored while typing in an
  // input/textarea/contenteditable, and while previewing.
  useEffect(() => {
    if (previewing) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const key = e.key.toLowerCase();
      const isRedo = (key === "z" && e.shiftKey) || key === "y";
      const isUndo = key === "z" && !e.shiftKey;
      if (isRedo) { e.preventDefault(); state.redo(); }
      else if (isUndo) { e.preventDefault(); state.undo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewing, state]);

  return (
    <div
      className={"flb-overlay" + (debugPoles ? " flb-debug-poles" : "")}
      role="dialog"
      aria-modal="true"
      aria-label="Form layout builder"
    >
      <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <header className="flb-overlay__Bar">
          {/* Vector logo — pinned to the EXACT same screen position as the
              primary-rail logo (40×40 centred in the 100px rail/header gutter,
              i.e. left 30px, vertical-centre in the 100px bar) so it does not
              jump when the overlay mounts over the app shell. */}
          <span className="flb-overlay__Bar_Brand" aria-hidden="true">
            <img src="/logo-vector.png" alt="Vector" className="flb-overlay__Bar_Brand_Logo" />
          </span>
          <div className="flb-overlay__Bar_Title">
            {/* Title is pixel-aligned to the rail-2 TOPOLOGY-NODE block it
                overlays (.rail-2__title + .rail-2__date), NOT the main page
                title — so nothing jumps when the builder opens over the app.
                Title line = node + artefact type + status flag (16px/600,
                matching .rail-2__title); sub-line = the SAME live timestamp the
                rail shows (10px, .rail-2__date). Status: Unsaved > Draft > Live
                > New. */}
            <span className="flb-overlay__Bar_Title_Main">
              {nodeName ?? "This node"} — {artefactTypeLabel ?? "Artefact"} Form
              <span
                className={"flb-overlay__Bar_Status flb-overlay__Bar_Status-" + titleStatus.tone}
                aria-label={"Status: " + titleStatus.label}
              >
                {titleStatus.label}
              </span>
            </span>
            <span className="flb-overlay__Bar_Title_Sub" aria-live="off">{formatNow(now)}</span>
          </div>
          <div className="flb-overlay__Bar_Actions">
            {/* In-builder form switcher — re-target to another artefact type on
                this SAME node without exiting (mirrors the launch panel's "Create
                new form" picker). Guards unsaved work via the discard confirm. */}
            {onSelectType && types && types.length > 0 && (
              <label className="flb-overlay__Bar_Switch" title="Switch to another form on this node">
                <span className="flb-overlay__Bar_Switch_Label">Form</span>
                <select
                  className="flb-overlay__Bar_Switch_Select"
                  value={artefactTypeId}
                  disabled={previewing}
                  onChange={(e) => handleSwitchType(e.target.value)}
                  aria-label="Switch form — pick an artefact type to build for this node"
                >
                  {typeGroups.strategic.length > 0 && (
                    <optgroup label="Strategic">
                      {typeGroups.strategic.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </optgroup>
                  )}
                  {typeGroups.execution.length > 0 && (
                    <optgroup label="Execution">
                      {typeGroups.execution.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>
            )}
            <button
              type="button"
              className={"flb-btn flb-btn-ghost" + (debugPoles ? " flb-btn-active" : "")}
              onClick={() => setDebugPoles((d) => !d)}
              aria-pressed={debugPoles}
              title={debugPoles
                ? "Debug poles ON — bright merge guides. Click for normal (quiet) poles."
                : "Show debug merge poles (bright yellow/black + red/white guides)"}
            >
              {debugPoles ? "Debug poles: on" : "Debug poles"}
            </button>
            <button
              type="button"
              className="flb-btn flb-btn-icon"
              onClick={state.undo}
              disabled={!state.canUndo || previewing}
              title="Undo (⌘Z)"
              aria-label="Undo"
            >
              <BsArrowCounterclockwise aria-hidden="true" />
            </button>
            <button
              type="button"
              className="flb-btn flb-btn-icon"
              onClick={state.redo}
              disabled={!state.canRedo || previewing}
              title="Redo (⌘⇧Z)"
              aria-label="Redo"
            >
              <BsArrowClockwise aria-hidden="true" />
            </button>
            <button
              type="button"
              className={"flb-btn flb-btn-ghost" + (previewing ? " flb-btn-active" : "")}
              onClick={() => setPreviewing((p) => !p)}
              disabled={loading || state.rows.length === 0}
              aria-pressed={previewing}
              title={previewing ? "Back to editing the layout" : "Preview the form full-screen"}
            >
              {previewing ? "Edit layout" : "Preview form"}
            </button>
            <button
              type="button"
              className="flb-btn flb-btn-ghost"
              onClick={handleCancel}
              disabled={saving || draftSaving}
            >
              Cancel
            </button>
            <button
              type="button"
              className="flb-btn flb-btn-secondary"
              onClick={handleSaveDraft}
              disabled={draftSaving || saving || loading}
              title="Save your progress without publishing — resumes here next time"
            >
              {draftSaving ? "Saving draft…" : "Save as Draft"}
            </button>
            <button
              type="button"
              className="flb-btn flb-btn-primary"
              onClick={handleSave}
              disabled={saving || draftSaving || loading}
            >
              {saving ? "Saving…" : "Save layout"}
            </button>
          </div>
        </header>

        {saveError && <div className="flb-overlay__Banner flb-overlay__Banner-error">{saveError}</div>}
        {draftToast && (
          <div className="flb-overlay__Banner flb-overlay__Banner-ok" role="status">{draftToast}</div>
        )}

        {previewing ? (
          <main className="flb-canvas-wrap flb-canvas-wrap-preview">
            <FormPreview
              rows={state.rows}
              fieldByKey={fieldByKey}
              artefactTypeId={artefactTypeId}
              typeLabel={artefactTypeLabel ?? "artefact"}
            />
          </main>
        ) : (
          <div className="flb-overlay__Body">
            <Sidebar
              loading={loading}
              loadError={loadError}
              mandatoryFields={mandatoryFields}
              availableFields={availableFields}
              placedKeys={state.placedKeys}
              query={fieldQuery}
              onQueryChange={setFieldQuery}
              canAddField={!!workspaceId}
              onAddField={() => setAddFieldOpen(true)}
            />

            <main className="flb-canvas-wrap">
              {/* Row-template picker — centred at the TOP, above the form. */}
              <TemplatePicker onAdd={state.addRow} />

              {loading ? (
                <div className="flb-canvas-empty">Loading…</div>
              ) : state.rows.length === 0 ? (
                <div className="flb-canvas-empty">
                  <p>Add a row to begin, then drag fields from the left into the slots.</p>
                </div>
              ) : (
                <Canvas state={state} fieldByKey={fieldByKey} rowDragActive={activeDrag?.kind === "row"} />
              )}
            </main>
          </div>
        )}

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            activeDrag.kind === "row" ? (
              <div className="flb-chip flb-chip-dragging">
                {activeDrag.count > 1
                  ? `Group · rows ${activeDrag.rowIndex + 1}–${activeDrag.rowIndex + activeDrag.count}`
                  : `Row ${activeDrag.rowIndex + 1}`}
              </div>
            ) : (
              <div className="flb-chip flb-chip-dragging">
                {fieldByKey.get(activeDrag.fieldKey)?.label ?? activeDrag.fieldKey}
              </div>
            )
          ) : null}
        </DragOverlay>
      </DndContext>

      {addFieldOpen && workspaceId && (
        <div className="flb-fieldmodal" role="dialog" aria-modal="true" aria-label="Add custom field">
          <div className="flb-fieldmodal__Scrim" onClick={() => setAddFieldOpen(false)} />
          <div className="flb-fieldmodal__Card">
            <header className="flb-fieldmodal__Head">
              <h3 className="flb-fieldmodal__Title">
                New custom field — {artefactTypeLabel ?? "this type"}
              </h3>
              <p className="flb-fieldmodal__Sub">
                This field will be bound to {artefactTypeLabel ?? "the current type"} (locked). Tick
                additional types to make it available on their forms too.
              </p>
            </header>
            <div className="flb-fieldmodal__Body">
              <CustomFieldEditForm
                workspaceId={workspaceId}
                initial={null}
                lockedTypeId={artefactTypeId}
                onCancel={() => setAddFieldOpen(false)}
                onSaved={() => {
                  setAddFieldOpen(false);
                  void reloadFields();
                }}
              />
            </div>
          </div>
        </div>
      )}

      {confirmCancel && (
        <div className="flb-confirm" role="dialog" aria-modal="true" aria-label="Discard unsaved changes">
          <div
            className="flb-confirm__Scrim"
            onClick={() => { setConfirmCancel(false); setPendingTypeId(null); }}
          />
          <div className="flb-confirm__Card">
            <h3 className="flb-confirm__Title">Discard unsaved changes?</h3>
            <p className="flb-confirm__Body">
              You have unsaved changes to this layout.{" "}
              {pendingTypeId ? "Switching forms" : "Leaving"} now loses them.
              Use <strong>Save as Draft</strong> if you want to come back to it.
            </p>
            <div className="flb-confirm__Actions">
              <button
                type="button"
                className="flb-btn flb-btn-ghost"
                onClick={() => { setConfirmCancel(false); setPendingTypeId(null); }}
              >
                Keep editing
              </button>
              <button
                type="button"
                className="flb-btn flb-btn-secondary"
                onClick={async () => {
                  setConfirmCancel(false);
                  await handleSaveDraft();
                  // pendingTypeId → switch to the new form; else close the overlay.
                  if (pendingTypeId) {
                    const next = pendingTypeId;
                    setPendingTypeId(null);
                    onSelectType?.(next);
                  } else {
                    onClose();
                  }
                }}
              >
                Save as Draft &amp; {pendingTypeId ? "switch" : "close"}
              </button>
              <button
                type="button"
                className="flb-btn flb-btn-danger"
                onClick={() => {
                  setConfirmCancel(false);
                  if (pendingTypeId) {
                    const next = pendingTypeId;
                    setPendingTypeId(null);
                    onSelectType?.(next);
                  } else {
                    onClose();
                  }
                }}
              >
                Discard &amp; {pendingTypeId ? "switch" : "close"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// serializeRows reduces a layout to its meaningful shape (template + ordered
// fieldKeys per row), ignoring volatile cell/row ids. Used for the dirty
// check so reordering or re-placing fields is detected but id churn isn't.
function serializeRows(rows: FormRow[]): string {
  return JSON.stringify(
    rows.map((r) => ({
      t: r.template,
      c: r.cells.map((c) => ({ k: c.fieldKey, s: c.rowSpan ?? 1, a: c.absorbedBy ?? null })),
    })),
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────

function Sidebar({
  loading,
  loadError,
  mandatoryFields,
  availableFields,
  placedKeys,
  query,
  onQueryChange,
  canAddField,
  onAddField,
}: {
  loading: boolean;
  loadError: string | null;
  mandatoryFields: CoreFieldDescriptor[];
  availableFields: CoreFieldDescriptor[];
  placedKeys: Set<string>;
  query: string;
  onQueryChange: (q: string) => void;
  canAddField: boolean;
  onAddField: () => void;
}) {
  // Sidebar is itself a droppable: dropping a placed cell here removes it.
  const { setNodeRef, isOver } = useDroppable({ id: "sidebar-dropzone" });
  // Count of not-yet-placed available fields — shown in the group's badge.
  const availableUnplaced = availableFields.filter((f) => !placedKeys.has(f.fieldKey)).length;
  return (
    <aside
      ref={setNodeRef}
      className={"flb-sidebar" + (isOver ? " flb-sidebar-removeover" : "")}
    >
      {loadError && <div className="flb-sidebar__Error">{loadError}</div>}

      <div className="flb-sidebar__Search">
        <span className="flb-sidebar__Search_Icon" aria-hidden="true">⌕</span>
        <input
          type="search"
          className="flb-sidebar__Search_Input"
          placeholder="Search fields"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label="Search fields"
        />
      </div>

      <SidebarSection title="Mandatory fields" hint="Must be placed to save">
        {loading ? (
          <div className="flb-sidebar__Skel" />
        ) : mandatoryFields.length === 0 ? (
          <p className="flb-sidebar__Empty">
            {query ? "No matching mandatory fields." : "No mandatory fields for this type."}
          </p>
        ) : (
          mandatoryFields.map((f) => (
            <SidebarField key={f.fieldKey} field={f} placed={placedKeys.has(f.fieldKey)} />
          ))
        )}
      </SidebarSection>

      <SidebarSection title="Available fields" badge={loading ? undefined : availableUnplaced}>
        {loading ? (
          <div className="flb-sidebar__Skel" />
        ) : availableFields.length === 0 ? (
          <p className="flb-sidebar__Empty">
            {query ? "No matching fields." : "No available fields."}
          </p>
        ) : (
          availableFields.map((f) => (
            <SidebarField key={f.fieldKey} field={f} placed={placedKeys.has(f.fieldKey)} />
          ))
        )}
        {canAddField && (
          <button
            type="button"
            className="flb-sidebar__AddField"
            onClick={onAddField}
            title="Create a new custom field bound to this type"
          >
            <span className="flb-sidebar__AddField_Plus" aria-hidden="true">+</span>
            Add custom field
          </button>
        )}
      </SidebarSection>

      <div className="flb-sidebar__Removehint" aria-hidden={!isOver}>
        Drop here to remove from form
      </div>
    </aside>
  );
}

function SidebarSection({
  title,
  hint,
  badge,
  children,
}: {
  title: string;
  hint?: string;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flb-sidebar__Section">
      <div className="flb-sidebar__Section_Head">
        <h3 className="flb-sidebar__Section_Title">{title}</h3>
        {hint && <span className="flb-sidebar__Section_Hint">{hint}</span>}
        {badge !== undefined && <span className="flb-sidebar__Section_Count">{badge}</span>}
      </div>
      <div className="flb-sidebar__Section_List">{children}</div>
    </section>
  );
}

function SidebarField({
  field,
  placed,
}: {
  field: CoreFieldDescriptor;
  placed: boolean;
}) {
  // Once placed on the canvas a field is greyed and no longer draggable from
  // the sidebar (it lives on the form). Drag it back to remove. The card shares
  // the canvas placed-cell styling: left accent bar (following the radius),
  // grip, label, and right-aligned data-type tag.
  const draggableDisabled = placed;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar:${field.fieldKey}`,
    data: { kind: "sidebar", fieldKey: field.fieldKey } satisfies DragData,
    disabled: draggableDisabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={
        "flb-fieldcard" +
        (field.isCompulsory ? " flb-fieldcard-req" : "") +
        (placed ? " flb-fieldcard-onform" : "") +
        (isDragging ? " flb-fieldcard-dragging" : "")
      }
      {...(draggableDisabled ? {} : listeners)}
      {...(draggableDisabled ? {} : attributes)}
      title={placed ? "Already on the form" : field.label}
    >
      <span className="flb-fieldcard__Grip" aria-hidden="true">⠿</span>
      <span className="flb-fieldcard__Main">
        <span className="flb-fieldcard__Label">{field.label}</span>
        <span className="flb-fieldcard__Meta">{field.dataType}</span>
      </span>
      {placed && <span className="flb-fieldcard__OnForm">On form</span>}
    </div>
  );
}

// ─── Canvas ──────────────────────────────────────────────────────────────

function Canvas({
  state,
  fieldByKey,
  rowDragActive,
}: {
  state: ReturnType<typeof useFormBuilderState>;
  fieldByKey: Map<string, CoreFieldDescriptor>;
  rowDragActive: boolean;
}) {
  // One renderer call over ALL rows. Each contiguous same-template run renders
  // as ONE grid (so columns ALWAYS align — merged or not), with a per-row
  // numbered gutter + per-row drag/delete aside aligned to each row's track,
  // and ◇ join handles on mergeable seams.
  return (
    <div className={"flb-canvas" + (rowDragActive ? " flb-canvas-rowdrag" : "")}>
      <FormLayoutRenderer
        rows={state.rows}
        className="flb-canvas-grid"
        renderRowGap={(rowIndex) => (
          <RowGap rowIndex={rowIndex} onInsertRow={state.insertRowAt} rowDragActive={rowDragActive} />
        )}
        renderRowGutter={(rowIndex) => <RowGutter rowIndex={rowIndex} />}
        renderRowAside={(group) => (
          <RowAside
            group={group}
            onRemove={() =>
              group.merged
                ? state.unmergeGroup(group.startRow, group.count) // un-merge, keep rows
                : state.removeRow(group.startRow)
            }
          />
        )}
        renderSeamJoin={({ rowIndex, colIndex }) => (
          <button
            type="button"
            className="flb-seam__Join"
            title="Merge this column with the empty cell below"
            aria-label="Merge column down"
            onClick={() => state.mergeDown({ rowIndex, cellIndex: colIndex })}
          >
            <JoinArrowIcon className="flb-seam__Glyph" />
          </button>
        )}
        renderHSeamJoin={({ rowIndex, colIndex }) => (
          <button
            type="button"
            className="flb-seam__Join flb-seam__Join-h"
            title="Merge this cell with the empty cell to its right"
            aria-label="Merge cell right"
            onClick={() => state.mergeRight({ rowIndex, cellIndex: colIndex })}
          >
            {/* same glyph, rotated 90° — horizontal join */}
            <JoinArrowIcon className="flb-seam__Glyph flb-seam__Glyph-h" />
          </button>
        )}
        renderCell={(args) => (
          <CanvasCell
            {...args}
            fieldByKey={fieldByKey}
            onSplit={() => state.splitCell({ rowIndex: args.rowIndex, cellIndex: args.cellIndex })}
            onSplitH={() => state.splitCellH({ rowIndex: args.rowIndex, cellIndex: args.cellIndex })}
            onRemove={() => state.clearCell({ rowIndex: args.rowIndex, cellIndex: args.cellIndex })}
          />
        )}
      />
    </div>
  );
}

// RowGutter — the numbered marker (01, 02…) for ONE row, top-aligned to its
// track. The continuous vertical line is drawn by the gutter column's CSS.
function RowGutter({ rowIndex }: { rowIndex: number }) {
  return <span className="flb-gutter__Num">{String(rowIndex + 1).padStart(2, "0")}</span>;
}

// RowAside — ONE drag-reorder + delete cluster per MERGE GROUP, centred on the
// group's rows. A merged group drags as a unit (no fracturing); its delete
// un-merges (keeps the rows). A singleton (unmerged) row deletes normally.
function RowAside({ group, onRemove }: { group: MergeGroup; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `row:${group.startRow}`,
    data: { kind: "row", rowIndex: group.startRow, count: group.count } satisfies DragData,
  });
  return (
    <div
      ref={setNodeRef}
      className={"flb-row-aside" + (isDragging ? " flb-row-aside-dragging" : "")}
    >
      <button
        type="button"
        className="flb-row-handle"
        title={group.merged ? "Drag to move this merged group" : "Drag to reorder"}
        aria-label={group.merged ? "Drag to move merged group" : "Drag to reorder row"}
        {...listeners}
        {...attributes}
      >
        ⠿
      </button>
      <button
        type="button"
        className="flb-row-del"
        onClick={onRemove}
        title={group.merged ? "Un-merge this group (keeps the rows)" : "Delete row"}
        aria-label={group.merged ? "Un-merge group" : "Delete row"}
      >
        ×
      </button>
    </div>
  );
}

// RowGap is the droppable strip between rows. It serves two purposes:
//   1. drop target — a field inserts a new row here (push-down); a whole
//      row dropped here reorders to this position;
//   2. hover affordance — an "+ add row" button reveals a template menu
//      so a new empty row can be inserted between existing rows.
function RowGap({
  rowIndex,
  onInsertRow,
  rowDragActive,
}: {
  rowIndex: number;
  onInsertRow: (template: RowTemplate, rowIndex: number) => void;
  rowDragActive: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${rowIndex}` });
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      ref={setNodeRef}
      className={
        "flb-gap" +
        (isOver ? " flb-gap-over" : "") +
        (menuOpen ? " flb-gap-menuopen" : "") +
        (rowDragActive ? " flb-gap-rowtarget" : "")
      }
    >
      <span className="flb-gap__Line" />
      <div className="flb-gap__Insert">
        <button
          type="button"
          className="flb-gap__Insert_Btn"
          onClick={() => setMenuOpen((o) => !o)}
          title="Add a row here"
          aria-label="Add a row here"
          aria-expanded={menuOpen}
        >
          +
        </button>
        {menuOpen && (
          <div className="flb-gap__Insert_Menu" role="menu">
            {ROW_TEMPLATES.map((t) => (
              <button
                key={t.template}
                type="button"
                role="menuitem"
                className="flb-gap__Insert_Item"
                onClick={() => { onInsertRow(t.template, rowIndex); setMenuOpen(false); }}
                title={t.label}
              >
                <TemplateGlyph template={t.template} />
                <span className="flb-gap__Insert_Item_Text">{t.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


// ─── Preview (full-canvas WYSIWYG form) ──────────────────────────────────

// FormPreview renders the IN-PROGRESS layout (state.rows) as the real form
// an end user would see — same FormLayoutRenderer geometry, real field
// inputs instead of draggable chips. A data picker at the top lists real
// artefacts of this type (clamp-scoped); selecting one populates every PLACED
// cell with that artefact's real value (true WYSIWYG — only placed fields).
// With no selection it falls back to label placeholders. Read-only throughout
// (a layout+data preview, never a data-entry surface). Empty cells render
// nothing so the preview reads like a finished form, not a grid.
function FormPreview({
  rows,
  fieldByKey,
  artefactTypeId,
  typeLabel,
}: {
  rows: FormRow[];
  fieldByKey: Map<string, CoreFieldDescriptor>;
  artefactTypeId: string;
  typeLabel: string;
}) {
  // valueFor resolves a placed cell's real value once an artefact is picked;
  // null means "no artefact selected" → cells fall back to placeholders.
  const [valueFor, setValueFor] = useState<((fieldKey: string) => string) | null>(null);

  if (rows.length === 0) {
    return (
      <div className="flb-canvas-empty">
        <p>Nothing to preview yet — add rows and place fields first.</p>
      </div>
    );
  }
  return (
    <div className="flb-preview">
      <PreviewDataPicker
        artefactTypeId={artefactTypeId}
        typeLabel={typeLabel}
        fieldByKey={fieldByKey}
        onValuesChange={(fn) => setValueFor(() => fn)}
      />
      <FormLayoutRenderer
        rows={rows}
        className="flb-preview-grid"
        renderCell={({ cell }) => {
          if (!cell.fieldKey) return <div className="flb-preview__Empty" aria-hidden="true" />;
          const d = fieldByKey.get(cell.fieldKey);
          const value = valueFor ? valueFor(cell.fieldKey) : undefined;
          return (
            <PreviewField
              label={d?.label ?? cell.fieldKey}
              dataType={d?.dataType ?? "textbox"}
              value={value}
            />
          );
        }}
      />
    </div>
  );
}

// PreviewField renders a labelled, disabled input matching the field's data
// type. Disabled because the preview is a layout+data check, not a data-entry
// surface. `value` (when an artefact is selected) shows the real data; when
// undefined the control falls back to the label as placeholder, exactly as the
// pre-data-picker preview behaved.
function PreviewField({
  label,
  dataType,
  value,
}: {
  label: string;
  dataType: string;
  value?: string;
}) {
  const multiline = dataType === "richtext" || dataType === "textarea";
  const hasValue = value !== undefined && value !== "";
  return (
    <label className="flb-preview__Field">
      <span className="flb-preview__Field_Label">{label}</span>
      {multiline ? (
        <textarea
          className="flb-preview__Field_Input flb-preview__Field_Input-area"
          rows={3}
          disabled
          placeholder={label}
          value={value ?? ""}
          readOnly
        />
      ) : dataType === "boolean" ? (
        <span
          className={"flb-preview__Field_Toggle" + (value === "true" ? " flb-preview__Field_Toggle-on" : "")}
          aria-hidden="true"
        />
      ) : dataType === "select" ? (
        <select className="flb-preview__Field_Input" disabled value="__preview">
          <option value="__preview">{hasValue ? value : `${label}…`}</option>
        </select>
      ) : (
        <input
          className="flb-preview__Field_Input"
          type={hasValue ? "text" : dataType === "number" ? "number" : dataType === "date" ? "date" : "text"}
          disabled
          placeholder={label}
          value={value ?? ""}
          readOnly
        />
      )}
    </label>
  );
}

function CanvasCell({
  cell,
  cellIndex,
  rowIndex,
  fieldByKey,
  onSplit,
  onSplitH,
  onRemove,
}: RenderCellArgs & {
  fieldByKey: Map<string, CoreFieldDescriptor>;
  onSplit: () => void;
  onSplitH: () => void;
  onRemove: () => void;
}) {
  const addr: CellAddr = { rowIndex, cellIndex };
  const { setNodeRef, isOver } = useDroppable({ id: cellDroppableId(addr) });
  const isTall = (cell.rowSpan ?? 1) > 1;
  const isWide = (cell.colSpan ?? 1) > 1;
  const isFilled = !!cell.fieldKey;

  return (
    <div
      ref={setNodeRef}
      className={
        "flb-slot" +
        (isFilled ? " flb-slot-filled" : " flb-slot-empty") +
        (isTall ? " flb-slot-tall" : "") +
        (isWide ? " flb-slot-wide" : "") +
        (isOver ? " flb-slot-over" : "")
      }
    >
      {isFilled ? (
        <PlacedChip addr={addr} cell={cell} fieldByKey={fieldByKey} />
      ) : (
        <AnchorPoint />
      )}
      {/* All per-field actions grouped into ONE centred pill (Rick, 2026-06-01):
          uniform circular buttons, same size + colour, wrapped in a same-colour
          pill (a single button reads as one circle, two+ as a pill). Only the
          actions that apply to THIS cell render — split-row when tall, split-col
          when wide, put-back (remove) whenever a field is placed. On an EMPTY
          cell the pill carries a "Drop Here" label to the LEFT of any button
          (the drop hint lives in the same centred pill). The cluster is centred
          over the cell. */}
      <CellActions
        isEmpty={!isFilled}
        canSplitRow={isTall}
        canSplitCol={isWide}
        canRemove={isFilled}
        onSplit={onSplit}
        onSplitH={onSplitH}
        onRemove={onRemove}
      />
    </div>
  );
}

// CellActions — the centred pill of per-field controls. On an EMPTY cell it leads
// with a "Drop Here" label; then any applicable buttons (un-merge rows/cols when
// merged, put-back when filled). Each button is a uniform circle; the shared pill
// wrapper gives them one same-colour border + 3px pad. Renders nothing only if
// there is neither a label nor a button (i.e. a filled, unmerged cell shows just
// the put-back button; an empty unmerged cell shows just the "Drop Here" label).
function CellActions({
  isEmpty,
  canSplitRow,
  canSplitCol,
  canRemove,
  onSplit,
  onSplitH,
  onRemove,
}: {
  isEmpty: boolean;
  canSplitRow: boolean;
  canSplitCol: boolean;
  canRemove: boolean;
  onSplit: () => void;
  onSplitH: () => void;
  onRemove: () => void;
}) {
  if (!isEmpty && !canSplitRow && !canSplitCol && !canRemove) return null;
  // Stop drag from starting when interacting with the actions.
  const guard = (e: React.PointerEvent | React.MouseEvent) => e.stopPropagation();
  return (
    <div className="flb-cell__Actions" onPointerDown={guard}>
      {isEmpty && <span className="flb-cell__Actions_Label">Drop Here</span>}
      {canSplitRow && (
        <button
          type="button"
          className="flb-cell__Action"
          onClick={(e) => { e.stopPropagation(); onSplit(); }}
          title="Un-merge rows (split this merged cell back into separate rows)"
          aria-label="Un-merge rows"
        >
          <TbLayoutList aria-hidden="true" />
        </button>
      )}
      {canSplitCol && (
        <button
          type="button"
          className="flb-cell__Action"
          onClick={(e) => { e.stopPropagation(); onSplitH(); }}
          title="Un-merge columns (split this wide cell back into separate columns)"
          aria-label="Un-merge columns"
        >
          {/* same glyph, rotated 90° (.flb-cell__Action_Icon-rot) — column variant. */}
          <TbLayoutList aria-hidden="true" className="flb-cell__Action_Icon-rot" />
        </button>
      )}
      {canRemove && (
        <button
          type="button"
          className="flb-cell__Action flb-cell__Action-remove"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="Remove from form (return the field to the picker)"
          aria-label="Remove field from form"
        >
          <BsArrowReturnLeft aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// AnchorPoint — the dashed-border empty-slot affordance. The drop hint text now
// lives in the centred CellActions pill ("Drop Here"), so this is just the
// dashed frame that gives the empty target its shape.
function AnchorPoint() {
  return <div className="flb-anchor" aria-hidden="true" />;
}

function PlacedChip({
  addr,
  cell,
  fieldByKey,
}: {
  addr: CellAddr;
  cell: FormCell;
  fieldByKey: Map<string, CoreFieldDescriptor>;
}) {
  const key = cell.fieldKey!;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `cell:${addr.rowIndex}:${addr.cellIndex}`,
    data: { kind: "cell", addr, fieldKey: key } satisfies DragData,
  });
  const descriptor = fieldByKey.get(key);
  const isCompulsory = descriptor?.isCompulsory;
  // The remove ("put back") action now lives in the centred CellActions pill
  // alongside the un-merge buttons — no inline button on the chip.
  return (
    <div
      ref={setNodeRef}
      className={
        "flb-fieldcard flb-fieldcard-placed" +
        (isCompulsory ? " flb-fieldcard-req" : "") +
        (isDragging ? " flb-fieldcard-dragging" : "")
      }
    >
      {/* Only the grip carries the drag listeners. */}
      <span className="flb-fieldcard__Grip" aria-label="Drag to move" {...listeners} {...attributes}>⠿</span>
      <span className="flb-fieldcard__Main">
        <span className="flb-fieldcard__Label">{descriptor?.label ?? key}</span>
        <span className="flb-fieldcard__Meta">
          {descriptor?.dataType ?? ""}
          {isCompulsory ? " · Required" : ""}
        </span>
      </span>
    </div>
  );
}

// ─── Template picker (add-row) ───────────────────────────────────────────

// Two-line descriptive labels for each row template: a bold primary name + a
// smaller secondary ratio underneath (per the picker redesign).
const TEMPLATE_LABELS: Record<RowTemplate, { primary: string; secondary: string }> = {
  "100": { primary: "Single", secondary: "100" },
  "50-50": { primary: "Equal", secondary: "50 / 50" },
  "70-30": { primary: "Wide left", secondary: "70 / 30" },
  "30-70": { primary: "Wide right", secondary: "30 / 70" },
  "30-30-30": { primary: "Thirds", secondary: "33 / 33 / 33" },
  "50-25-25": { primary: "Wide left ×3", secondary: "50 / 25 / 25" },
  "25-50-25": { primary: "Wide centre ×3", secondary: "25 / 50 / 25" },
  "25-25-50": { primary: "Wide right ×3", secondary: "25 / 25 / 50" },
};

function TemplatePicker({ onAdd }: { onAdd: (t: RowTemplate) => void }) {
  return (
    <div className="flb-templates">
      <span className="flb-templates__Label">Add row</span>
      <div className="flb-templates__Btns">
        {ROW_TEMPLATES.map((t) => {
          const lbl = TEMPLATE_LABELS[t.template];
          return (
            <button
              key={t.template}
              type="button"
              className="flb-templates__Btn"
              onClick={() => onAdd(t.template)}
              title={t.label}
            >
              <TemplateGlyph template={t.template} />
              <span className="flb-templates__Btn_Text">
                <span className="flb-templates__Btn_Primary">{lbl.primary}</span>
                <span className="flb-templates__Btn_Secondary">{lbl.secondary}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// TemplateGlyph draws a tiny preview of the column split. Driven off
// TEMPLATE_SPANS so a new template's glyph is automatic (no per-template branch).
function TemplateGlyph({ template }: { template: RowTemplate }) {
  const spans = TEMPLATE_SPANS[template] ?? [100];
  return (
    <span className="flb-glyph" style={{ gridTemplateColumns: spans.map((s) => `${s}fr`).join(" ") }}>
      {spans.map((_, i) => <span key={i} className="flb-glyph__Cell" />)}
    </span>
  );
}
