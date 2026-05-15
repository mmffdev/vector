"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table, { type Column } from "@/app/components/Table";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { apiSite } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";

// Page-permissions matrix (PLA-0049). Rows = system pages, columns =
// editable system + tenant roles (everything except grp_global, which
// has universal access enforced server-side, and grp_external which
// is an archetype hidden from the grid).
//
// Save model: instant. Each toggle fires a PUT or DELETE against the
// per-cell endpoint; UI flips optimistically and reverts on error.

interface RoleRow {
  id: string;
  code: string;
  label: string;
  rank: number;
  is_system: boolean;
  is_external: boolean;
}

interface PageGrantRow {
  page_id: string;
  key_enum: string;
  label: string;
  href: string;
  tag_enum: string;
  bucket_label: string;
  bucket_order: number;
  default_order: number;
  role_ids: string[];
}

interface PageGrantsResp {
  pages: PageGrantRow[];
}

interface FlatRow {
  kind: "header" | "page";
  key: string;
  bucket_label: string;
  page?: PageGrantRow;
}

// Roles excluded from the grid as columns. grp_global has universal
// access (cannot be revoked); grp_external is an archetype template,
// not directly assignable.
const EXCLUDED_ROLE_CODES = new Set(["grp_global", "grp_external"]);

export default function PermissionsPage() {
  const { full } = usePageTitle();
  const { user, role } = useAuth();
  const router = useRouter();

  const isGadmin = role?.code === "grp_global";

  const [rows, setRows] = useState<PageGrantRow[] | null>(null);
  const [allRoles, setAllRoles] = useState<RoleRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (user && !isGadmin) router.replace("/user-management");
  }, [user, isGadmin, router]);

  useEffect(() => {
    if (!isGadmin) return;
    let cancelled = false;
    (async () => {
      try {
        const [grants, roles] = await Promise.all([
          apiSite<PageGrantsResp>("/admin/page-grants"),
          apiSite<RoleRow[]>("/roles"),
        ]);
        if (!cancelled) {
          setRows(grants.pages);
          setAllRoles(roles);
        }
      } catch (err) {
        if (!cancelled) {
          notify.apiError(err, "Failed to load page grants.");
          setRows([]);
          setAllRoles([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isGadmin]);

  // Editable role columns: every role except grp_global (universal) and
  // grp_external (archetype). Sorted system-block-rank-desc, then
  // tenant-block-rank-desc.
  const editableRoles = useMemo<RoleRow[]>(() => {
    if (!allRoles) return [];
    const filtered = allRoles.filter((r) => !EXCLUDED_ROLE_CODES.has(r.code));
    return [...filtered].sort((a, b) => {
      if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
      return b.rank - a.rank;
    });
  }, [allRoles]);

  const onToggle = useCallback(
    async (pageId: string, roleID: string, nextChecked: boolean) => {
      const cellKey = `${pageId}:${roleID}`;
      setBusy((s) => {
        const n = new Set(s);
        n.add(cellKey);
        return n;
      });
      const flip = (rs: PageGrantRow[] | null, on: boolean) =>
        rs?.map((r) =>
          r.page_id === pageId
            ? {
                ...r,
                role_ids: on
                  ? Array.from(new Set([...r.role_ids, roleID])).sort()
                  : r.role_ids.filter((x) => x !== roleID),
              }
            : r,
        ) ?? rs;
      setRows((prev) => flip(prev, nextChecked));
      try {
        const path = `/admin/page-grants/${encodeURIComponent(pageId)}/${encodeURIComponent(roleID)}`;
        await apiSite<void>(path, { method: nextChecked ? "PUT" : "DELETE" });
      } catch (err) {
        setRows((prev) => flip(prev, !nextChecked));
        notify.apiError(err, "Save failed.");
      } finally {
        setBusy((s) => {
          const n = new Set(s);
          n.delete(cellKey);
          return n;
        });
      }
    },
    [],
  );

  // Flatten rows with header pseudo-rows per nav bucket so the grid
  // can be scanned by section.
  const flat = useMemo<FlatRow[]>(() => {
    if (!rows) return [];
    const out: FlatRow[] = [];
    let lastBucket = "";
    for (const p of rows) {
      if (p.bucket_label !== lastBucket) {
        out.push({ kind: "header", key: `h:${p.bucket_label}`, bucket_label: p.bucket_label });
        lastBucket = p.bucket_label;
      }
      out.push({ kind: "page", key: `p:${p.page_id}`, bucket_label: p.bucket_label, page: p });
    }
    return out;
  }, [rows]);

  const columns: Column<FlatRow>[] = useMemo(
    () => [
      {
        key: "page",
        header: "Page",
        kind: "custom",
        render: (r) => {
          if (r.kind === "header") return <strong>{r.bucket_label}</strong>;
          const p = r.page!;
          return <span>{p.label}</span>;
        },
      },
      ...editableRoles.map<Column<FlatRow>>((roleRow) => ({
        key: roleRow.id,
        header: roleRow.label,
        width: 140,
        kind: "center",
        render: (r) => {
          if (r.kind !== "page") return null;
          const p = r.page!;
          const checked = (p.role_ids ?? []).includes(roleRow.id);
          const cellKey = `${p.page_id}:${roleRow.id}`;
          return (
            <input
              type="checkbox"
              checked={checked}
              disabled={busy.has(cellKey)}
              onChange={(e) => onToggle(p.page_id, roleRow.id, e.target.checked)}
              aria-label={`${roleRow.label} access to ${p.label}`}
            />
          );
        },
      })),
    ],
    [editableRoles, busy, onToggle],
  );

  if (!user) return null;
  if (!isGadmin) return null;

  const pageCount = rows?.length ?? 0;

  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle="Grant or revoke page access for each role across the workspace."
      />

      <Panel
        name="panel_page_permissions_grid"
        className="page-panel-heading"
        title="Page permissions"
        description="Tick a cell to grant a role access to that page. Saves on click. Global Admin has universal access and is not shown; External is an archetype hidden from the grid."
      >
        <Table<FlatRow>
          pageId="user-management-permissions"
          slot="page-grants-grid"
          ariaLabel="Page permissions grid"
          columns={columns}
          rows={flat}
          rowKey={(r) => r.key}
          loading={loading}
          empty="No system pages found."
          noScroll
          toolbar={{
            meta: `${pageCount} pages × ${editableRoles.length} roles`,
          }}
        />
      </Panel>
    </PageContent>
  );
}
