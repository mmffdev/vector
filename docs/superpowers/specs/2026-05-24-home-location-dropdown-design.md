# Home Location dropdown on /user/account-settings — design spec

**Date.** 2026-05-24
**Author.** Claude (Opus 4.7) with Rick (cookra@me.com)
**Status.** Approved — proceeding to implementation
**Related.**
- Commit `19df4e33` — `feat(sentinel): PUT /sentinel/focus — persist default focus node [PLA062 follow-up]`
- [docs/Security/Sentinel/sentinel_docs.md](../../Security/Sentinel/sentinel_docs.md)
- [docs/Security/Sentinel/sentinel_revision_history.md](../../Security/Sentinel/sentinel_revision_history.md) (the 2026-05-24 `PUT /sentinel/focus` entry)

---

## Synopsis

Add a "Home Location" dropdown to [app/user/account-settings/page.tsx](../../../app/user/account-settings/page.tsx) so a user can pick which topology node they want to land on every time they sign in. The choice is saved to `users.default_focus_node_id` (column already exists per migration 243) via the `PUT /_site/sentinel/focus` endpoint (handler already exists per commit `19df4e33`). The Sentinel middleware already honours `users.default_focus_node_id` in its focus-precedence chain (`?meg=` > user default > tenant root). The only missing pieces are:

1. **Backend boot payload** — `/auth/me` currently doesn't return `default_focus_node_id`, so the frontend `SentinelUser.default_focus_node_id` is hardcoded to `null` ([app/sentinel/sentinel_api.ts:116](../../../app/sentinel/sentinel_api.ts#L116)). Without this, the dropdown can save but won't show the saved value across reloads.
2. **Frontend optimistic update** — after a successful `putFocus()`, the reducer needs to update `state.user.default_focus_node_id` so the dropdown reflects the new value immediately (without waiting for a re-boot).
3. **The dropdown UI itself.**

This spec covers all three.

---

## Goals

- A user can set "this is my home topology node" on the account-settings page and have it durably saved.
- On their next sign-in (any device, any session), Vector lands them on that node.
- The control is keyboard-accessible, native, and matches the form patterns already on the page.
- The setting is **per-user**, not per-workspace — it crosses workspaces, since a user with grants in multiple workspaces should be able to pick any node they have access to as their home.

## Non-goals

- No tree/popover/typeahead UI. Flat `<select>` with `<optgroup>` per workspace is sufficient for the typical user (< 20 nodes). If we discover users with 100+ nodes, that's a separate iteration.
- No scope_up/scope_down direction controls in this work (migration 243 added those columns too; UI is a future story).
- No bulk-edit / admin-set-other-user's-home affordance.
- No migration. The DB column has shipped since S06.

---

## User-facing behaviour

### Visual layout

The dropdown sits between **Profile** and **Password** sections, with its own `<h3 className="eyebrow">` and a one-line helper. Matches the existing form rhythm on the page.

```
[Profile form]
  Display name: [          ]
  Email: [readonly]
  [Save profile]

[Home Location]
  Where do you want Vector to land you when you sign in?
  [ — (none — use workspace root) —                 ▼ ]

[Password form]
  ...
```

### Dropdown contents

- First option: `<option value="">— (none — use workspace root) —</option>` — selecting this clears `default_focus_node_id` to NULL.
- One `<optgroup label="<workspace name>">` per distinct `workspace_id` in `sentinel_grants`, sorted by workspace name (case-insensitive, locale-aware).
- Inside each optgroup, one `<option value={grant.node_id}>{indent}{labelOf(grant)}</option>` per grant, sorted by `position` ASC (matches ScopeGroupPanel's `byPosition` sort).
- `{indent}` is ` ` (em-space) repeated `depth - 1` times, where depth comes from the same `walkTopology` walker `ScopeGroupPanel` uses. Conveys hierarchy without a tree widget. Depth 0 (workspace root) gets no indent.
- `labelOf(grant)` reuses the helper from [ScopeGroupPanel.tsx](../../../app/components/ScopeGroupPanel.tsx) (`label_override` > `name` > `node_id`).

### Save behaviour

- **Save-on-change, optimistic.** No Save button.
- `onChange`:
  1. Capture the previous value (for revert).
  2. Optimistically dispatch a reducer action that updates `state.user.default_focus_node_id`.
  3. Fire `putFocus(value || null)` (already exists at [app/sentinel/sentinel_api.ts:166](../../../app/sentinel/sentinel_api.ts#L166)).
  4. On success: `notify.success("Home location saved")`.
  5. On failure: dispatch revert to previous value + `notify.error("Could not save home location. Please try again.")`.
- The control is `disabled` while the request is in flight (so rapid changes don't race).
- After a 403 specifically (server says no grant on the node), show `notify.error("You no longer have access to that node.")` — defensive against a grant being revoked between fetching the grants list and the user choosing.

### Edge cases

- **User has zero grants.** Dropdown renders with only the "none" option, and a hint: "You don't have access to any topology nodes yet." (Effectively read-only.)
- **User's current `default_focus_node_id` points at a node they no longer have access to** (grant revoked since last login). The `<select>`'s `value` won't match any option, so the browser will render the first option (— none —) as selected. We leave this alone — re-selecting and saving fixes it.
- **`sentinel_loading === true`.** Reuse the existing loading guard at the top of `AccountSettingsPage`; the section doesn't render until Sentinel boot completes.

---

## Architecture

### Component tree

```
AccountSettingsPage (existing, modified)
├── Profile form
├── HomeLocationSection            ← NEW
│   ├── reads:  useSentinel().sentinel_user, .sentinel_grants, .sentinel_loading
│   ├── action: putFocus() + reducer dispatch
│   └── renders: <h3 eyebrow> + <select> grouped by workspace
├── Password form
├── MFA section
└── Notifications
```

### Backend changes — `/auth/me` carries `default_focus_node_id`

**Why:** Without this, the frontend bridge ([app/sentinel/sentinel_api.ts:116](../../../app/sentinel/sentinel_api.ts#L116)) keeps hardcoding `default_focus_node_id: null`, so the dropdown shows blank after a refresh even though the column is correctly populated server-side.

**Files:**
- [backend/internal/roletypes/models.go](../../../backend/internal/roletypes/models.go) — add `DefaultFocusNodeID *uuid.UUID json:"default_focus_node_id,omitempty"` to `User` struct.
- [backend/internal/auth/sql.go](../../../backend/internal/auth/sql.go) — add `default_focus_node_id` to the SELECT lists for `sqlSelectUserByEmail`, `sqlSelectUserByID`, `sqlSelectUserBySessionID`, `sqlSelectServiceUserForSubscription` (4 constants).
- [backend/internal/auth/service.go](../../../backend/internal/auth/service.go) — add `&u.DefaultFocusNodeID,` to the corresponding `Scan(...)` tuples in `FindUserByEmail` (line 188), `FindUserByID` (line 206), `FindServiceUserForSubscription` (line 229), `FindUserBySessionID` (line 264).
- [backend/internal/auth/handler.go](../../../backend/internal/auth/handler.go) — add `DefaultFocusNodeID *uuid.UUID json:"default_focus_node_id,omitempty"` to `userPayload`; populate from `u.DefaultFocusNodeID` in `buildUserPayload`.

**No new SQL constant needed** — we're extending existing SELECT lists, not adding new queries.

**No test changes needed** in this layer — existing `auth.handler_test.go` patterns don't assert payload shape beyond what's already pinned; the new field is additive.

### Frontend changes — bridge + reducer + UI

#### `AuthMeResp` type ([app/sentinel/sentinel_api.ts](../../../app/sentinel/sentinel_api.ts))

Add `default_focus_node_id?: string | null` to the type. Replace the hardcoded `null` at line 116 with `me.default_focus_node_id ?? null`.

#### Reducer ([app/sentinel/SentinelProvider.tsx](../../../app/sentinel/SentinelProvider.tsx))

Add a new action `SET_USER_DEFAULT_FOCUS` (or extend an existing user-update action if one exists) that takes `nodeId: string | null` and updates `state.user.default_focus_node_id` immutably. Wire it into `sentinel_set_focus` and a new helper `sentinel_set_default_focus(nodeId)` if needed — TBD during implementation; the action method is what the component calls.

**Action method name on the hook.** Currently `sentinel_set_focus(nodeId)` writes the active focus AND persists it server-side. The persistence behaviour was the gap closed by commit `19df4e33`. We do NOT need a separate `sentinel_set_default_focus()` — `sentinel_set_focus()` already does the right thing. The reducer just needs to ALSO update `state.user.default_focus_node_id` on the optimistic path so the dropdown's `value=` prop reflects the new selection.

#### `HomeLocationSection` component ([app/components/HomeLocationSection.tsx](../../../app/components/HomeLocationSection.tsx))

New file, ~80 LOC.

```tsx
"use client";

import { useState, useMemo } from "react";
import { useSentinel } from "@/app/sentinel";
import { notify } from "@/app/lib/toast";
import { byPosition, walkTopology } from "@/app/lib/shared/topology/walker";
import type { SentinelGrant } from "@/app/sentinel/types";

// Returns the same flattened-tree rows ScopeGroupPanel uses, so the
// option order + indent matches the user's mental model from the scope
// rail. The em-space indent conveys depth without needing a tree
// widget — appropriate for the typical user with < 20 nodes.
function flatten(grants: readonly SentinelGrant[]) {
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
    label: r.node.grant.label_override?.trim() || r.node.grant.name || r.node.grant.node_id,
  }));
}

export default function HomeLocationSection() {
  const { sentinel_user: user, sentinel_grants: grants, sentinel_set_focus } = useSentinel();
  const [busy, setBusy] = useState(false);

  // Group by workspace_id, preserve original walker order within each group.
  const grouped = useMemo(() => {
    const flat = flatten(grants);
    const byWs = new Map<string, { workspaceName: string; rows: typeof flat }>();
    for (const r of flat) {
      const wsId = r.grant.workspace_id ?? "";
      if (!byWs.has(wsId)) {
        // Workspace name = label of the depth-0 grant for that workspace.
        const wsRoot = flat.find((x) => x.grant.workspace_id === wsId && x.depth === 0);
        byWs.set(wsId, { workspaceName: wsRoot?.label ?? "Workspace", rows: [] });
      }
      byWs.get(wsId)!.rows.push(r);
    }
    return Array.from(byWs.entries())
      .sort(([, a], [, b]) => a.workspaceName.localeCompare(b.workspaceName, undefined, { sensitivity: "base" }));
  }, [grants]);

  const currentValue = user?.default_focus_node_id ?? "";

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value || null;
    setBusy(true);
    try {
      await sentinel_set_focus(next); // already optimistic + server PUT
      notify.success("Home location saved");
    } catch (err) {
      // Reducer rollback happens inside sentinel_set_focus on failure.
      const isForbidden = /* ApiError 403 check */;
      if (isForbidden) {
        notify.error("You no longer have access to that node.");
      } else {
        notify.error("Could not save home location. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  if (grouped.length === 0) {
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
      <div className="form u-mb-8">
        <div className="form__row">
          <label className="form__label">
            Where do you want Vector to land you when you sign in?
            <select
              className="form__input"
              value={currentValue}
              onChange={onChange}
              disabled={busy}
            >
              <option value="">— (none — use workspace root) —</option>
              {grouped.map(([wsId, { workspaceName, rows }]) => (
                <optgroup key={wsId} label={workspaceName}>
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
      </div>
    </>
  );
}
```

The exact `sentinel_set_focus` semantics (does it already optimistically update `user.default_focus_node_id`? does it roll back on failure?) will be verified during implementation. If `sentinel_set_focus` only updates `sentinel_focus_node` and not `sentinel_user.default_focus_node_id`, the reducer needs a one-line change.

---

## Testing

### Backend
- `go test ./internal/auth/...` — existing tests must still pass after the SELECT-list changes. Adding a column to a SELECT can break field-tuple Scan() calls if any are missed; the build will catch this.
- `go test ./internal/sentinel/...` — should be unchanged (the new field doesn't affect any sentinel code paths).
- `go build ./...` — final safety net.

### Frontend
- New test case in [app/sentinel/__tests__/sentinel_provider.test.tsx](../../../app/sentinel/__tests__/sentinel_provider.test.tsx) — **Case 12: `sentinel_set_focus()` optimistically updates `user.default_focus_node_id`.**
  - Setup: boot with `user.default_focus_node_id = null`.
  - Act: call `sentinel_set_focus("new-node-id")`.
  - Assert: state.user.default_focus_node_id is "new-node-id" before the fetch mock resolves.
  - Assert: server `PUT /sentinel/focus` was called with `{ focus_node_id: "new-node-id" }`.
  - Variant 12b: server returns 500 → state.user.default_focus_node_id reverts to null.
- `tsc --noEmit` for the new component.
- No new e2e — `sentinel.unit` Case 4b already pins the focus-precedence behaviour the dropdown depends on.

### Manual smoke (acceptance)
1. Sign in as `user@mmffdev.com`. Navigate to /user/account-settings.
2. Pick a node from the Home Location dropdown. Toast appears. Refresh — dropdown still shows that node.
3. Sign out. Sign back in. Browser lands on that node (URL shows `?meg=<that-uuid>`, scope rail highlights it).
4. Pick "— (none — use workspace root) —". Toast appears. Sign out + back in. Browser lands at tenant root.
5. Confirm in psql: `SELECT default_focus_node_id FROM users WHERE email = 'user@mmffdev.com';` matches expectation at each step.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Adding a column to 4 SELECTs is easy to mess up — miss one and the build breaks silently at a different call site. | The Scan() tuple is positional; missing the field is a compile error, not a runtime one. The build catches every case. |
| `sentinel_set_focus` might already do the right thing on `user.default_focus_node_id` — in which case the reducer change is a no-op. | Read the existing reducer first; only add the update if it's actually missing. |
| Old sessions with a JWT minted before this change won't carry `default_focus_node_id` until they refresh. | Acceptable — `default_focus_node_id` is read from the DB on every `/auth/me` call, not from the JWT itself. No JWT rotation needed. |
| User picks a node, then an admin revokes their grant. Next login lands them at tenant root (server-side `DefaultFocus` returns the stored uuid → middleware `ResolveSubtree` returns `ErrFocusNoAccess` → 403). | Need to verify middleware behaviour here. **TODO during implementation:** if the middleware 403's on a stored-but-now-invalid default, the user gets a hard-fail page; better behaviour is to log-and-fall-back. Open question — confirm with code-read. |

---

## Open questions resolved during brainstorming

| Question | Answer |
|---|---|
| Flat select vs tree picker vs combobox? | **Flat select with optgroup per workspace** + em-space indent for depth. |
| Save-on-change vs explicit Save button vs bundle into Profile? | **Save-on-change, optimistic** — matches the Notifications toggle pattern at the bottom of the same page. |
| Add `default_focus_node_id` to `/auth/me` now or as a follow-up? | **Now, in the same change.** Otherwise the dropdown shows stale state across refreshes. |
| Section placement? | **Between Profile and Password** — keeps preferences grouped at the top. |
| Section label? | **"Home Location"** — most everyday-readable. |
| Touch all 4 SELECTs or refactor first? | **Touch all 4** — refactoring SELECT lists into a helper is a separate concern. |

---

## Out of scope (deferred)

- Scope direction defaults (`sentinel_scope_up_default`, `sentinel_scope_down_default` columns on the users table from migration 243). Separate story.
- Tree-shaped picker / typeahead combobox. Revisit if users with 50+ nodes appear.
- Admin-set-other-user's-home. Different threat model + RBAC story.
- Migration. The column already exists.
