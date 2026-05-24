"use client";

// HomeLocationSection — the "where do you want Vector to land you when
// you sign in?" dropdown on /user/account-settings. Saves to
// users.default_focus_node_id via PUT /_site/sentinel/focus, which the
// Sentinel middleware honours on every subsequent boot (focus precedence:
// ?meg= URL > this > tenant root).
//
// Design decisions pinned in
// docs/superpowers/specs/2026-05-24-home-location-dropdown-design.md:
//   - Flat <select> with <optgroup> per workspace (em-space indent
//     conveys depth without a tree widget). Good default for users with
//     <20 nodes; revisit if real-world usage shows otherwise.
//   - Save-on-change, optimistic (matches the Notifications toggles at
//     the bottom of the same page). No Save button.
//   - First option clears the column (NULL → fall through to tenant root).

import { useMemo, useState } from "react";
import { useSentinel } from "@/app/sentinel";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";
import { ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import ToggleBtn from "@/app/components/ToggleBtn";
import type { SentinelGrant } from "@/app/sentinel/types";

interface FlatRow {
  grant: SentinelGrant;
  depth: number;
  label: string;
}

function labelOf(g: SentinelGrant): string {
  return g.label_override?.trim() || g.name || g.node_id;
}

// Flatten the user's grants into a depth-annotated list using the same
// walker that ScopeGroupPanel uses — keeps the option order identical
// to what the user sees in the scope rail.
function flatten(grants: readonly SentinelGrant[]): FlatRow[] {
  const wrapped = grants.map((g) => ({
    id: g.node_id,
    parent_id: g.parent_id ?? null,
    position: g.position ?? 0,
    grant: g,
  }));
  const { rows } = walkTopology(wrapped, { collapsed: new Set(), sort: byPosition });
  return rows.map((r) => ({
    grant: r.node.grant,
    depth: r.depth,
    label: labelOf(r.node.grant),
  }));
}

interface GroupedRows {
  workspaceId: string;
  workspaceName: string;
  rows: FlatRow[];
}

function groupByWorkspace(flat: FlatRow[]): GroupedRows[] {
  const map = new Map<string, GroupedRows>();
  for (const row of flat) {
    const wsId = row.grant.workspace_id ?? "";
    if (!map.has(wsId)) {
      // Workspace name = label of the depth-0 grant for that workspace.
      const wsRoot = flat.find((x) => (x.grant.workspace_id ?? "") === wsId && x.depth === 0);
      map.set(wsId, {
        workspaceId: wsId,
        workspaceName: wsRoot?.label ?? "Workspace",
        rows: [],
      });
    }
    map.get(wsId)!.rows.push(row);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.workspaceName.localeCompare(b.workspaceName, undefined, { sensitivity: "base" }),
  );
}

export default function HomeLocationSection() {
  const {
    sentinel_user: user,
    sentinel_grants: grants,
    sentinel_set_default_focus,
    sentinel_set_home_follow_mode,
  } = useSentinel();
  const [busyDropdown, setBusyDropdown] = useState(false);
  const [busyToggle, setBusyToggle] = useState(false);

  const groups = useMemo(() => groupByWorkspace(flatten(grants)), [grants]);
  const currentValue = user?.default_focus_node_id ?? "";
  const followMode = user?.home_location_follow_mode ?? false;

  async function onDropdownChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    setBusyDropdown(true);
    try {
      await sentinel_set_default_focus(next);
      notify.success("Home location saved");
    } catch (err) {
      // sentinel_set_default_focus already reverted
      // user.default_focus_node_id on failure. We just surface the error.
      if (err instanceof ApiError && err.status === 403) {
        notify.error("You no longer have access to that node.");
      } else {
        notify.error("Could not save home location. Please try again.");
      }
    } finally {
      setBusyDropdown(false);
    }
  }

  async function onToggleChange(next: boolean) {
    setBusyToggle(true);
    try {
      await sentinel_set_home_follow_mode(next);
      notify.success(next ? "Home location will follow your scope" : "Home location pinned");
    } catch {
      notify.error("Could not save home location mode. Please try again.");
    } finally {
      setBusyToggle(false);
    }
  }

  if (groups.length === 0) {
    return (
      <>
        <h3 className="eyebrow">Home Location</h3>
        <p className="form__hint">You don&apos;t have access to any topology nodes yet.</p>
      </>
    );
  }

  return (
    <>
      <h3 className="eyebrow">Home Location</h3>
      <form className="form u-mb-8" onSubmit={(e) => e.preventDefault()}>
        <div className="form__row">
          <label className="form__label">
            Mode
            <span className="form__hint">
              Pinned — your home stays where you set it. Follow — your
              home updates as you move around the scope rail.
            </span>
          </label>
          <ToggleBtn
            value={followMode}
            onChange={onToggleChange}
            labels={["Pinned", "Follow"]}
          />
        </div>
        <div className="form__row">
          <label className="form__label">
            Where do you want Vector to land you when you sign in?
            <select
              className="form__input"
              value={currentValue}
              onChange={onDropdownChange}
              disabled={busyDropdown || busyToggle}
            >
              <option value="">— (none — use workspace root) —</option>
              {groups.map(({ workspaceId, workspaceName, rows }) => (
                <optgroup key={workspaceId || "no-workspace"} label={workspaceName}>
                  {rows.map(({ grant, depth, label }) => (
                    <option key={grant.node_id} value={grant.node_id}>
                      {" ".repeat(Math.max(0, depth - 1))}
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </form>
    </>
  );
}
