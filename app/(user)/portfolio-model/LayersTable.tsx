"use client";

/**
 * LayersTable — inline-editable layers table with drag-to-reorder.
 *
 * Stories 00063, 00064, 00065.
 *
 * 00063 — Inline edit: Name, Tag, Description
 *   - Click Name/Tag cell → <input>; click Description cell → <textarea>
 *   - ESC or focusout-without-change cancels (no dirty flag)
 *   - Enter (for inputs) or blur-commit confirms → row marked dirty
 *   - Tag: 2–4 chars enforced; duplicate name/tag within table → inline warning
 *
 * 00064 — Drag-to-reorder rows
 *   - Drag handle column (leftmost) using HTML5 drag-and-drop API
 *   - Drop reorders array, reassigns sort_order 1…N
 *   - Affected rows marked dirty; Confirm bar appears
 *
 * 00065 — Confirm Changes bar
 *   - Appears when any row is dirty
 *   - Confirm: client-side validation → PATCH /api/subscription/layers/batch
 *   - Cancel: revert all local state to original server values
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { api, ApiError } from "@/app/lib/api";
import InlineEditField from "@/app/components/InlineEditField";

export interface LayerDTO {
  id: string;
  name: string;
  tag: string;
  sort_order: number;
  description_md: string | null;
}

type EditField = "name" | "tag" | "description_md";

interface Props {
  initialLayers: LayerDTO[];
  onLayersUpdated: (layers: LayerDTO[]) => void;
  fixedItems?: LayerDTO[];
  topAnchorTag?: string;
  strategyGroupLabel?: string;
  fixedGroupLabel?: string;
}

function sorted(layers: LayerDTO[]): LayerDTO[] {
  return [...layers].sort((a, b) => a.sort_order - b.sort_order);
}

// Ensures the anchor tag layer always has the highest sort_order so it stays
// locked at the top of the display (which reverses the array).
function normalizeTopAnchor(layers: LayerDTO[], anchorTag?: string): LayerDTO[] {
  if (!anchorTag) return layers;
  const anchor = layers.find((l) => l.tag === anchorTag);
  if (!anchor) return layers;
  const others = layers.filter((l) => l.tag !== anchorTag);
  const maxSo = others.length > 0 ? Math.max(...others.map((l) => l.sort_order)) : 0;
  return sorted(layers.map((l) => (l.tag === anchorTag ? { ...l, sort_order: maxSo + 1 } : l)));
}

export default function LayersTable({ initialLayers, onLayersUpdated, fixedItems, topAnchorTag, strategyGroupLabel, fixedGroupLabel }: Props) {
  const [localLayers, setLocalLayers] = useState<LayerDTO[]>(() =>
    normalizeTopAnchor(sorted(initialLayers), topAnchorTag)
  );
  const [originalLayers, setOriginalLayers] = useState<LayerDTO[]>(() =>
    normalizeTopAnchor(sorted(initialLayers), topAnchorTag)
  );
  const [localFixed, setLocalFixed] = useState<LayerDTO[]>(() => fixedItems ?? []);
  // keyed "${id}.${field}"
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Drag state — held in refs to avoid re-renders during drag
  const dragIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  // Visual drop-target row index (for --drag-over class)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  // Zone collapse state
  const [strategyOpen, setStrategyOpen] = useState(true);
  const [executionOpen, setExecutionOpen] = useState(true);

  const isDirty =
    localLayers.length === originalLayers.length &&
    localLayers.some((l, i) => {
      const o = originalLayers[i];
      return (
        l.name !== o.name ||
        l.tag !== o.tag ||
        l.sort_order !== o.sort_order ||
        l.description_md !== o.description_md
      );
    });

  // Reset local state when the parent swaps initialLayers (post-save response)
  useEffect(() => {
    const s = normalizeTopAnchor(sorted(initialLayers), topAnchorTag);
    setLocalLayers(s);
    setOriginalLayers(s);
    setErrors(new Map());
    setFormError(null);
  }, [initialLayers, topAnchorTag]);

  useEffect(() => {
    setLocalFixed(fixedItems ?? []);
  }, [fixedItems]);

  // ── Inline editing ────────────────────────────────────────────────────────

  // Validate and commit a single field. Returns true on success (caller can
  // exit edit mode); false on validation failure (caller stays in edit mode
  // and the per-cell error renders).
  const commitField = useCallback(
    (id: string, field: EditField, value: string): boolean => {
      const trimmed = value.trim();
      const setError = (msg: string) => {
        setErrors((prev) => {
          const next = new Map(prev);
          next.set(`${id}.${field}`, msg);
          return next;
        });
      };
      const clearError = () => {
        setErrors((prev) => {
          if (!prev.has(`${id}.${field}`)) return prev;
          const next = new Map(prev);
          next.delete(`${id}.${field}`);
          return next;
        });
      };

      if (field === "tag") {
        if (trimmed.length < 2 || trimmed.length > 4) {
          setError("Tag must be 2–4 characters");
          return false;
        }
        const duplicate = [...localLayers, ...localFixed].find(
          (l) => l.id !== id && l.tag.toLowerCase() === trimmed.toLowerCase()
        );
        if (duplicate) {
          setError("Duplicate tag");
          return false;
        }
      }

      if (field === "name") {
        if (trimmed.length === 0) {
          setError("Name is required");
          return false;
        }
        const duplicate = [...localLayers, ...localFixed].find(
          (l) => l.id !== id && l.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (duplicate) {
          setError("Duplicate name");
          return false;
        }
      }

      const isFixed = localFixed.some((l) => l.id === id);
      (isFixed ? setLocalFixed : setLocalLayers)((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          return {
            ...l,
            [field]: field === "description_md" ? trimmed || null : trimmed,
          };
        })
      );
      clearError();
      return true;
    },
    [localLayers, localFixed]
  );

  // ── Drag to reorder ───────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLSpanElement>, index: number) => {
      e.stopPropagation();
      dragIndexRef.current = index;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", String(index));
    },
    []
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLTableRowElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (dragOverIndexRef.current !== index) {
        dragOverIndexRef.current = index;
        setDropTargetIndex(index);
      }
    },
    []
  );

  const handleDragLeave = useCallback(() => {
    dragOverIndexRef.current = null;
    setDropTargetIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLTableRowElement>, dropIndex: number) => {
      e.preventDefault();
      setDropTargetIndex(null);
      const dragIndex = dragIndexRef.current;
      if (dragIndex === null || dragIndex === dropIndex) {
        dragIndexRef.current = null;
        dragOverIndexRef.current = null;
        return;
      }
      setLocalLayers((prev) => {
        // Work in display order (descending sort_order = visual top first).
        const display = [...prev].reverse();
        const [moved] = display.splice(dragIndex, 1);
        display.splice(dropIndex, 0, moved);
        // Visual top = highest strategic = highest sort_order.
        const total = display.length;
        return display
          .map((l, i) => ({ ...l, sort_order: total - i }))
          .sort((a, b) => a.sort_order - b.sort_order);
      });
      dragIndexRef.current = null;
      dragOverIndexRef.current = null;
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    dragOverIndexRef.current = null;
    setDropTargetIndex(null);
  }, []);

  // ── Confirm Changes bar ───────────────────────────────────────────────────

  const runClientValidation = useCallback((): boolean => {
    const nextErrors = new Map<string, string>();

    const names = new Map<string, string>(); // lowercase → id
    const tags = new Map<string, string>();

    for (const l of localLayers) {
      if (!l.name.trim()) {
        nextErrors.set(`${l.id}.name`, "Name is required");
      }
      if (l.tag.trim().length < 2 || l.tag.trim().length > 4) {
        nextErrors.set(`${l.id}.tag`, "Tag must be 2–4 characters");
      }

      const nameLow = l.name.trim().toLowerCase();
      const tagLow = l.tag.trim().toLowerCase();

      if (names.has(nameLow)) {
        nextErrors.set(`${l.id}.name`, "Duplicate name");
        const otherId = names.get(nameLow)!;
        nextErrors.set(`${otherId}.name`, "Duplicate name");
      } else {
        names.set(nameLow, l.id);
      }

      if (tags.has(tagLow)) {
        nextErrors.set(`${l.id}.tag`, "Duplicate tag");
        const otherId = tags.get(tagLow)!;
        nextErrors.set(`${otherId}.tag`, "Duplicate tag");
      } else {
        tags.set(tagLow, l.id);
      }
    }

    setErrors(nextErrors);
    return nextErrors.size === 0;
  }, [localLayers]);

  const handleConfirm = useCallback(async () => {
    if (!runClientValidation()) return;

    setSaving(true);
    setFormError(null);
    try {
      const updated = await api<LayerDTO[]>("/api/subscription/layers/batch", {
        method: "PATCH",
        body: JSON.stringify(
          localLayers.map((l) => ({
            id: l.id,
            name: l.name,
            tag: l.tag,
            sort_order: l.sort_order,
            description_md: l.description_md,
          }))
        ),
      });
      // Update original to match saved state; parent gets the new array
      const s = sorted(updated);
      setOriginalLayers(s);
      setLocalLayers(s);
      setErrors(new Map());
      onLayersUpdated(s);
    } catch (e) {
      if (e instanceof ApiError && e.status === 422) {
        // Try to surface field-level errors from the response body
        const body = e.body as
          | { errors?: Array<{ id: string; field: string; message: string }> }
          | string
          | null;
        if (typeof body === "object" && body !== null && Array.isArray(body.errors)) {
          const nextErrors = new Map<string, string>();
          for (const fe of body.errors) {
            nextErrors.set(`${fe.id}.${fe.field}`, fe.message);
          }
          setErrors(nextErrors);
        } else {
          setFormError(
            typeof body === "string"
              ? body
              : "Validation failed. Check the highlighted fields."
          );
        }
      } else {
        setFormError(
          e instanceof ApiError
            ? `Error ${e.status}: ${
                typeof e.body === "string" ? e.body : "Request failed"
              }`
            : "Failed to save changes. Please try again."
        );
      }
    } finally {
      setSaving(false);
    }
  }, [runClientValidation, localLayers, onLayersUpdated]);

  const handleCancel = useCallback(() => {
    setLocalLayers(sorted(originalLayers));
    setErrors(new Map());
    setFormError(null);
  }, [originalLayers]);

  // ── Render helpers ────────────────────────────────────────────────────────

  function cellError(id: string, field: string): string | undefined {
    return errors.get(`${id}.${field}`);
  }

  function renderNameCell(layer: LayerDTO) {
    const err = cellError(layer.id, "name");
    return (
      <td
        className={`table__cell layers-editor__cell layers-editor__cell--editable${err ? " layers-editor__cell--invalid" : ""}`}
      >
        <InlineEditField
          value={layer.name}
          onCommit={(next) => commitField(layer.id, "name", next)}
          ariaLabel="Layer name"
          inputClassName="layers-editor__input"
          displayClassName="layers-editor__cell-text layers-editor__cell--clickable"
          errorClassName="layers-editor__input--error"
          hasError={Boolean(err)}
          clickToEdit
          allowEmpty
        />
        {err && <span className="layers-editor__cell-error">{err}</span>}
      </td>
    );
  }

  function renderTagCell(layer: LayerDTO) {
    const err = cellError(layer.id, "tag");
    return (
      <td
        className={`table__cell layers-editor__cell layers-editor__cell--editable layers-editor__cell--tag${err ? " layers-editor__cell--invalid" : ""}`}
      >
        <InlineEditField
          value={layer.tag}
          onCommit={(next) => commitField(layer.id, "tag", next)}
          ariaLabel="Layer tag"
          inputClassName="layers-editor__input layers-editor__input--tag"
          displayClassName="layers-editor__cell-text layers-editor__cell-text--tag layers-editor__cell--clickable"
          errorClassName="layers-editor__input--error"
          hasError={Boolean(err)}
          clickToEdit
          allowEmpty
          maxLength={4}
        />
        {err && <span className="layers-editor__cell-error">{err}</span>}
      </td>
    );
  }

  function renderDescCell(layer: LayerDTO) {
    const err = cellError(layer.id, "description_md");
    return (
      <td
        className={`table__cell table__cell--muted layers-editor__cell layers-editor__cell--editable${err ? " layers-editor__cell--invalid" : ""}`}
      >
        <InlineEditField
          value={layer.description_md ?? ""}
          onCommit={(next) => commitField(layer.id, "description_md", next)}
          ariaLabel="Layer description"
          inputClassName="layers-editor__textarea"
          displayClassName="layers-editor__cell--clickable"
          errorClassName="layers-editor__input--error"
          hasError={Boolean(err)}
          clickToEdit
          allowEmpty
          multiline
          rows={3}
          maxLength={2000}
          emptyDisplay="—"
        />
        {err && <span className="layers-editor__cell-error">{err}</span>}
      </td>
    );
  }

  // Hierarchy offset: fixed items occupy levels 1…N; sortable layers start above them.
  const fixedOffset = fixedItems
    ? Math.max(0, ...fixedItems.map((f) => f.sort_order))
    : 0;

  // Display sortable layers highest-strategic first (descending sort_order).
  const displayLayers = [...localLayers].reverse();

  // Display fixed items highest-hierarchy first (User Story → Task → Defect).
  const displayFixed = [...localFixed].sort((a, b) => b.sort_order - a.sort_order);

  return (
    <div className="layers-editor">
      <div className="table-wrap">
        <table className="table layers-editor__table">
          <colgroup>
            <col className="layers-editor__col--drag" />
            <col className="layers-editor__col--order" />
            <col className="layers-editor__col--tag" />
            <col className="layers-editor__col--name" />
            <col className="layers-editor__col--desc" />
          </colgroup>
          <tbody>
            <tr className="layers-editor__row--group-sep">
              <td colSpan={5} className="layers-editor__group-sep-cell">
                <button
                  type="button"
                  className="layers-editor__zone-toggle"
                  onClick={() => setStrategyOpen((v) => !v)}
                  aria-expanded={strategyOpen}
                >
                  <span className={`accordion__chevron${strategyOpen ? "" : " accordion__chevron--closed"}`} />
                  <span className="eyebrow">{strategyGroupLabel ?? "Strategy Zone"}</span>
                </button>
              </td>
            </tr>
            {strategyOpen && <tr className="table__head">
              <th className="table__cell layers-editor__drag-header" aria-label="Drag to reorder" />
              <th className="table__cell">Order</th>
              <th className="table__cell">Tag</th>
              <th className="table__cell">Name</th>
              <th className="table__cell">Description</th>
            </tr>}
            {strategyOpen && displayLayers.map((layer, index) => {
              const isDragOver = dropTargetIndex === index;
              const isAnchor = !!topAnchorTag && layer.tag === topAnchorTag;
              const rowCls = [
                "table__row",
                "layers-editor__row",
                isDragOver ? "layers-editor__row--drag-over" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <tr
                  key={layer.id}
                  className={rowCls}
                  onDragOver={isAnchor ? undefined : (e) => handleDragOver(e, index)}
                  onDragLeave={isAnchor ? undefined : handleDragLeave}
                  onDrop={isAnchor ? undefined : (e) => handleDrop(e, index)}
                  onDragEnd={isAnchor ? undefined : handleDragEnd}
                >
                  <td className={`table__cell layers-editor__drag-cell${isAnchor ? " layers-editor__drag-cell--disabled" : ""}`} aria-hidden="true">
                    {!isAnchor && (
                      <span
                        className="layers-editor__drag-handle"
                        title="Drag to reorder"
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                      >
                        ⠿
                      </span>
                    )}
                  </td>
                  <td className="table__cell table__cell--numeric">
                    {displayLayers.length - index + fixedOffset}
                  </td>
                  {renderTagCell(layer)}
                  {renderNameCell(layer)}
                  {renderDescCell(layer)}
                </tr>
              );
            })}
            {displayFixed.length > 0 && (
              <>
                <tr className="layers-editor__row--group-sep">
                  <td colSpan={5} className="layers-editor__group-sep-cell">
                    <button
                      type="button"
                      className="layers-editor__zone-toggle"
                      onClick={() => setExecutionOpen((v) => !v)}
                      aria-expanded={executionOpen}
                    >
                      <span className={`accordion__chevron${executionOpen ? "" : " accordion__chevron--closed"}`} />
                      <span className="eyebrow">{fixedGroupLabel ?? "Execution Zone"}</span>
                    </button>
                  </td>
                </tr>
                {executionOpen && <tr className="table__head">
                  <th className="table__cell layers-editor__drag-header" aria-label="Drag to reorder" />
                  <th className="table__cell">Order</th>
                  <th className="table__cell">Tag</th>
                  <th className="table__cell">Name</th>
                  <th className="table__cell">Description</th>
                </tr>}
                {executionOpen && displayFixed.map((item) => (
                  <tr key={item.id} className="table__row layers-editor__row">
                    <td className="table__cell layers-editor__drag-cell layers-editor__drag-cell--disabled" aria-hidden="true" />
                    <td className="table__cell table__cell--numeric table__cell--muted">
                      {item.sort_order === 0 ? "—" : item.sort_order}
                    </td>
                    {renderTagCell(item)}
                    {renderNameCell(item)}
                    {renderDescCell(item)}
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {isDirty && (
        <div className="layers-editor__confirm-bar" role="region" aria-label="Unsaved changes">
          <div className="layers-editor__confirm-bar-inner">
            <span className="layers-editor__confirm-bar-label">
              Unsaved changes
            </span>
            {formError && (
              <span className="layers-editor__confirm-bar-error" role="alert">
                {formError}
              </span>
            )}
            <div className="layers-editor__confirm-bar-actions">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={handleCancel}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleConfirm}
                disabled={saving}
              >
                {saving ? "Saving…" : "Confirm Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
