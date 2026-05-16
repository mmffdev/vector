"use client";

// PLA-0046 / story 00555 — Topology Permissions page. Gadmin-only
// surface for editing another user's topology node grants. Hosts the
// controlled <UserNodeAssignment> checkbox tree; the page owns the
// fetch lifecycle, optimistic mutation, and refetch-on-grant so the
// grant_id needed for revoke flows is always current.
//
// Persistence model: each checkbox toggle hits the topology service
// directly — grant via POST /topology/nodes/:id/roles, revoke via
// DELETE /topology/roles/:grant_id. On grant we refetch the grants
// list so the new grant_id is bound to the node before the user can
// flip it off again. On any error we revert the optimistic mutation
// and surface an inline message (no window.alert — see MEMORY rule
// feedback_no_browser_alerts).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import UserNodeAssignment from "@/app/components/topology/UserNodeAssignment";
import { useHasPermission } from "@/app/contexts/AuthContext";
import { apiSite, ApiError } from "@/app/lib/api";
import { topologyApi, listGrantsByUser, type MyGrant, type OrgNode } from "@/app/lib/topologyApi";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import type { AdminUser } from "@/app/(user)/workspace-settings/_shared";

export default function TopologyPermissionsPage() {
  const { full } = usePageTitle();
  const params = useParams<{ userId: string }>();
  const userId = params?.userId ?? "";
  const canManageGrants = useHasPermission("topology.grants.manage_others");

  const [user, setUser]               = useState<AdminUser | null>(null);
  const [tree, setTree]               = useState<OrgNode[] | null>(null);
  const [grants, setGrants]           = useState<MyGrant[] | null>(null);
  const [collapsed, setCollapsed]     = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr]         = useState<string | null>(null);
  const [mutationErr, setMutationErr] = useState<string | null>(null);

  // Selected set is derived purely from `grants` so optimistic updates
  // touch a single source of truth — flip the grants list, the
  // selection follows. Keeps revoke (which needs grant_id) and select
  // (which needs node_id) on the same ledger.
  const selectedNodeIds = useMemo<Set<string>>(
    () => new Set((grants ?? []).map((g) => g.node_id)),
    [grants],
  );

  const reloadGrants = useCallback(async () => {
    if (!userId) return;
    const next = await listGrantsByUser(userId);
    setGrants(next);
  }, [userId]);

  useEffect(() => {
    if (!userId || !canManageGrants) return;
    let cancelled = false;
    setLoadErr(null);

    Promise.all([
      apiSite<AdminUser[]>("/admin/users"),
      topologyApi.tree(),
      listGrantsByUser(userId),
    ])
      .then(([users, treeRows, grantRows]) => {
        if (cancelled) return;
        setUser(users.find((u) => u.id === userId) ?? null);
        setTree(treeRows);
        setGrants(grantRows);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadErr(
          err instanceof ApiError
            ? `Error ${err.status}: ${String(err.body ?? "")}`
            : err instanceof Error
              ? err.message
              : "Failed to load topology permissions.",
        );
      });

    return () => { cancelled = true; };
  }, [userId, canManageGrants]);

  const handleToggle = useCallback(
    async (nodeId: string, nextSelected: boolean) => {
      if (!userId) return;
      setMutationErr(null);
      const prevGrants = grants ?? [];

      if (nextSelected) {
        // GRANT: optimistically synth a placeholder row so the checkbox
        // ticks immediately. After the server call resolves we refetch
        // so the real grant_id binds to the node — required because
        // revoke needs grant_id, not node_id.
        const placeholder: MyGrant = {
          grant_id: `optimistic-${nodeId}`,
          node_id: nodeId,
          workspace_id: "",
          parent_id: null,
          name: "",
          label_override: null,
          colour: null,
          icon: null,
          role: "admin",
          granted_at: new Date().toISOString(),
          position: 0,
        };
        setGrants([...prevGrants, placeholder]);
        try {
          await topologyApi.grantRole(nodeId, userId, "admin", false);
          await reloadGrants();
        } catch (err) {
          setGrants(prevGrants);
          setMutationErr(
            err instanceof ApiError
              ? `Grant failed (Error ${err.status}): ${String(err.body ?? "")}`
              : "Grant failed.",
          );
        }
        return;
      }

      // REVOKE: find the grant_id for this node from current state.
      const target = prevGrants.find((g) => g.node_id === nodeId);
      if (!target) {
        setMutationErr("Cannot revoke — no matching grant on record.");
        return;
      }
      setGrants(prevGrants.filter((g) => g.node_id !== nodeId));
      try {
        await topologyApi.revokeRole(target.grant_id);
      } catch (err) {
        setGrants(prevGrants);
        setMutationErr(
          err instanceof ApiError
            ? `Revoke failed (Error ${err.status}): ${String(err.body ?? "")}`
            : "Revoke failed.",
        );
      }
    },
    [grants, userId, reloadGrants],
  );

  const handleToggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Forbidden — do NOT redirect; render an in-page panel so the user
  // can read why they landed here (typical case: deep-linked from
  // someone else's session).
  if (!canManageGrants) {
    return (
      <PageContent>
        <PageDescription title="Topology Permissions">
          <p className="form__hint">Forbidden — you do not have permission to manage topology grants for other users.</p>
        </PageDescription>
      </PageContent>
    );
  }

  const headerTitle = user
    ? `Topology Permissions — ${[user.first_name, user.last_name].filter(Boolean).join(" ") || user.email}`
    : "Topology Permissions";

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage topology access grants for this user." />
      <Panel
        name="panel_topology_permissions_header"
        className="page-panel-heading"
        title="Topology Permissions"
        description="View and manage the organisation topology nodes this user has been granted access to."
      />
      <PageDescription title={headerTitle}>
        <p className="form__hint">
          Tick a node to grant this user admin rights on it. Untick to revoke. Changes save immediately.
        </p>
      </PageDescription>

      {loadErr && <div className="form__error">{loadErr}</div>}
      {mutationErr && <div className="form__error">{mutationErr}</div>}

      <Panel name="topology_permissions_picker" title="Node grants">
        {tree && grants ? (
          <UserNodeAssignment
            tree={tree}
            selectedNodeIds={selectedNodeIds}
            onToggle={handleToggle}
            collapsed={collapsed}
            onToggleCollapsed={handleToggleCollapsed}
          />
        ) : (
          !loadErr && <p className="form__hint">Loading topology…</p>
        )}
      </Panel>
    </PageContent>
  );
}
