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

import React, { useEffect, useMemo, useState } from "react";
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
  MANDATORY_CORE_KEYS,
  type CoreFieldDescriptor,
  type FormCell,
  type FormRow,
  type RowTemplate,
} from "@/app/lib/formLayoutsApi";
import { ROW_TEMPLATES } from "@/app/lib/formLayoutsApi";
import { FormLayoutRenderer, type RenderCellArgs } from "./FormLayoutRenderer";
import { useFormBuilderState, type CellAddr } from "./useFormBuilderState";

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
  | { kind: "cell"; addr: CellAddr; fieldKey: string };

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
  const state = useFormBuilderState([]);
  const [fields, setFields] = useState<CoreFieldDescriptor[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  // Mandatory core fields still missing from the canvas (live UX mirror).
  const missingMandatory = useMemo(
    () => MANDATORY_CORE_KEYS.filter((k) => !state.placedKeys.has(k)),
    [state.placedKeys],
  );

  const coreFields = fields.filter((f) => f.kind === "core");
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
      const key = drag.fieldKey;
      if (drag.kind === "cell") state.clearCell(drag.addr);
      state.insertFieldAsRow(key, target.rowIndex);
      return;
    }
    // target.type === "cell"
    if (drag.kind === "sidebar") {
      state.placeField(drag.fieldKey, target.addr);
    } else {
      state.moveField(drag.addr, target.addr);
    }
  }

  async function handleSave() {
    setSaveError(null);
    if (missingMandatory.length > 0) {
      setSaveError(
        "Place these required fields before saving: " +
          missingMandatory.map((k) => fieldByKey.get(k)?.label ?? k).join(", "),
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

        <div className="flb-overlay__Body">
          <Sidebar
            loading={loading}
            loadError={loadError}
            coreFields={coreFields}
            customFields={customFields}
            placedKeys={state.placedKeys}
            mandatoryKeys={new Set(MANDATORY_CORE_KEYS)}
          />

          <main className="flb-canvas-wrap">
            {loading ? (
              <div className="flb-canvas-empty">Loading…</div>
            ) : state.rows.length === 0 ? (
              <div className="flb-canvas-empty">
                <p>Add a row to begin, then drag fields from the left into the slots.</p>
              </div>
            ) : (
              <Canvas state={state} fieldByKey={fieldByKey} />
            )}

            <TemplatePicker onAdd={state.addRow} />
          </main>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeDrag ? (
            <div className="flb-chip flb-chip-dragging">
              {fieldByKey.get(activeDrag.fieldKey)?.label ?? activeDrag.fieldKey}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────

function Sidebar({
  loading,
  loadError,
  coreFields,
  customFields,
  placedKeys,
  mandatoryKeys,
}: {
  loading: boolean;
  loadError: string | null;
  coreFields: CoreFieldDescriptor[];
  customFields: CoreFieldDescriptor[];
  placedKeys: Set<string>;
  mandatoryKeys: Set<string>;
}) {
  // Sidebar is itself a droppable: dropping a placed cell here removes it.
  const { setNodeRef, isOver } = useDroppable({ id: "sidebar-dropzone" });
  return (
    <aside
      ref={setNodeRef}
      className={"flb-sidebar" + (isOver ? " flb-sidebar-removeover" : "")}
    >
      {loadError && <div className="flb-sidebar__Error">{loadError}</div>}

      <SidebarSection title="Core fields" hint="Required to save">
        {loading ? (
          <div className="flb-sidebar__Skel" />
        ) : (
          coreFields.map((f) => (
            <SidebarField
              key={f.fieldKey}
              field={f}
              placed={placedKeys.has(f.fieldKey)}
              mandatory={mandatoryKeys.has(f.fieldKey)}
            />
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
            <SidebarField key={f.fieldKey} field={f} placed={placedKeys.has(f.fieldKey)} mandatory={false} />
          ))
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
  mandatory,
}: {
  field: CoreFieldDescriptor;
  placed: boolean;
  mandatory: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `sidebar:${field.fieldKey}`,
    data: { kind: "sidebar", fieldKey: field.fieldKey } satisfies DragData,
    disabled: placed,
  });
  return (
    <div
      ref={setNodeRef}
      className={
        "flb-chip" +
        (placed ? " flb-chip-placed" : "") +
        (mandatory ? " flb-chip-mandatory" : "") +
        (isDragging ? " flb-chip-dragging" : "")
      }
      {...(placed ? {} : listeners)}
      {...(placed ? {} : attributes)}
      title={placed ? "Already on the form" : field.label}
    >
      <span className="flb-chip__Label">{field.label}</span>
      {mandatory && <span className="flb-chip__Req" title="Required to save">●</span>}
      {placed && <span className="flb-chip__Placed">on form</span>}
    </div>
  );
}

// ─── Canvas ──────────────────────────────────────────────────────────────

function Canvas({
  state,
  fieldByKey,
}: {
  state: ReturnType<typeof useFormBuilderState>;
  fieldByKey: Map<string, CoreFieldDescriptor>;
}) {
  return (
    <div className="flb-canvas">
      {/* gap before the first row */}
      <RowGap rowIndex={0} />
      {state.rows.map((row, rowIndex) => (
        <React.Fragment key={row.id}>
          <SingleRow
            row={row}
            rowIndex={rowIndex}
            fieldByKey={fieldByKey}
            onRemoveRow={() => state.removeRow(rowIndex)}
          />
          <RowGap rowIndex={rowIndex + 1} />
        </React.Fragment>
      ))}
    </div>
  );
}

// RowGap is the droppable strip between rows that triggers insert-push-down.
function RowGap({ rowIndex }: { rowIndex: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `gap:${rowIndex}` });
  return (
    <div ref={setNodeRef} className={"flb-gap" + (isOver ? " flb-gap-over" : "")}>
      <span className="flb-gap__Line" />
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
  return (
    <FormLayoutRenderer
      rows={[row]}
      className="flb-canvas-row"
      renderRowAside={() => (
        <button type="button" className="flb-row-del" onClick={onRemoveRow} title="Delete row" aria-label="Delete row">
          ×
        </button>
      )}
      renderCell={(args) => (
        <CanvasCell
          {...args}
          rowIndex={rowIndex}
          fieldByKey={fieldByKey}
        />
      )}
    />
  );
}

function CanvasCell({
  cell,
  cellIndex,
  rowIndex,
  fieldByKey,
}: RenderCellArgs & { rowIndex: number; fieldByKey: Map<string, CoreFieldDescriptor> }) {
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
