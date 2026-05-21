"use client";

// <TimeboxObjectTree> — V2 surface for sprints + releases.
//
// Slice 6.3c of the ObjectTree refactor (2026-05-21). Composes
// ObjectTreeV2 primitives (DenseGridHeader, ActionBar with the
// `bulk` variant, ObjectTreeBulkCreateSheet, ObjectTreeDetailFlyout +
// TimeboxInlineForm) into a single page-level surface for timebox
// grids. Replaces the legacy <TimeboxManager> on the sprints +
// releases pages.
//
// HONEST SCOPE: this is a sibling to ObjectTreeV2's p_ObjectTree.tsx,
// not a parameterisation of it. The "central" V2 component is still
// heavily work-items-shaped (flow states, artefact types, parent
// cascade) — pushing sprints through it would require either gutting
// it or accepting a thicket of dead branches. A sibling is honest:
// "ObjectTreeV2 is a primitives toolkit + a work-items reference
// composition; new domains pick the primitives they need." When
// p_ObjectTree.tsx and TimeboxObjectTree drift far enough that
// sharing real estate becomes painful, we converge — not now.
//
// Bulk-create is TIMEBOXES-ONLY (see context/MEMORY.md ## Active
// Threads). The bulk sheet shell lives in V2 but its only consumer
// is this component.

import React, { useCallback, useMemo, useState } from "react";
import Panel from "@/app/components/Panel";
import Table, { Column, PillVariant } from "@/app/components/Table";
import { apiSite, ApiError } from "@/app/lib/api";
import { notify } from "@/app/lib/toast";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import { DenseGridHeader } from "@/app/components/ObjectTreeV2/kinds/DenseGridHeader";
import { ActionBar } from "@/app/components/ObjectTreeV2/kinds/ActionBar";
import ObjectTreeBulkCreateSheet, {
  type BulkCreateConfig,
} from "@/app/components/ObjectTreeV2/sheets/ObjectTreeBulkCreateSheet";
import { ObjectTreeDetailFlyout } from "@/app/components/ObjectTreeV2/flyouts/ObjectTreeDetailFlyout";
import TimeboxInlineForm from "@/app/components/TimeboxInlineForm";

// ── Kind config (intentionally inline — see component header) ──────────────

type Kind = "sprint" | "release";

interface KindCfg {
  apiBase: string;
  rowPrefix: string;
  namePrefix: string;
  listKey: "sprints" | "releases";
}

const KIND_CFG: Record<Kind, KindCfg> = {
  sprint: {
    apiBase: "/timeboxes/sprints",
    rowPrefix: "timeboxes_sprints",
    namePrefix: "Sprint",
    listKey: "sprints",
  },
  release: {
    apiBase: "/timeboxes/releases",
    rowPrefix: "timeboxes_releases",
    namePrefix: "Release",
    listKey: "releases",
  },
};

// ── Bulk-create config factory ─────────────────────────────────────────────

function buildBulkConfig(kind: Kind): BulkCreateConfig {
  const cfg = KIND_CFG[kind];
  const p = cfg.rowPrefix;
  return {
    label: `Create ${cfg.namePrefix}s`,
    endpoint: `${cfg.apiBase}/bulk-create`,
    listKey: cfg.listKey,
    namePattern: `${cfg.namePrefix} {n}`,
    namePrefixField: `${p}_name`,
    defaultCount: 1,
    maxCount: 52,
    rules: {
      cascadeStartFromPrevEnd: true,
      deriveEndFromCadence: true,
    },
    columns: [
      {
        key: "suffix",
        wireKey: `${p}_suffix`,
        label: "Suffix (optional)",
        type: "text",
        optional: true,
        placeholder: "e.g. Red Cherry",
      },
      {
        key: "date_start",
        wireKey: `${p}_date_start`,
        label: "Start",
        type: "date",
        lockAfterFirst: true,
      },
      {
        key: "cadence_days",
        wireKey: `${p}_cadence_days`,
        label: "Cadence (days)",
        type: "number",
        default: 14,
      },
      {
        key: "date_end",
        wireKey: `${p}_date_end`,
        label: "End (derived)",
        type: "derived",
        derivedFrom: ["date_start", "cadence_days"],
      },
      {
        key: "velocity",
        wireKey: `${p}_velocity`,
        label: "Velocity",
        type: "number",
        optional: true,
        width: 80,
      },
    ],
  };
}

// ── Types ──────────────────────────────────────────────────────────────────

type TimeboxRow = Record<string, unknown>;

export interface TimeboxObjectTreeProps {
  kind: Kind;
  workspaceId: string;
  orgNodeId?: string;
  /** Optional page title — defaults to "Sprints" / "Releases". */
  title?: string;
  /** Optional subtitle in the dense-grid header. */
  subtitle?: string;
  /** Optional addressable name (overrides default). */
  addressableName?: string;
}

// ── Status pill ────────────────────────────────────────────────────────────

function statusVariant(status: string): PillVariant {
  switch (status) {
    case "active":
      return "success";
    case "completed":
      return "neutral";
    default:
      return "info";
  }
}

// ── Implementation ─────────────────────────────────────────────────────────

function TimeboxObjectTreeInner({
  kind,
  workspaceId,
  orgNodeId,
  title,
  subtitle,
}: TimeboxObjectTreeProps) {
  const cfg = KIND_CFG[kind];
  const p = cfg.rowPrefix;
  const headingTitle = title ?? `${cfg.namePrefix}s`;

  // Data state — flat list (sprints are small; no windowing yet)
  const [rows, setRows] = useState<TimeboxRow[] | null>(null);
  const [search, setSearch] = useState("");
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [singleOpen, setSingleOpen] = useState(false);

  // Slice 7 — passes ?org_node_id= so the backend's slice-5B
  // ancestor-walk fires; the response stamps origin / from_node_id /
  // from_node_name on each row when the user is viewing a child node
  // of a propagated sprint/release.
  const reload = useCallback(async () => {
    if (!workspaceId) return;
    const params = new URLSearchParams({ workspace_id: workspaceId });
    if (orgNodeId) params.set("org_node_id", orgNodeId);
    try {
      const data = await apiSite<{ items: TimeboxRow[]; total: number }>(
        `${cfg.apiBase}?${params.toString()}`,
      );
      setRows(data.items ?? []);
    } catch (e) {
      notify.apiError(e as ApiError, `Failed to load ${kind}s`);
      setRows([]);
    }
  }, [cfg.apiBase, kind, workspaceId, orgNodeId]);

  // Initial load
  React.useEffect(() => {
    void reload();
  }, [reload]);

  // Filtered rows (search by name + suffix)
  const filteredRows = useMemo(() => {
    if (!rows) return null;
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const name = String(r[`${p}_name`] ?? "").toLowerCase();
      const suffix = String(r[`${p}_suffix`] ?? "").toLowerCase();
      return name.includes(needle) || suffix.includes(needle);
    });
  }, [rows, search, p]);

  // Next sequence number for namePattern
  const nextNumber = (rows?.length ?? 0) + 1;
  const lastEndDate = useMemo(() => {
    if (!rows?.length) return "";
    const sorted = [...rows].sort((a, b) =>
      String(b[`${p}_date_end`]).localeCompare(String(a[`${p}_date_end`])),
    );
    return String(sorted[0][`${p}_date_end`] ?? "");
  }, [rows, p]);

  // Columns
  const columns: Column<TimeboxRow>[] = [
    {
      key: `${p}_name`,
      header: "Name",
      kind: "custom",
      render: (r) => {
        const suffix = r[`${p}_suffix`] as string | null;
        const name = String(r[`${p}_name`] ?? "");
        // Slice 7 — inherited-row treatment. The button label sits
        // italic + muted so it visually reads as "this row didn't
        // originate here"; the small badge underneath names the
        // pinned source. Click behaviour is unchanged — opens the
        // flyout, which shows the read-only banner.
        const origin = String(r.origin ?? "local");
        const isInherited = origin === "inherited";
        const fromNodeName = (r.from_node_name as string | null) ?? null;
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <button
              type="button"
              data-objecttree-flyout-trigger="1"
              className="link-button"
              style={{
                background: "none",
                border: 0,
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
                color: isInherited
                  ? "var(--ink-muted)"
                  : "var(--brand-action)",
                fontStyle: isInherited ? "italic" : "normal",
                textDecoration: "underline",
              }}
              onClick={(e) => {
                e.stopPropagation();
                const id = String(r[`${p}_id`] ?? "");
                setOpenRowId((cur) => (cur === id ? null : id));
              }}
            >
              {name}
              {suffix && (
                <span style={{ color: "var(--ink-subtle)" }}> ({suffix})</span>
              )}
            </button>
            {isInherited && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--ink-subtle)",
                  fontStyle: "italic",
                }}
                title={`Inherited from ${fromNodeName ?? "a parent node"}`}
              >
                ↑ from {fromNodeName ?? "parent"}
              </span>
            )}
          </div>
        );
      },
    },
    { key: `${p}_date_start`, header: "Start", kind: "mono" },
    { key: `${p}_date_end`, header: "End", kind: "mono" },
    { key: `${p}_cadence_days`, header: "Cadence (days)", kind: "numeric" },
    {
      key: `${p}_status`,
      header: "Status",
      kind: "pill",
      pillVariant: (r) => statusVariant(String(r[`${p}_status`] ?? "")),
      pillLabel: (r) => String(r[`${p}_status`] ?? ""),
    },
    {
      key: `${p}_scope`,
      header: "Scope",
      kind: "numeric",
      render: (r) => String(r[`${p}_scope`] ?? "—"),
    },
    {
      key: `${p}_velocity`,
      header: "Velocity",
      kind: "numeric",
      render: (r) => String(r[`${p}_velocity`] ?? "—"),
    },
  ];

  // Bulk submit
  const bulkConfig = useMemo(() => buildBulkConfig(kind), [kind]);
  const handleBulkSubmit = useCallback(
    async (payloadRows: Array<Record<string, unknown>>) => {
      try {
        await apiSite(
          `${cfg.apiBase}/bulk-create?workspace_id=${workspaceId}`,
          {
            method: "POST",
            body: JSON.stringify({ [bulkConfig.listKey]: payloadRows }),
          },
        );
        notify.success(
          `Created ${payloadRows.length} ${cfg.namePrefix}${
            payloadRows.length === 1 ? "" : "s"
          }`,
        );
        setBulkOpen(false);
        void reload();
      } catch (e) {
        notify.apiError(e as ApiError, `Failed to bulk-create ${kind}s`);
      }
    },
    [cfg.apiBase, cfg.namePrefix, workspaceId, kind, bulkConfig.listKey, reload],
  );

  // Single create — placeholder that opens an empty inline form (rowId="new")
  // is messy because TimeboxInlineForm expects a real id. Simplest: a tiny
  // inline form right here for single create. But to keep slice 6.3c
  // tight, the single button just opens the bulk sheet with count=1 for
  // now; the dedicated single-create flow lands later if Rick wants the
  // pattern split. (Decision recorded in handover doc.)
  //
  // Wiring "Create one" → opens bulk sheet with defaultCount 1 (the
  // existing default). Same form, just preselected for one row.
  const handleSingleClick = useCallback(() => {
    setSingleOpen(true);
    setBulkOpen(true);
  }, []);

  const handleBulkClick = useCallback(() => {
    setSingleOpen(false);
    setBulkOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setBulkOpen(false);
    setSingleOpen(false);
  }, []);

  // Detail flyout body — TimeboxInlineForm uses additional props passed
  // via bodyProps. The Body component prop spreads them through.
  const TimeboxBody = useCallback(
    (props: React.ComponentProps<typeof TimeboxInlineForm>) => (
      <TimeboxInlineForm {...props} />
    ),
    [],
  );

  // After save in flyout, optimistically merge the patch into local row
  const handleSaved = useCallback(
    (patch: Record<string, unknown>) => {
      if (!openRowId || !rows) return;
      setRows(
        rows.map((r) =>
          String(r[`${p}_id`]) === openRowId ? { ...r, ...patch } : r,
        ),
      );
    },
    [openRowId, rows, p],
  );

  return (
    <Panel name={`timebox_v2_${kind}_list`} title={headingTitle}>
      <DenseGridHeader
        badge="V2"
        subtitle={subtitle ?? `${cfg.namePrefix} grid`}
        description={`Create, manage and transition ${kind}s for the active workspace scope.`}
      />
      <ActionBar
        ariaLabel={`${cfg.namePrefix} actions`}
        createAction={[
          {
            mode: "single",
            label: `Create ${cfg.namePrefix}`,
            onCreate: handleSingleClick,
          },
          {
            mode: "bulk",
            label: `Create ${cfg.namePrefix}s`,
            onCreate: handleBulkClick,
          },
        ]}
        search={{
          placeholder: `Search ${cfg.namePrefix.toLowerCase()}s…`,
          value: search,
          onChange: setSearch,
        }}
      />

      {bulkOpen && (
        <ObjectTreeBulkCreateSheet
          config={
            singleOpen
              ? { ...bulkConfig, defaultCount: 1, maxCount: 1 }
              : bulkConfig
          }
          payloadContext={{
            [`${p}_id_topology_node`]: orgNodeId ?? null,
          }}
          nextNumber={nextNumber}
          startAnchor={lastEndDate}
          onSubmit={handleBulkSubmit}
          onCancel={closeSheet}
        />
      )}

      <Table<TimeboxRow>
        pageId={`timebox_v2_${kind}`}
        slot="list"
        ariaLabel={`${cfg.namePrefix} list`}
        columns={columns}
        rows={filteredRows ?? []}
        rowKey={(r) => String(r[`${p}_id`])}
        loading={rows === null}
        empty={`No ${kind}s found.`}
      />

      <ObjectTreeDetailFlyout
        openId={openRowId}
        Body={TimeboxBody}
        bodyProps={{
          kind,
          workspaceId,
          orgNodeId,
        }}
        onClose={() => setOpenRowId(null)}
        onSaved={handleSaved}
      />
    </Panel>
  );
}

// ── Samantha addressable wrapper ───────────────────────────────────────────

export default function TimeboxObjectTree(props: TimeboxObjectTreeProps) {
  const { address, Provider } = useRegisterAddressable({
    kind: "timebox",
    name: props.addressableName ?? `${props.kind}-v2`,
  });
  return (
    <Provider>
      <div data-address={address}>
        <TimeboxObjectTreeInner {...props} />
      </div>
    </Provider>
  );
}
