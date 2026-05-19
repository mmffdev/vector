"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table, { type Column } from "@/app/components/Table";
import { PrimaryCellTreeLines } from "@/app/components/ResourceTree";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePageAccess } from "@/app/contexts/PageAccessContext";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { apiSite } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import PageAccessDenied from "@/app/components/PageAccessDenied";

// Page-permissions matrix (PLA-0049). Rows = system pages, columns =
// editable system + tenant roles (everything except grp_global, which
// has universal access enforced server-side, and grp_external which
// is an archetype hidden from the grid).
//
// Save model: instant per-cell PUT/DELETE, plus an atomic bucket-row
// tri-state checkbox at each header that flips every child page in
// that bucket via PUT /admin/page-grants/bucket/{tag_enum}/{role_id}.
//
// Avatar bucket (tag_enum='avatar_menu') is filtered out of the grid
// entirely. The server enforces an avatar floor — every role keeps
// avatar pages forever, server returns 409 ResourceLocked on any
// attempt to revoke an avatar page.

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
  tag_enum: string;
  page?: PageGrantRow;
  /** For header rows: the page_ids of all child pages in this bucket. */
  child_page_ids?: string[];
  /** For page rows: true when this is the final page in its bucket
   * (drives <PrimaryCellTreeLines> elbow vs T-junction). */
  isLastInBucket?: boolean;
}

const EXCLUDED_ROLE_CODES = new Set(["grp_global", "grp_external"]);
const HIDDEN_BUCKET_TAG = "avatar_menu";

type TriState = "all" | "none" | "mixed";

function bucketState(children: PageGrantRow[], roleID: string): TriState {
  let on = 0;
  for (const c of children) if (c.role_ids.includes(roleID)) on += 1;
  if (on === 0) return "none";
  if (on === children.length) return "all";
  return "mixed";
}

export default function PermissionsPage() {
  const { full } = usePageTitle();
  const { user, role } = useAuth();

  const isGadmin = role?.code === "grp_global";
  const access = usePageAccess("um-permissions");

  const [rows, setRows] = useState<PageGrantRow[] | null>(null);
  const [allRoles, setAllRoles] = useState<RoleRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user) return;
    if (access.loading) return;
    if (!access.allowed) return; // PageAccessDenied handles the UI
  }, [user, access.loading, access.allowed]);

  const refresh = useCallback(async () => {
    try {
      const [grants, roles] = await Promise.all([
        apiSite<PageGrantsResp>("/admin/page-grants"),
        apiSite<RoleRow[]>("/roles"),
      ]);
      // Hide avatar bucket entirely — server enforces the floor.
      setRows(grants.pages.filter((p) => p.tag_enum !== HIDDEN_BUCKET_TAG));
      setAllRoles(roles);
    } catch (err) {
      notify.apiError(err, "Failed to load page grants.");
      setRows([]);
      setAllRoles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isGadmin) return;
    if (!access.allowed) return;
    void refresh();
  }, [isGadmin, access.allowed, refresh]);

  const editableRoles = useMemo<RoleRow[]>(() => {
    if (!allRoles) return [];
    const filtered = allRoles.filter((r) => !EXCLUDED_ROLE_CODES.has(r.code));
    return [...filtered].sort((a, b) => {
      if (a.is_system !== b.is_system) return a.is_system ? -1 : 1;
      return b.rank - a.rank;
    });
  }, [allRoles]);

  // Group rows by bucket for the header-row computation.
  const rowsByBucket = useMemo<Map<string, PageGrantRow[]>>(() => {
    const out = new Map<string, PageGrantRow[]>();
    if (!rows) return out;
    for (const p of rows) {
      const arr = out.get(p.tag_enum) ?? [];
      arr.push(p);
      out.set(p.tag_enum, arr);
    }
    return out;
  }, [rows]);

  // Per-cell toggle (single page × single role).
  const onToggle = useCallback(
    async (pageId: string, roleID: string, nextChecked: boolean) => {
      const cellKey = `${pageId}:${roleID}`;
      setBusy((s) => new Set(s).add(cellKey));
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

  // Bucket-row toggle (every page in tag_enum × single role).
  const onBucketToggle = useCallback(
    async (tagEnum: string, roleID: string, nextChecked: boolean) => {
      const cellKey = `bucket:${tagEnum}:${roleID}`;
      setBusy((s) => new Set(s).add(cellKey));
      // Optimistic: flip every child page in the bucket.
      const flip = (rs: PageGrantRow[] | null, on: boolean) =>
        rs?.map((r) =>
          r.tag_enum === tagEnum
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
        const path = `/admin/page-grants/bucket/${encodeURIComponent(tagEnum)}/${encodeURIComponent(roleID)}`;
        await apiSite<void>(path, {
          method: "PUT",
          body: JSON.stringify({ checked: nextChecked }),
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        // Revert and re-fetch authoritative state.
        notify.apiError(err, "Bucket toggle failed.");
        await refresh();
      } finally {
        setBusy((s) => {
          const n = new Set(s);
          n.delete(cellKey);
          return n;
        });
      }
    },
    [refresh],
  );

  // Flatten rows into header + page rows for the Table. isLastInBucket
  // is computed against the rowsByBucket map so the SVG branch glyphs
  // render an elbow on the final child of each bucket.
  const flat = useMemo<FlatRow[]>(() => {
    if (!rows) return [];
    const out: FlatRow[] = [];
    let lastBucket = "";
    for (const p of rows) {
      if (p.bucket_label !== lastBucket) {
        const children = rowsByBucket.get(p.tag_enum) ?? [];
        out.push({
          kind: "header",
          key: `h:${p.tag_enum}`,
          bucket_label: p.bucket_label,
          tag_enum: p.tag_enum,
          child_page_ids: children.map((c) => c.page_id),
        });
        lastBucket = p.bucket_label;
      }
      const bucketPages = rowsByBucket.get(p.tag_enum) ?? [];
      const isLast = bucketPages[bucketPages.length - 1]?.page_id === p.page_id;
      out.push({
        kind: "page",
        key: `p:${p.page_id}`,
        bucket_label: p.bucket_label,
        tag_enum: p.tag_enum,
        page: p,
        isLastInBucket: isLast,
      });
    }
    return out;
  }, [rows, rowsByBucket]);

  const columns: Column<FlatRow>[] = useMemo(
    () => [
      {
        key: "page",
        header: "Page",
        kind: "custom",
        render: (r) => {
          if (r.kind === "header") return r.bucket_label;
          return (
            <span className="permissions__page-cell">
              <PrimaryCellTreeLines
                depth={1}
                isLast={r.isLastInBucket ?? false}
                hasVisibleChildren={false}
                continuations={[false]}
              />
              <span>{r.page!.label}</span>
            </span>
          );
        },
      },
      ...editableRoles.map<Column<FlatRow>>((roleRow) => ({
        key: roleRow.id,
        header: roleRow.label,
        width: 140,
        kind: "center",
        render: (r) => {
          if (r.kind === "header") {
            const children = rowsByBucket.get(r.tag_enum) ?? [];
            const state = bucketState(children, roleRow.id);
            const cellKey = `bucket:${r.tag_enum}:${roleRow.id}`;
            return (
              <BucketCheckbox
                state={state}
                disabled={busy.has(cellKey)}
                onClick={(next) => onBucketToggle(r.tag_enum, roleRow.id, next)}
                ariaLabel={`${roleRow.label} access to all ${r.bucket_label} pages`}
              />
            );
          }
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
    [editableRoles, rowsByBucket, busy, onToggle, onBucketToggle],
  );

  if (!user) return null;
  if (access.allowed === false) return <PageAccessDenied pageLabel="Page Permissions" />;

  const pageCount = rows?.length ?? 0;

  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle="Grant or revoke page access for each role across the workspace."
      />
      <PageDescription>
        Tick a cell to grant a role access to a page. Bucket-row checkboxes toggle every page in the bucket at once. Saves on click.
      </PageDescription>

      <Panel
        name="panel_page_permissions_grid"
        className="page-panel-heading"
        title="Page permissions"
        description="Tick a cell to grant a role access to that page. Bucket-row checkboxes toggle every page in the bucket. Saves on click. Global Admin has universal access and is not shown; External is an archetype hidden from the grid; avatar pages (Personal Settings, Navigation, Themes) are a locked floor for every role."
      >
        <Table<FlatRow>
          pageId="user-management-permissions"
          slot="page-grants-grid"
          ariaLabel="Page permissions grid"
          columns={columns}
          rows={flat}
          rowKey={(r) => r.key}
          rowClassName={(r) =>
            r.kind === "header" ? "tree_accordion-dense__row--group" : undefined
          }
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

// BucketCheckbox: tri-state native checkbox. State cycles
// indeterminate → all-on → all-off on click. Uses the imperative
// `indeterminate` DOM property because React doesn't expose it via JSX.
function BucketCheckbox({
  state,
  disabled,
  onClick,
  ariaLabel,
}: {
  state: TriState;
  disabled: boolean;
  onClick: (nextChecked: boolean) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={state === "all"}
      disabled={disabled}
      onChange={() => {
        // Cycle: mixed/none → on, on → off.
        const nextChecked = state !== "all";
        onClick(nextChecked);
      }}
      aria-label={ariaLabel}
    />
  );
}
