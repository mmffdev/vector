"use client";

/**
 * MentionPicker — the @-mention popup.
 *
 * Scaffold for PLA-XXXX (mentions). Opens when an editor calls
 * `<MentionPicker open ... />`; debounces a typeahead against
 * /_site/mentions/search; lets the user select one or many team
 * members and confirms with a callback.
 *
 * NOT yet wired into a rich-text editor — the editor surface
 * (toolbar + textarea + insertion point) is owned by whichever
 * editor we adopt. This component just owns the search + selection
 * UX; the editor calls `onConfirm` and decides what tokens/chips
 * to insert.
 *
 * Backend: app/lib/apiSite/index.ts → mentions.search.
 * Server-side scope (tenant | team) is applied by the backend;
 * the client never decides who is mentionable.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { mentions, type Mentionable } from "../lib/apiSite";

interface MentionPickerProps {
  open: boolean;
  /** Position hint — the editor decides where to anchor. */
  anchor?: { top: number; left: number };
  /** Pre-selected user IDs (when re-opening to edit). */
  initialSelected?: Mentionable[];
  /** Limit multi-select; 1 = single-pick. Default 10. */
  maxSelection?: number;
  /** Caller closes the popup. */
  onClose: () => void;
  /** Caller receives the final selection on Confirm. */
  onConfirm: (selected: Mentionable[]) => void;
}

const DEBOUNCE_MS = 150;

export function MentionPicker({
  open,
  anchor,
  initialSelected = [],
  maxSelection = 10,
  onClose,
  onConfirm,
}: MentionPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Mentionable[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Mentionable[]>(initialSelected);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Focus the input when the popup opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Reset on close so the next open is a clean slate.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setError(null);
    }
  }, [open]);

  // Outside-click closes the popup.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, onClose]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q === "") {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await mentions.search(q, 10);
        setResults(res.mentionables);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed.");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, open]);

  const selectedIds = useMemo(
    () => new Set(selected.map((s) => s.user_id)),
    [selected],
  );

  function toggle(u: Mentionable) {
    setSelected((prev) => {
      if (selectedIds.has(u.user_id)) {
        return prev.filter((p) => p.user_id !== u.user_id);
      }
      if (prev.length >= maxSelection) return prev;
      return [...prev, u];
    });
  }

  function handleConfirm() {
    onConfirm(selected);
    onClose();
  }

  if (!open) return null;

  const style: React.CSSProperties | undefined = anchor
    ? { top: anchor.top, left: anchor.left }
    : undefined;

  return (
    <div
      ref={rootRef}
      className="mention-picker"
      style={style}
      role="dialog"
      aria-label="Mention a team member"
    >
      <div className="mention-picker__Header">
        <input
          ref={inputRef}
          className="form__input mention-picker__Header_search"
          type="text"
          placeholder="Search team members…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter" && selected.length > 0) handleConfirm();
          }}
          aria-label="Search team members"
        />
      </div>

      {selected.length > 0 && (
        <div className="mention-picker__Chips" aria-label="Selected">
          {selected.map((u) => (
            <button
              key={u.user_id}
              type="button"
              className="pill pill--neutral mention-picker__Chips_pill"
              onClick={() => toggle(u)}
              aria-label={`Remove ${u.display_name}`}
            >
              {u.display_name}
              <span aria-hidden>×</span>
            </button>
          ))}
        </div>
      )}

      <div className="mention-picker__List" role="listbox">
        {loading && <div className="mention-picker__List_state">Searching…</div>}
        {error && <div className="mention-picker__List_state is-error">{error}</div>}
        {!loading && !error && query.trim() !== "" && results.length === 0 && (
          <div className="mention-picker__List_state">No matches.</div>
        )}
        {results.map((u) => {
          const isSelected = selectedIds.has(u.user_id);
          return (
            <button
              key={u.user_id}
              type="button"
              role="option"
              aria-selected={isSelected}
              className={`mention-picker__List_item${isSelected ? " is-selected" : ""}`}
              onClick={() => toggle(u)}
            >
              <span className="mention-picker__List_item-name">{u.display_name}</span>
              <span className="mention-picker__List_item-email">{u.email}</span>
            </button>
          );
        })}
      </div>

      <div className="mention-picker__Footer">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={selected.length === 0}
          onClick={handleConfirm}
        >
          Mention {selected.length > 0 ? `(${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
}
