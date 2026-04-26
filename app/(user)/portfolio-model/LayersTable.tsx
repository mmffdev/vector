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
  type KeyboardEvent,
} from "react";
import { api, ApiError } from "@/app/lib/api";

export interface LayerDTO {
  id: string;
  name: string;
  tag: string;
  sort_order: number;
  description_md: string | null;
}

interface EditingCell {
  id: string;
  field: "name" | "tag" | "description_md";
}

interface Props {
  initialLayers: LayerDTO[];
  onLayersUpdated: (layers: LayerDTO[]) => void;
}

function sorted(layers: LayerDTO[]): LayerDTO[] {
  return [...layers].sort((a, b) => a.sort_order - b.sort_order);
}

export default function LayersTable({ initialLayers, onLayersUpdated }: Props) {
  const [localLayers, setLocalLayers] = useState<LayerDTO[]>(() =>
    sorted(initialLayers)
  );
  const [originalLayers, setOriginalLayers] = useState<LayerDTO[]>(() =>
    sorted(initialLayers)
  );
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editingValue, setEditingValue] = useState("");
  // keyed "${id}.${field}"
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Drag state — held in refs to avoid re-renders during drag
  const dragIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);
  // Visual drop-target row index (for --drag-over class)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

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
    const s = sorted(initialLayers);
    setLocalLayers(s);
    setOriginalLayers(s);
    setEditingCell(null);
    setErrors(new Map());
    setFormError(null);
  }, [initialLayers]);

  // ── Inline editing ────────────────────────────────────────────────────────

  const startEdit = useCallback(
    (id: string, field: EditingCell["field"]) => {
      const layer = localLayers.find((l) => l.id === id);
      if (!layer) return;
      const value =
        field === "description_md"
          ? layer.description_md ?? ""
          : layer[field];
      setEditingCell({ id, field });
      setEditingValue(value);
      // Clear any existing error for this cell so the user starts fresh
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(`${id}.${field}`);
        return next;
      });
    },
    [localLayers]
  );

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditingValue("");
  }, []);

  const validateAndCommit = useCallback(
    (id: string, field: EditingCell["field"], value: string) => {
      const trimmed = value.trim();

      // Tag constraints
      if (field === "tag") {
        if (trimmed.length < 2 || trimmed.length > 4) {
          setErrors((prev) => {
            const next = new Map(prev);
            next.set(`${id}.${field}`, "Tag must be 2–4 characters");
            return next;
          });
          // Stay in edit mode — don't commit
          return false;
        }
        // Duplicate tag check
        const duplicate = localLayers.find(
          (l) => l.id !== id && l.tag.toLowerCase() === trimmed.toLowerCase()
        );
        if (duplicate) {
          setErrors((prev) => {
            const next = new Map(prev);
            next.set(`${id}.${field}`, "Duplicate tag");
            return next;
          });
          return false;
        }
      }

      // Duplicate name check
      if (field === "name") {
        if (trimmed.length === 0) {
          setErrors((prev) => {
            const next = new Map(prev);
            next.set(`${id}.${field}`, "Name is required");
            return next;
          });
          return false;
        }
        const duplicate = localLayers.find(
          (l) => l.id !== id && l.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (duplicate) {
          setErrors((prev) => {
            const next = new Map(prev);
            next.set(`${id}.${field}`, "Duplicate name");
            return next;
          });
          return false;
        }
      }

      // Commit
      setLocalLayers((prev) =>
        prev.map((l) => {
          if (l.id !== id) return l;
          return {
            ...l,
            [field]: field === "description_md" ? trimmed || null : trimmed,
          };
        })
      );
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(`${id}.${field}`);
        return next;
      });
      setEditingCell(null);
      setEditingValue("");
      return true;
    },
    [localLayers]
  );

  const handleInputKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancelEdit();
        return;
      }
      if (
        e.key === "Enter" &&
        (e.currentTarget.tagName === "INPUT" || e.ctrlKey)
      ) {
        e.preventDefault();
        if (editingCell) {
          validateAndCommit(editingCell.id, editingCell.field, editingValue);
        }
      }
    },
    [cancelEdit, validateAndCommit, editingCell, editingValue]
  );

  const handleInputBlur = useCallback(() => {
    if (!editingCell) return;
    // blur-commit: attempt to commit on blur.
    // On validation failure: setErrors was already called inside validateAndCommit;
    // we exit editing mode so the display cell shows the --invalid highlight and
    // cell-error message. The user can click the cell again to re-enter a valid value.
    validateAndCommit(editingCell.id, editingCell.field, editingValue);
    // Always exit editing mode on blur (validateAndCommit calls setEditingCell(null)
    // on success; we call it here on failure too).
    setEditingCell(null);
    setEditingValue("");
  }, [editingCell, editingValue, validateAndCommit]);

  // ── Drag to reorder ───────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLTableRowElement>, index: number) => {
      dragIndexRef.current = index;
      e.dataTransfer.effectAllowed = "move";
      // Minimal payload so the browser shows something
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
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(dropIndex, 0, moved);
        // Reassign sort_order 1…N (no gaps)
        return next.map((l, i) => ({ ...l, sort_order: i + 1 }));
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
    setEditingCell(null);
    setEditingValue("");
    setErrors(new Map());
    setFormError(null);
  }, [originalLayers]);

  // ── Render helpers ────────────────────────────────────────────────────────

  function cellError(id: string, field: string): string | undefined {
    return errors.get(`${id}.${field}`);
  }

  function renderNameCell(layer: LayerDTO) {
    const isEditing =
      editingCell?.id === layer.id && editingCell.field === "name";
    const err = cellError(layer.id, "name");

    if (isEditing) {
      return (
        <td className="table__cell layers-editor__cell layers-editor__cell--editing">
          <input
            className={`layers-editor__input${err ? " layers-editor__input--error" : ""}`}
            value={editingValue}
            autoFocus
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            aria-label="Layer name"
          />
          {err && <span className="layers-editor__cell-error">{err}</span>}
        </td>
      );
    }
    return (
      <td
        className={`table__cell layers-editor__cell layers-editor__cell--clickable${err ? " layers-editor__cell--invalid" : ""}`}
        onClick={() => startEdit(layer.id, "name")}
        title="Click to edit"
      >
        {layer.name}
        {err && <span className="layers-editor__cell-error">{err}</span>}
      </td>
    );
  }

  function renderTagCell(layer: LayerDTO) {
    const isEditing =
      editingCell?.id === layer.id && editingCell.field === "tag";
    const err = cellError(layer.id, "tag");

    if (isEditing) {
      return (
        <td className="table__cell layers-editor__cell layers-editor__cell--editing layers-editor__cell--tag">
          <input
            className={`layers-editor__input layers-editor__input--tag${err ? " layers-editor__input--error" : ""}`}
            value={editingValue}
            autoFocus
            maxLength={4}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            aria-label="Layer tag"
          />
          {err && <span className="layers-editor__cell-error">{err}</span>}
        </td>
      );
    }
    return (
      <td
        className={`table__cell layers-editor__cell layers-editor__cell--clickable layers-editor__cell--tag${err ? " layers-editor__cell--invalid" : ""}`}
        onClick={() => startEdit(layer.id, "tag")}
        title="Click to edit"
      >
        {layer.tag}
        {err && <span className="layers-editor__cell-error">{err}</span>}
      </td>
    );
  }

  function renderDescCell(layer: LayerDTO) {
    const isEditing =
      editingCell?.id === layer.id && editingCell.field === "description_md";
    const err = cellError(layer.id, "description_md");

    if (isEditing) {
      return (
        <td className="table__cell layers-editor__cell layers-editor__cell--editing table__cell--muted">
          <textarea
            className={`layers-editor__textarea${err ? " layers-editor__input--error" : ""}`}
            value={editingValue}
            autoFocus
            rows={3}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={handleInputBlur}
            aria-label="Layer description"
          />
          {err && <span className="layers-editor__cell-error">{err}</span>}
        </td>
      );
    }
    return (
      <td
        className={`table__cell table__cell--muted layers-editor__cell layers-editor__cell--clickable${err ? " layers-editor__cell--invalid" : ""}`}
        onClick={() => startEdit(layer.id, "description_md")}
        title="Click to edit"
      >
        {layer.description_md ?? "—"}
        {err && <span className="layers-editor__cell-error">{err}</span>}
      </td>
    );
  }

  return (
    <div className="layers-editor">
      <div className="table-wrap">
        <table className="table">
          <thead className="table__head">
            <tr className="table__row">
              <th className="table__cell layers-editor__drag-header" aria-label="Drag to reorder" />
              <th className="table__cell">Order</th>
              <th className="table__cell">Tag</th>
              <th className="table__cell">Name</th>
              <th className="table__cell">Description</th>
            </tr>
          </thead>
          <tbody>
            {localLayers.map((layer, index) => {
              const isDragOver = dropTargetIndex === index;
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
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                >
                  <td className="table__cell layers-editor__drag-cell" aria-hidden="true">
                    <span className="layers-editor__drag-handle" title="Drag to reorder">
                      ⠿
                    </span>
                  </td>
                  <td className="table__cell table__cell--numeric">
                    {layer.sort_order}
                  </td>
                  {renderTagCell(layer)}
                  {renderNameCell(layer)}
                  {renderDescCell(layer)}
                </tr>
              );
            })}
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
