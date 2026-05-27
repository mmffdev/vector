"use client";

// WipSettingsModal — FB1.3.6
//
// Modal that lets topology-node members edit WIP limits per column.
// Each column row has a numeric input; blank input = null = unlimited.
//
// On Save:
//   - Fires flowBoard.putWip() for every row whose limit changed.
//   - Uses Promise.all; if all succeed → calls onSaved() + onClose().
//   - On any failure → surfaces via notify.apiError; leaves modal open for retry.
//   - 403 is treated as "membership lost mid-session" → closes modal + shows
//     a toast (the gear button will disappear on next render).
//
// Uses the existing .modal-backdrop / .modal catalog classes plus
// flow-board__WipModal_* overrides for spacing/layout specifics.
//
// Spec: docs/superpowers/specs/2026-05-27-flowboard-design.md §7.4

import React, { useCallback, useEffect, useState } from "react";
import { flowBoard } from "@/app/lib/apiSite";
import { notify } from "@/app/lib/toast";
import { ApiError } from "@/app/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WipColumnEntry {
  flowStateId: string;
  flowStateName: string;
  /** null = unlimited (blank input) */
  currentLimit: number | null;
}

export interface WipSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after all PUTs succeed — parent re-fetches board data. */
  onSaved: () => void;
  topologyNodeId: string;
  artefactTypeId: string;
  columns: WipColumnEntry[];
}

// ── Internal form state ───────────────────────────────────────────────────────

/** Map of flowStateId → current input string ("" = unlimited). */
type FormState = Record<string, string>;

function buildInitialForm(columns: WipColumnEntry[]): FormState {
  const form: FormState = {};
  for (const col of columns) {
    form[col.flowStateId] =
      col.currentLimit !== null ? String(col.currentLimit) : "";
  }
  return form;
}

function parseInputToLimit(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (isNaN(n) || n < 0) return null;
  return Math.floor(n);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WipSettingsModal({
  isOpen,
  onClose,
  onSaved,
  topologyNodeId,
  columns,
}: WipSettingsModalProps): React.ReactElement | null {
  const [form, setForm] = useState<FormState>(() => buildInitialForm(columns));
  const [isSaving, setIsSaving] = useState(false);

  // Re-initialise form when columns prop changes (e.g. after a board re-fetch).
  useEffect(() => {
    setForm(buildInitialForm(columns));
  }, [columns]);

  const handleInputChange = useCallback(
    (flowStateId: string, value: string) => {
      setForm((prev) => ({ ...prev, [flowStateId]: value }));
    },
    [],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);

    // Collect only the rows that changed from the original limit.
    const changed = columns.filter((col) => {
      const newLimit = parseInputToLimit(form[col.flowStateId] ?? "");
      return newLimit !== col.currentLimit;
    });

    if (changed.length === 0) {
      // Nothing changed — just close.
      onClose();
      setIsSaving(false);
      return;
    }

    const puts = changed.map((col) =>
      flowBoard.putWip({
        nodeId: topologyNodeId,
        flowStateId: col.flowStateId,
        limit: parseInputToLimit(form[col.flowStateId] ?? ""),
      }),
    );

    try {
      await Promise.all(puts);
      onSaved();
      onClose();
    } catch (err: unknown) {
      // 403 = membership lost mid-session → close + toast (gear disappears).
      if (err instanceof ApiError && err.status === 403) {
        notify.error("You no longer have permission to edit WIP limits.");
        onClose();
      } else {
        notify.apiError(err, "Failed to save WIP limits. Please try again.");
      }
    } finally {
      setIsSaving(false);
    }
  }, [columns, form, topologyNodeId, onSaved, onClose]);

  const handleBackdropClick = useCallback(() => {
    if (!isSaving) onClose();
  }, [isSaving, onClose]);

  const handleDialogClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape" && !isSaving) onClose();
    },
    [isSaving, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="modal-backdrop flow-board__WipModal"
      role="dialog"
      aria-modal="true"
      aria-label="WIP Limit Settings"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div
        className="modal flow-board__WipModal_dialog"
        onClick={handleDialogClick}
      >
        <header className="modal__header flow-board__WipModal_header">
          <h2 className="modal__title">WIP Limits</h2>
          <button
            type="button"
            className="btn btn--icon btn--ghost modal__close flow-board__WipModal_closeBtn"
            onClick={onClose}
            disabled={isSaving}
            aria-label="Close WIP settings"
          >
            ✕
          </button>
        </header>

        <div className="modal__body flow-board__WipModal_body">
          {columns.length === 0 ? (
            <p className="flow-board__WipModal_empty">No columns found.</p>
          ) : (
            <ul className="flow-board__WipModal_list" role="list">
              {columns.map((col) => (
                <li
                  key={col.flowStateId}
                  className="flow-board__WipModal_row"
                >
                  <label
                    className="flow-board__WipModal_label"
                    htmlFor={`wip-input-${col.flowStateId}`}
                  >
                    {col.flowStateName}
                  </label>
                  <input
                    id={`wip-input-${col.flowStateId}`}
                    type="number"
                    min="0"
                    className="flow-board__WipModal_input"
                    value={form[col.flowStateId] ?? ""}
                    placeholder="Unlimited"
                    onChange={(e) =>
                      handleInputChange(col.flowStateId, e.target.value)
                    }
                    disabled={isSaving}
                    aria-label={`WIP limit for ${col.flowStateName}`}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="modal__actions flow-board__WipModal_footer">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onClose}
            disabled={isSaving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void handleSave()}
            disabled={isSaving}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default WipSettingsModal;
