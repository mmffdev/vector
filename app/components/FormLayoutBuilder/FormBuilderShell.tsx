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
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  getCoreFields,
  getCurrentLayout,
  saveLayout,
  extractValidation,
  type CoreFieldDescriptor,
  type FormCell,
  type FormRow,
  type RowTemplate,
} from "@/app/lib/formLayoutsApi";
import { ROW_TEMPLATES } from "@/app/lib/formLayoutsApi";
import { useSentinel } from "@/app/sentinel";
import CustomFieldEditForm from "@/app/components/CustomFields/CustomFieldEditForm";
import { FormLayoutRenderer, type RenderCellArgs } from "./FormLayoutRenderer";
import {
  useFormBuilderState,
  type CellAddr,
} from "./useFormBuilderState";

export interface FormBuilderShellProps {
  nodeId: string;
  nodeName?: string;
  artefactTypeId: string;
  artefactTypeLabel?: string;
  onClose: () => void;
  onSaved?: () => void;
}

// Drag payload kinds. A sidebar drag carries a fieldKey; a canvas drag
// carries the source cell address.
type DragData =
  | { kind: "sidebar"; fieldKey: string }
  | { kind: "cell"; addr: CellAddr; fieldKey: string }
  | { kind: "row"; rowIndex: number };

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

export function FormBuilderShell({
  nodeId,
  nodeName,
  artefactTypeId,
  artefactTypeLabel,
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
  // Add-custom-field overlay: when true, the create form mounts above the
  // canvas with the current artefact type force-bound (lockedTypeId).
  const [addFieldOpen, setAddFieldOpen] = useState(false);

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
        const [cat, existing] = await Promise.all([
          getCoreFields(artefactTypeId),
          getCurrentLayout(nodeId, artefactTypeId),
        ]);
        if (cancelled) return;
        setFields(cat);
        // Canvas starts from whatever layout exists (empty for a fresh
        // form). Compulsory fields are NOT pre-placed — the author drags
        // them in and positions them freely; the save gate enforces presence.
        state.reset(existing?.doc.rows ?? []);
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

  // Sidebar partitions core fields into Mandatory (compulsory set) and
  // Optional (the rest), then Custom fields bound to the type — three
  // labelled groups, in that order.
  const mandatoryFields = fields.filter((f) => f.kind === "core" && f.isCompulsory);
  const optionalFields = fields.filter((f) => f.kind === "core" && !f.isCompulsory);
  const customFields = fields.filter((f) => f.kind === "custom");

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
      // A whole row dragged onto a gap reorders it; a field reorders into
      // a new full-width row at that position.
      if (drag.kind === "row") {
        state.moveRow(drag.rowIndex, target.rowIndex);
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
      await saveLayout({ nodeId, artefactTypeId, rows: state.rows });
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

  return (
    <div className="flb-overlay" role="dialog" aria-modal="true" aria-label="Form layout builder">
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <header className="flb-overlay__Bar">
          <div className="flb-overlay__Bar_Title">
            <span className="flb-overlay__Bar_Title_Main">Form Layout Builder</span>
            <span className="flb-overlay__Bar_Title_Sub">
              {(artefactTypeLabel ?? "User Story")} · {nodeName ?? "this node"}
            </span>
          </div>
          <div className="flb-overlay__Bar_Actions">
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
            <button type="button" className="flb-btn flb-btn-ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              type="button"
              className="flb-btn flb-btn-primary"
              onClick={handleSave}
              disabled={saving || loading}
            >
              {saving ? "Saving…" : "Save layout"}
            </button>
          </div>
        </header>

        {saveError && <div className="flb-overlay__Banner flb-overlay__Banner-error">{saveError}</div>}

        {previewing ? (
          <main className="flb-canvas-wrap flb-canvas-wrap-preview">
            <FormPreview rows={state.rows} fieldByKey={fieldByKey} />
          </main>
        ) : (
          <div className="flb-overlay__Body">
            <Sidebar
              loading={loading}
              loadError={loadError}
              mandatoryFields={mandatoryFields}
              optionalFields={optionalFields}
              customFields={customFields}
              placedKeys={state.placedKeys}
              canAddField={!!workspaceId}
              onAddField={() => setAddFieldOpen(true)}
            />

            <main className="flb-canvas-wrap">
              {loading ? (
                <div className="flb-canvas-empty">Loading…</div>
              ) : state.rows.length === 0 ? (
                <div className="flb-canvas-empty">
                  <p>Add a row to begin, then drag fields from the left into the slots.</p>
                </div>
              ) : (
                <Canvas state={state} fieldByKey={fieldByKey} rowDragActive={activeDrag?.kind === "row"} />
              )}

              <TemplatePicker onAdd={state.addRow} />
            </main>
          </div>
        )}

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            activeDrag.kind === "row" ? (
              <div className="flb-chip flb-chip-dragging">Row {activeDrag.rowIndex + 1}</div>
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
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────

function Sidebar({
  loading,
  loadError,
  mandatoryFields,
  optionalFields,
  customFields,
  placedKeys,
  canAddField,
  onAddField,
}: {
  loading: boolean;
  loadError: string | null;
  mandatoryFields: CoreFieldDescriptor[];
  optionalFields: CoreFieldDescriptor[];
  customFields: CoreFieldDescriptor[];
  placedKeys: Set<string>;
  canAddField: boolean;
  onAddField: () => void;
}) {
  // Sidebar is itself a droppable: dropping a placed cell here removes it.
  const { setNodeRef, isOver } = useDroppable({ id: "sidebar-dropzone" });
  return (
    <aside
      ref={setNodeRef}
      className={"flb-sidebar" + (isOver ? " flb-sidebar-removeover" : "")}
    >
      {loadError && <div className="flb-sidebar__Error">{loadError}</div>}

      <SidebarSection title="Mandatory fields" hint="Must be placed to save">
        {loading ? (
          <div className="flb-sidebar__Skel" />
        ) : mandatoryFields.length === 0 ? (
          <p className="flb-sidebar__Empty">No mandatory fields for this type.</p>
        ) : (
          mandatoryFields.map((f) => (
            <SidebarField key={f.fieldKey} field={f} placed={placedKeys.has(f.fieldKey)} />
          ))
        )}
      </SidebarSection>

      <SidebarSection title="Optional fields" hint="Place as needed">
        {loading ? (
          <div className="flb-sidebar__Skel" />
        ) : optionalFields.length === 0 ? (
          <p className="flb-sidebar__Empty">No optional core fields.</p>
        ) : (
          optionalFields.map((f) => (
            <SidebarField key={f.fieldKey} field={f} placed={placedKeys.has(f.fieldKey)} />
          ))
        )}
      </SidebarSection>

      <SidebarSection title="Custom fields" hint="Bound to this type">
        {loading ? (
          <div className="flb-sidebar__Skel" />
        ) : customFields.length === 0 ? (
          <p className="flb-sidebar__Empty">No custom fields bound yet.</p>
        ) : (
          customFields.map((f) => (
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

function SidebarSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flb-sidebar__Section">
      <div className="flb-sidebar__Section_Head">
        <h3 className="flb-sidebar__Section_Title">{title}</h3>
        {hint && <span className="flb-sidebar__Section_Hint">{hint}</span>}
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
  // the sidebar (it lives on the form). Drag it back to remove. Mandatory-ness
  // is conveyed by the field's group ("Mandatory fields"), not a per-chip dot.
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
        "flb-chip" +
        (placed ? " flb-chip-placed" : "") +
        (isDragging ? " flb-chip-dragging" : "")
      }
      {...(draggableDisabled ? {} : listeners)}
      {...(draggableDisabled ? {} : attributes)}
      title={placed ? "Already on the form" : field.label}
    >
      <span className="flb-chip__Label">{field.label}</span>
      {placed && <span className="flb-chip__Placed">on form</span>}
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
  return (
    <div className={"flb-canvas" + (rowDragActive ? " flb-canvas-rowdrag" : "")}>
      <RowGap rowIndex={0} onInsertRow={state.insertRowAt} rowDragActive={rowDragActive} />
      {state.rows.map((row, rowIndex) => (
        <React.Fragment key={row.id}>
          <SingleRow
            row={row}
            rowIndex={rowIndex}
            fieldByKey={fieldByKey}
            onRemoveRow={() => state.removeRow(rowIndex)}
          />
          <RowGap rowIndex={rowIndex + 1} onInsertRow={state.insertRowAt} rowDragActive={rowDragActive} />
        </React.Fragment>
      ))}
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

function SingleRow({
  row,
  rowIndex,
  fieldByKey,
  onRemoveRow,
}: {
  row: FormRow;
  rowIndex: number;
  fieldByKey: Map<string, CoreFieldDescriptor>;
  onRemoveRow: () => void;
}) {
  // The whole row is a draggable reorder unit, grabbed via its handle.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `row:${rowIndex}`,
    data: { kind: "row", rowIndex } satisfies DragData,
  });
  return (
    <div
      ref={setNodeRef}
      className={"flb-canvas-rowwrap" + (isDragging ? " flb-canvas-rowwrap-dragging" : "")}
    >
      <FormLayoutRenderer
        rows={[row]}
        className="flb-canvas-row"
        renderRowAside={() => (
          <div className="flb-row-aside">
            <button
              type="button"
              className="flb-row-handle"
              title="Drag to reorder row"
              aria-label="Drag to reorder row"
              {...listeners}
              {...attributes}
            >
              ⠿
            </button>
            <button type="button" className="flb-row-del" onClick={onRemoveRow} title="Delete row" aria-label="Delete row">
              ×
            </button>
          </div>
        )}
        renderCell={(args) => (
          <CanvasCell {...args} rowIndex={rowIndex} fieldByKey={fieldByKey} />
        )}
      />
    </div>
  );
}

// ─── Preview (full-canvas WYSIWYG form) ──────────────────────────────────

// FormPreview renders the IN-PROGRESS layout (state.rows) as the real form
// an end user would see — same FormLayoutRenderer geometry, real field
// inputs instead of draggable chips. It is non-binding (no save, no fetch):
// a faithful look at the form the author is building, full-canvas. Empty
// cells render nothing so the preview reads like a finished form, not a grid.
function FormPreview({
  rows,
  fieldByKey,
}: {
  rows: FormRow[];
  fieldByKey: Map<string, CoreFieldDescriptor>;
}) {
  if (rows.length === 0) {
    return (
      <div className="flb-canvas-empty">
        <p>Nothing to preview yet — add rows and place fields first.</p>
      </div>
    );
  }
  return (
    <div className="flb-preview">
      <FormLayoutRenderer
        rows={rows}
        className="flb-preview-grid"
        renderCell={({ cell }) => {
          if (!cell.fieldKey) return <div className="flb-preview__Empty" aria-hidden="true" />;
          const d = fieldByKey.get(cell.fieldKey);
          return <PreviewField label={d?.label ?? cell.fieldKey} dataType={d?.dataType ?? "textbox"} />;
        }}
      />
    </div>
  );
}

// PreviewField renders a labelled, disabled input matching the field's data
// type — a sample of the live form control. Disabled because the preview is
// a layout check, not a data-entry surface.
function PreviewField({ label, dataType }: { label: string; dataType: string }) {
  const multiline = dataType === "richtext" || dataType === "textarea";
  return (
    <label className="flb-preview__Field">
      <span className="flb-preview__Field_Label">{label}</span>
      {multiline ? (
        <textarea className="flb-preview__Field_Input flb-preview__Field_Input-area" rows={3} disabled placeholder={label} />
      ) : dataType === "boolean" ? (
        <span className="flb-preview__Field_Toggle" aria-hidden="true" />
      ) : dataType === "select" ? (
        <select className="flb-preview__Field_Input" disabled>
          <option>{label}…</option>
        </select>
      ) : (
        <input
          className="flb-preview__Field_Input"
          type={dataType === "number" ? "number" : dataType === "date" ? "date" : "text"}
          disabled
          placeholder={label}
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
}: RenderCellArgs & {
  rowIndex: number;
  fieldByKey: Map<string, CoreFieldDescriptor>;
}) {
  const addr: CellAddr = { rowIndex, cellIndex };
  const { setNodeRef, isOver } = useDroppable({ id: cellDroppableId(addr) });

  return (
    <div
      ref={setNodeRef}
      className={
        "flb-slot" +
        (cell.fieldKey ? " flb-slot-filled" : " flb-slot-empty") +
        (isOver ? " flb-slot-over" : "")
      }
    >
      {cell.fieldKey ? (
        <PlacedChip addr={addr} cell={cell} fieldByKey={fieldByKey} />
      ) : (
        <AnchorPoint />
      )}
    </div>
  );
}

// AnchorPoint — the dashed-border + filled-circle-with-+ affordance the
// user asked for on every empty/available slot.
function AnchorPoint() {
  return (
    <div className="flb-anchor" aria-hidden="true">
      <span className="flb-anchor__Dot">
        <span className="flb-anchor__Plus">+</span>
      </span>
    </div>
  );
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
  return (
    <div
      ref={setNodeRef}
      className={"flb-placed" + (isDragging ? " flb-placed-dragging" : "")}
      {...listeners}
      {...attributes}
    >
      <span className="flb-placed__Label">{descriptor?.label ?? key}</span>
      <span className="flb-placed__Type">{descriptor?.dataType ?? ""}</span>
    </div>
  );
}

// ─── Template picker (add-row) ───────────────────────────────────────────

function TemplatePicker({ onAdd }: { onAdd: (t: RowTemplate) => void }) {
  return (
    <div className="flb-templates">
      <span className="flb-templates__Label">Add row:</span>
      {ROW_TEMPLATES.map((t) => (
        <button
          key={t.template}
          type="button"
          className="flb-templates__Btn"
          onClick={() => onAdd(t.template)}
          title={t.label}
        >
          <TemplateGlyph template={t.template} />
          <span className="flb-templates__Btn_Text">{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// TemplateGlyph draws a tiny preview of the column split.
function TemplateGlyph({ template }: { template: RowTemplate }) {
  const spans =
    template === "100" ? [100] :
    template === "50-50" ? [50, 50] :
    template === "30-70" ? [30, 70] :
    template === "70-30" ? [70, 30] :
    [33, 33, 33];
  return (
    <span className="flb-glyph" style={{ gridTemplateColumns: spans.map((s) => `${s}fr`).join(" ") }}>
      {spans.map((_, i) => <span key={i} className="flb-glyph__Cell" />)}
    </span>
  );
}
