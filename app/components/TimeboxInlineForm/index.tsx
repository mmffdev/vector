"use client";

// <TimeboxInlineForm> — inline edit form for a single sprint or release
// row. Mounted by ObjectTreeV2's <ObjectTreeDetailFlyout> when the user
// clicks a row in the timeboxes grid. Slice 6.2 of the ObjectTree
// refactor.
//
// Single component handles both kinds because the field surface is
// identical apart from wire-key prefix and apiBase. The kind comes in
// as a prop alongside the row id; the form derives its column prefix
// and endpoints from a tiny kind-specific config map kept inline so
// the component stays in one file.
//
// Lifecycle contract matches ArtefactInlineForm: rowId nullable, render
// nothing when null, internal state collapses when rowId clears so the
// shell can leave the body mounted (animation continuity).

import React, { useCallback, useEffect, useState } from "react";
import { apiSite, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { useAuth } from "@/app/contexts/AuthContext";

// ── Kind config ────────────────────────────────────────────────────────────

type Kind = "sprint" | "release";

interface KindCfg {
  apiBase: string;
  rowPrefix: string;
  namePrefix: string;
}

const KIND_CFG: Record<Kind, KindCfg> = {
  sprint: {
    apiBase: "/timeboxes/sprints",
    rowPrefix: "timeboxes_sprints",
    namePrefix: "Sprint",
  },
  release: {
    apiBase: "/timeboxes/releases",
    rowPrefix: "timeboxes_releases",
    namePrefix: "Release",
  },
};

// ── Row + props ────────────────────────────────────────────────────────────

/**
 * Wire shape for a timebox row. Keys carry the full table prefix.
 */
type TimeboxRow = Record<string, unknown>;

export interface TimeboxInlineFormProps {
  /** Row id whose detail is being rendered. Null = closed (renders nothing). */
  rowId: string | null;
  /** Sprint vs release — drives endpoint + prefix derivation. */
  kind: Kind;
  /** Workspace scope from useAuth — passed through ?workspace_id=. */
  workspaceId: string;
  /** Called when the user closes the form (Esc / outside-click / X). */
  onClose: () => void;
  /** Called after a successful save — body forwards to the data hook. */
  onSaved?: (patch: Record<string, unknown>) => void;
}

// ── Form state ─────────────────────────────────────────────────────────────

interface EditableState {
  suffix: string;
  cadence_days: string;
  date_start: string;
  date_end: string;
  velocity: string;
}

function extractEditable(row: TimeboxRow, p: string): EditableState {
  const get = (k: string): string => {
    const v = row[`${p}_${k}`];
    return v === null || v === undefined ? "" : String(v);
  };
  return {
    suffix: get("suffix"),
    cadence_days: get("cadence_days"),
    date_start: get("date_start"),
    date_end: get("date_end"),
    velocity: get("velocity"),
  };
}

function diffEditable(
  current: EditableState,
  original: EditableState,
  p: string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const numericKeys: Array<keyof EditableState> = ["cadence_days", "velocity"];
  for (const key of Object.keys(current) as Array<keyof EditableState>) {
    if (current[key] === original[key]) continue;
    const wireKey = `${p}_${key}`;
    if (numericKeys.includes(key)) {
      const parsed = parseInt(current[key], 10);
      patch[wireKey] = isNaN(parsed) ? null : parsed;
    } else {
      patch[wireKey] = current[key] === "" ? null : current[key];
    }
  }
  return patch;
}

// ── Status pill ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cls = status === "active"
    ? "pill pill--success"
    : status === "completed"
      ? "pill pill--neutral"
      : "pill pill--info";
  return <span className={cls}>{status || "—"}</span>;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TimeboxInlineForm({
  rowId,
  kind,
  workspaceId,
  onClose,
  onSaved,
}: TimeboxInlineFormProps) {
  const cfg = KIND_CFG[kind];
  const p = cfg.rowPrefix;
  const { user: _user } = useAuth();

  const [row, setRow] = useState<TimeboxRow | null>(null);
  const [original, setOriginal] = useState<EditableState | null>(null);
  const [editable, setEditable] = useState<EditableState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  const refetch = useCallback(async () => {
    if (!rowId || !workspaceId) return;
    setLoading(true);
    try {
      const res = await apiSite<TimeboxRow>(
        `${cfg.apiBase}/${rowId}?workspace_id=${workspaceId}`,
      );
      setRow(res);
      const ed = extractEditable(res, p);
      setOriginal(ed);
      setEditable(ed);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to load ${kind}`);
    } finally {
      setLoading(false);
    }
  }, [rowId, workspaceId, cfg.apiBase, p, kind]);

  useEffect(() => {
    if (rowId) {
      void refetch();
    } else {
      setRow(null);
      setOriginal(null);
      setEditable(null);
    }
  }, [rowId, refetch]);

  // Null guard AFTER hooks are declared — preserves hook order across
  // rerenders. The shell still mounts the body when openId is null;
  // we just render nothing in that case.
  if (!rowId || !editable || !original) return null;

  const status = String(row?.[`${p}_status`] ?? "planned");
  const isDirty =
    Object.keys(diffEditable(editable, original, p)).length > 0;

  const handleChange = (key: keyof EditableState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditable((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
    };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty) return;
    setSaving(true);
    try {
      const patch = diffEditable(editable, original, p);
      const updated = await apiSite<TimeboxRow>(
        `${cfg.apiBase}/${rowId}?workspace_id=${workspaceId}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      notify.success(`${cfg.namePrefix} saved`);
      setRow(updated);
      const ed = extractEditable(updated, p);
      setOriginal(ed);
      setEditable(ed);
      onSaved?.(patch);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to save ${kind}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (action: "start" | "close") => {
    setTransitioning(true);
    try {
      const updated = await apiSite<TimeboxRow>(
        `${cfg.apiBase}/${rowId}/${action}?workspace_id=${workspaceId}`,
        { method: "POST" },
      );
      notify.success(`${cfg.namePrefix} ${action === "start" ? "started" : "closed"}`);
      setRow(updated);
      const ed = extractEditable(updated, p);
      setOriginal(ed);
      setEditable(ed);
      onSaved?.({ [`${p}_status`]: action === "start" ? "active" : "completed" });
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to ${action} ${kind}`);
    } finally {
      setTransitioning(false);
    }
  };

  const canStart = status === "planned";
  const canClose = status === "active";
  const busy = saving || transitioning || loading;

  return (
    <section
      className="timebox-inline-form"
      aria-label={`${cfg.namePrefix} editor`}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>
          {String(row?.[`${p}_name`] ?? "—")}
          {editable.suffix && (
            <span style={{ color: "var(--ink-subtle)", marginLeft: 8 }}>
              ({editable.suffix})
            </span>
          )}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusPill status={status} />
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            aria-label="Close"
          >
            Close
          </button>
        </div>
      </header>

      <form className="form" onSubmit={handleSave}>
        <div className="form__row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="form__label">
            Suffix
            <input
              className="form__input"
              type="text"
              value={editable.suffix}
              onChange={handleChange("suffix")}
              placeholder="e.g. Red Cherry"
              disabled={busy}
            />
          </label>
          <label className="form__label">
            Cadence (days)
            <input
              className="form__input"
              type="number"
              min={1}
              value={editable.cadence_days}
              onChange={handleChange("cadence_days")}
              disabled={busy}
            />
          </label>
        </div>

        <div className="form__row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="form__label">
            Start
            <input
              className="form__input"
              type="date"
              value={editable.date_start}
              onChange={handleChange("date_start")}
              disabled={busy}
            />
          </label>
          <label className="form__label">
            End
            <input
              className="form__input"
              type="date"
              value={editable.date_end}
              onChange={handleChange("date_end")}
              disabled={busy}
            />
          </label>
        </div>

        <div className="form__row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="form__label">
            Velocity
            <input
              className="form__input"
              type="number"
              min={0}
              value={editable.velocity}
              onChange={handleChange("velocity")}
              placeholder="—"
              disabled={busy}
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            {canStart && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => handleTransition("start")}
                disabled={busy}
              >
                {transitioning ? "Starting…" : "Start"}
              </button>
            )}
            {canClose && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => handleTransition("close")}
                disabled={busy}
              >
                {transitioning ? "Closing…" : "Close sprint"}
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: 16,
            gap: 8,
          }}
        >
          <button
            type="submit"
            className="btn btn--primary btn--sm"
            disabled={busy || !isDirty}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </section>
  );
}
