"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

interface Props {
  value: string;
  // Return `false` to keep the user in edit mode (e.g., validation failure).
  // Anything else (true / void / undefined) exits edit mode.
  onCommit: (next: string) => boolean | void;
  ariaLabel: string;
  inputClassName?: string;
  displayClassName?: string;
  containerClassName?: string;
  maxLength?: number;
  placeholder?: string;
  // When true, single-click on the display switches to edit mode.
  clickToEdit?: boolean;
  // When true, double-click on the display switches to edit mode.
  doubleClickToEdit?: boolean;
  // Render a pencil trigger. If omitted, the parent provides its own trigger.
  showEditTrigger?: boolean;
  // Optional hard-stop pointer events on input (for use inside drag-source rows).
  stopPointerOnInput?: boolean;
  // External controllers: open from parent (e.g., a parent ✎ button).
  editing?: boolean;
  onEditingChange?: (next: boolean) => void;
  // Multi-line variant — renders a <textarea> instead of <input>.
  multiline?: boolean;
  rows?: number;
  // Allow empty submissions (otherwise empty trims revert to value).
  allowEmpty?: boolean;
  // What to show in display mode when the value is empty (e.g. "—").
  emptyDisplay?: string;
  // Extra classname(s) to apply to the input/textarea when in error state.
  errorClassName?: string;
  hasError?: boolean;
}

export default function InlineEditField({
  value,
  onCommit,
  ariaLabel,
  inputClassName,
  displayClassName,
  containerClassName,
  maxLength = 64,
  placeholder,
  clickToEdit = false,
  doubleClickToEdit = false,
  showEditTrigger = false,
  stopPointerOnInput = false,
  editing: editingProp,
  onEditingChange,
  multiline = false,
  rows = 3,
  allowEmpty = false,
  emptyDisplay = "—",
  errorClassName,
  hasError = false,
}: Props) {
  const isControlled = typeof editingProp === "boolean";
  const [editingLocal, setEditingLocal] = useState(false);
  const editing = isControlled ? (editingProp as boolean) : editingLocal;
  const setEditing = (next: boolean) => {
    if (!isControlled) setEditingLocal(next);
    onEditingChange?.(next);
  };

  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  // Suppress duplicate commits (Enter and onBlur can both fire).
  const committedRef = useRef(false);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    const trimmed = draft.trim();
    const isEmpty = trimmed.length === 0;
    const unchanged = trimmed === value;

    if ((isEmpty && !allowEmpty) || unchanged) {
      setDraft(value);
      setEditing(false);
      setTimeout(() => { committedRef.current = false; }, 0);
      return;
    }

    const result = onCommit(trimmed);
    // If parent signals validation failure, stay in edit mode and keep draft.
    if (result === false) {
      setTimeout(() => { committedRef.current = false; }, 0);
      return;
    }
    setEditing(false);
    setTimeout(() => { committedRef.current = false; }, 0);
  };

  const cancel = () => {
    committedRef.current = true;
    setDraft(value);
    setEditing(false);
    setTimeout(() => { committedRef.current = false; }, 0);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Escape") { e.preventDefault(); cancel(); return; }
    // Plain Enter commits inputs. Textareas commit on Ctrl/⌘-Enter; plain
    // Enter inserts a newline (standard textarea behavior).
    if (e.key === "Enter") {
      if (multiline && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      commit();
    }
  };

  if (editing) {
    const stop = stopPointerOnInput ? { onPointerDown: (e: React.PointerEvent) => e.stopPropagation() } : {};
    const inputCls = `inline-edit__input${multiline ? " inline-edit__input--multiline" : ""} ${inputClassName ?? ""}${hasError && errorClassName ? ` ${errorClassName}` : ""}`;
    return (
      <span className={`inline-edit${multiline ? " inline-edit--multiline" : ""} ${containerClassName ?? ""}`}>
        {multiline ? (
          <textarea
            className={inputCls}
            value={draft}
            autoFocus
            rows={rows}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={hasError || undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            {...stop}
          />
        ) : (
          <input
            className={inputCls}
            value={draft}
            autoFocus
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={hasError || undefined}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={onKey}
            {...stop}
          />
        )}
        {/* onMouseDown fires before input blur, so the click is registered. */}
        <button
          type="button"
          className="inline-edit__btn inline-edit__btn--cancel"
          aria-label="Cancel change"
          title="Cancel (Esc)"
          onMouseDown={(e) => { e.preventDefault(); cancel(); }}
          {...stop}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <button
          type="button"
          className="inline-edit__btn inline-edit__btn--accept"
          aria-label="Accept change"
          title={multiline ? "Accept (⌘/Ctrl+Enter)" : "Accept (Enter)"}
          onMouseDown={(e) => { e.preventDefault(); commit(); }}
          {...stop}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </span>
    );
  }

  const triggers: React.HTMLAttributes<HTMLSpanElement> = {};
  if (clickToEdit) triggers.onClick = () => setEditing(true);
  if (doubleClickToEdit) triggers.onDoubleClick = () => setEditing(true);

  const displayText = value.length > 0 ? value : emptyDisplay;

  return (
    <>
      <span
        className={displayClassName}
        title={doubleClickToEdit ? "Double-click to edit" : clickToEdit ? "Click to edit" : undefined}
        {...triggers}
      >
        {displayText}
      </span>
      {showEditTrigger && (
        <button
          type="button"
          className="nav-prefs__btn"
          aria-label={ariaLabel}
          title="Rename"
          onClick={(e) => { e.stopPropagation(); setEditing(true); }}
          onPointerDown={stopPointerOnInput ? (e) => e.stopPropagation() : undefined}
        >✎</button>
      )}
    </>
  );
}
