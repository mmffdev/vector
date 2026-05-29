"use client";

// <TimeboxInlineForm> — inline edit form for a single sprint, release, or milestone
// row. Mounted by ObjectTreeV2's <ObjectTreeDetailFlyout> when the user
// clicks a row in the timeboxes grid. Slice 6.2 of the ObjectTree
// refactor.
//
// sprint + release share a body because their field surface is identical
// apart from wire-key prefix and apiBase. milestone has a different
// surface (point-in-time vs date-range; no cadence/velocity) so it
// gets its own MilestoneBody — dispatched via early-return after hooks.
// The kind comes in as a prop alongside the row id; the form derives
// its column prefix and endpoints from a tiny kind-specific config map
// kept inline so the component stays in one file.
//
// Lifecycle contract matches ArtefactInlineForm: rowId nullable, render
// nothing when null, internal state collapses when rowId clears so the
// shell can leave the body mounted (animation continuity).

import React, { useCallback, useEffect, useState } from "react";
import { apiSite, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { useSentinel } from "@/app/sentinel";

// ── Kind config ────────────────────────────────────────────────────────────

type Kind = "sprint" | "release" | "milestone";

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
  milestone: {
    apiBase: "/timeboxes/milestones",
    rowPrefix: "timeboxes_milestones",
    namePrefix: "Milestone",
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
  /** Sprint / release / milestone — drives endpoint + prefix derivation. */
  kind: Kind;
  /** Workspace scope from useAuth — passed through ?workspace_id=. */
  workspaceId: string;
  /**
   * Slice 7 — active topology node from useScope. Threaded through every
   * read AND write call so the backend can identify heartbeat-inherited
   * rows. When the row is inherited, the form switches to read-only +
   * shows the propagation banner. When the user PATCHes an inherited
   * row, the backend returns 409 ErrInheritedReadOnly and the form
   * surfaces the message via the existing toast path.
   */
  orgNodeId?: string;
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
      : status === "missed"
        ? "pill pill--danger"
        : "pill pill--info";
  return <span className={cls}>{status || "—"}</span>;
}

// ── Milestone-specific editable shape ──────────────────────────────────────
// Milestones are point-in-time markers: no suffix, no cadence, no
// date range, no velocity. Just name + description + single target
// date + status.

interface MilestoneEditableState {
  name: string;
  description: string;
  date_target: string;
  status: string;
}

function extractMilestoneEditable(row: TimeboxRow): MilestoneEditableState {
  const get = (col: string): string => {
    const v = row[`timeboxes_milestones_${col}`];
    return v === null || v === undefined ? "" : String(v);
  };
  return {
    name: get("name"),
    description: get("description"),
    date_target: get("date_target"),
    status: get("status") || "planned",
  };
}

function diffMilestoneEditable(
  current: MilestoneEditableState,
  initial: MilestoneEditableState,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (current.name !== initial.name) {
    patch.timeboxes_milestones_name = current.name;
  }
  if (current.description !== initial.description) {
    patch.timeboxes_milestones_description = current.description || null;
  }
  if (current.date_target !== initial.date_target) {
    patch.timeboxes_milestones_date_target = current.date_target;
  }
  if (current.status !== initial.status) {
    patch.timeboxes_milestones_status = current.status;
  }
  return patch;
}

// ── MilestoneBody ──────────────────────────────────────────────────────────

function MilestoneBody({
  rowId,
  workspaceId,
  orgNodeId,
  onClose,
  onSaved,
}: TimeboxInlineFormProps) {
  const cfg = KIND_CFG.milestone;
  const [row, setRow] = useState<TimeboxRow | null>(null);
  const [edit, setEdit] = useState<MilestoneEditableState | null>(null);
  const [initial, setInitial] = useState<MilestoneEditableState | null>(null);
  const [saving, setSaving] = useState(false);

  const qs = useCallback(() => {
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (orgNodeId) params.set("org_node_id", orgNodeId);
    return params.toString();
  }, [workspaceId, orgNodeId]);

  useEffect(() => {
    if (!rowId) {
      setRow(null);
      setEdit(null);
      setInitial(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiSite<TimeboxRow>(
          `${cfg.apiBase}/${rowId}?${new URLSearchParams({ workspace_id: workspaceId, ...(orgNodeId ? { org_node_id: orgNodeId } : {}) }).toString()}`,
        );
        if (cancelled) return;
        setRow(data);
        const editable = extractMilestoneEditable(data);
        setEdit(editable);
        setInitial(editable);
      } catch (e) {
        if (!cancelled) {
          notify.apiError(e as ApiError, "Failed to load milestone");
        }
      }
    })();
    return () => { cancelled = true; };
  }, [rowId, workspaceId, orgNodeId, cfg.apiBase]);

  const handleSave = useCallback(async () => {
    if (!rowId || !edit || !initial) return;
    const patch = diffMilestoneEditable(edit, initial);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await apiSite<TimeboxRow>(
        `${cfg.apiBase}/${rowId}?${qs()}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      notify.success("Milestone saved");
      onSaved?.(patch);
      onClose();
    } catch (e) {
      notify.apiError(e as ApiError, "Failed to save milestone");
    } finally {
      setSaving(false);
    }
  }, [rowId, edit, initial, cfg.apiBase, qs, onSaved, onClose]);

  if (!rowId || !row || !edit) return null;

  const status = String(row.timeboxes_milestones_status ?? "planned");
  const name = String(row.timeboxes_milestones_name ?? "—");

  return (
    <section
      className="timebox-inline-form"
      aria-label="Milestone editor"
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0 }}>{name}</h3>
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

      <form
        className="form"
        onSubmit={(e) => { e.preventDefault(); void handleSave(); }}
      >
        <div className="form__row">
          <label className="form__label">
            Name
            <input
              className="form__input"
              type="text"
              value={edit.name}
              onChange={(e) => setEdit((prev) => prev ? { ...prev, name: e.target.value } : prev)}
              disabled={saving}
              required
            />
          </label>
        </div>

        <div className="form__row">
          <label className="form__label">
            Description
            <textarea
              className="form__input"
              value={edit.description}
              onChange={(e) => setEdit((prev) => prev ? { ...prev, description: e.target.value } : prev)}
              disabled={saving}
              rows={3}
            />
          </label>
        </div>

        <div className="form__row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="form__label">
            Target Date
            <input
              className="form__input"
              type="date"
              value={edit.date_target}
              onChange={(e) => setEdit((prev) => prev ? { ...prev, date_target: e.target.value } : prev)}
              disabled={saving}
              required
            />
          </label>
          <label className="form__label">
            Status
            <select
              className="form__input"
              value={edit.status}
              onChange={(e) => setEdit((prev) => prev ? { ...prev, status: e.target.value } : prev)}
              disabled={saving}
            >
              <option value="planned">Planned</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="missed">Missed</option>
            </select>
          </label>
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
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function TimeboxInlineForm(props: TimeboxInlineFormProps) {
  const { rowId, kind, workspaceId, orgNodeId, onClose, onSaved } = props;
  const cfg = KIND_CFG[kind];
  const p = cfg.rowPrefix;
  const { sentinel_user: _user } = useSentinel();

  const [row, setRow] = useState<TimeboxRow | null>(null);
  const [original, setOriginal] = useState<EditableState | null>(null);
  const [editable, setEditable] = useState<EditableState | null>(null);
  const [propagation, setPropagation] = useState<string>("this_node_only");
  const [originalPropagation, setOriginalPropagation] = useState<string>("this_node_only");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);

  // Slice 7 — querystring helper. Every read AND write threads the
  // active topology node so the backend can identify inherited rows
  // and (on writes) return 409 ErrInheritedReadOnly when appropriate.
  const qs = useCallback(() => {
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (orgNodeId) params.set("org_node_id", orgNodeId);
    return params.toString();
  }, [workspaceId, orgNodeId]);

  const refetch = useCallback(async () => {
    if (kind === "milestone") return;
    if (!rowId || !workspaceId) return;
    setLoading(true);
    try {
      const res = await apiSite<TimeboxRow>(`${cfg.apiBase}/${rowId}?${qs()}`);
      setRow(res);
      const ed = extractEditable(res, p);
      setOriginal(ed);
      setEditable(ed);
      const prop = String(res[`${p}_scope_propagation`] ?? "this_node_only");
      setPropagation(prop);
      setOriginalPropagation(prop);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to load ${kind}`);
    } finally {
      setLoading(false);
    }
  }, [rowId, workspaceId, cfg.apiBase, p, kind, qs]);

  useEffect(() => {
    if (rowId) {
      void refetch();
    } else {
      setRow(null);
      setOriginal(null);
      setEditable(null);
      setPropagation("this_node_only");
      setOriginalPropagation("this_node_only");
    }
  }, [rowId, refetch]);

  // Milestone dispatch — after all hooks so hook order is preserved.
  // MilestoneBody owns its own state; the sprint/release hooks above
  // run but go unused (refetch returns early when rowId is null, and
  // for milestone the editable shape is incompatible anyway).
  if (kind === "milestone") {
    return <MilestoneBody {...props} />;
  }

  // Null guard AFTER hooks are declared — preserves hook order across
  // rerenders. The shell still mounts the body when openId is null;
  // we just render nothing in that case.
  if (!rowId || !editable || !original) return null;

  const status = String(row?.[`${p}_status`] ?? "planned");
  // Slice 7 — inheritance read. The backend stamps origin/from_* on
  // the wire (slice 5B). When origin=inherited the form is read-only
  // and shows a banner with the pinned-node name.
  const origin = String(row?.origin ?? "local");
  const isInherited = origin === "inherited";
  const fromNodeName = (row?.from_node_name as string | null | undefined) ?? null;

  const isDirty =
    Object.keys(diffEditable(editable, original, p)).length > 0
    || propagation !== originalPropagation;

  const handleChange = (key: keyof EditableState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setEditable((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
    };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isDirty || isInherited) return;
    setSaving(true);
    try {
      const patch: Record<string, unknown> = diffEditable(editable, original, p);
      if (propagation !== originalPropagation) {
        patch[`${p}_scope_propagation`] = propagation;
      }
      const updated = await apiSite<TimeboxRow>(
        `${cfg.apiBase}/${rowId}?${qs()}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      notify.success(`${cfg.namePrefix} saved`);
      setRow(updated);
      const ed = extractEditable(updated, p);
      setOriginal(ed);
      setEditable(ed);
      const newProp = String(updated[`${p}_scope_propagation`] ?? "this_node_only");
      setPropagation(newProp);
      setOriginalPropagation(newProp);
      onSaved?.(patch);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to save ${kind}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (action: "start" | "close") => {
    if (isInherited) return;
    setTransitioning(true);
    try {
      const updated = await apiSite<TimeboxRow>(
        `${cfg.apiBase}/${rowId}/${action}?${qs()}`,
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

      {isInherited && (
        <div
          role="status"
          className="timebox-inline-form__inherited-banner"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "10px 14px",
            marginBottom: 16,
            background: "var(--surface-info-tint, var(--surface-2))",
            border: "1px solid var(--surface-info, var(--surface-3))",
            borderRadius: 6,
            color: "var(--ink-muted)",
            fontSize: 13,
          }}
        >
          <span aria-hidden="true">↑</span>
          <span>
            Read-only. This {kind} is inherited from
            {fromNodeName ? <strong> {fromNodeName}</strong> : " a parent node"} —
            edit it on its pinned node to make changes.
          </span>
        </div>
      )}

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
              disabled={busy || isInherited}
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
              disabled={busy || isInherited}
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
              disabled={busy || isInherited}
            />
          </label>
          <label className="form__label">
            End
            <input
              className="form__input"
              type="date"
              value={editable.date_end}
              onChange={handleChange("date_end")}
              disabled={busy || isInherited}
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
              disabled={busy || isInherited}
            />
          </label>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            {canStart && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => handleTransition("start")}
                disabled={busy || isInherited}
              >
                {transitioning ? "Starting…" : "Start"}
              </button>
            )}
            {canClose && (
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={() => handleTransition("close")}
                disabled={busy || isInherited}
              >
                {transitioning ? "Closing…" : "Close sprint"}
              </button>
            )}
          </div>
        </div>

        <fieldset
          className="form__fieldset"
          style={{
            marginTop: 16,
            padding: 12,
            border: "1px solid var(--surface-3)",
            borderRadius: 6,
            background: "var(--surface-2)",
          }}
          disabled={busy || isInherited}
        >
          <legend
            style={{
              padding: "0 6px",
              fontSize: 12,
              color: "var(--ink-muted)",
              fontWeight: 500,
            }}
          >
            Scope propagation
          </legend>
          <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="scope-propagation"
                value="this_node_only"
                checked={propagation === "this_node_only"}
                onChange={(e) => setPropagation(e.target.value)}
              />
              <span>
                <strong>This node only</strong>{" "}
                <span style={{ color: "var(--ink-subtle)" }}>
                  — visible only on the pinned node (default).
                </span>
              </span>
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="scope-propagation"
                value="this_node_and_descendants"
                checked={propagation === "this_node_and_descendants"}
                onChange={(e) => setPropagation(e.target.value)}
              />
              <span>
                <strong>This node and descendants</strong>{" "}
                <span style={{ color: "var(--ink-subtle)" }}>
                  — visible on the pinned node AND every live descendant.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

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
            disabled={busy || !isDirty || isInherited}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </section>
  );
}
