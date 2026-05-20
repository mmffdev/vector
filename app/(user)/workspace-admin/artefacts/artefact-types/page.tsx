"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";
import InlineEditField from "@/app/components/InlineEditField";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import {
  ResourceTree,
  type ColumnDef,
} from "@/app/components/ResourceTree";
import { notify } from "@/app/lib/toast";
import { ApiError } from "@/app/lib/api";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import {
  artefactTypesApi,
  type ArtefactType,
} from "@/app/lib/artefactTypesApi";
import { safeInk } from "@/app/lib/colourUtils";
import { ColourPicker } from "@/app/components/ColourPicker";

// ── Row union ─────────────────────────────────────────────────────────────────
// All rows are flat roots — no expand/collapse. Scope rows are section dividers.
type ATRow =
  | { kind: "scope"; id: string; label: string }
  | { kind: "type";  id: string; type: ArtefactType };

type PatchFn = (id: string, type: ArtefactType, body: Parameters<typeof artefactTypesApi.patch>[1]) => void;

// ── Columns ───────────────────────────────────────────────────────────────────
function buildColumns(
  onPatch: PatchFn,
  openPickerIdRef: React.RefObject<string | null>,
  setOpenPickerId: (id: string | null) => void,
): ColumnDef<ATRow>[] {
  return [
    {
      key: "tag",
      label: "Tag",
      width: 90,
      render: (row) => {
        if (row.kind === "scope") return null;
        const { type } = row;
        const tagBg = type.colour ?? "var(--surface-sunken)";
        const tagInk = type.colour ? safeInk(type.colour) : "var(--ink-muted)";
        return (
          <span className="at-type-tag" style={{ background: tagBg, color: tagInk }}>
            <InlineEditField
              value={type.prefix}
              onCommit={(next) => {
                const up = next.toUpperCase();
                if (up !== type.prefix) onPatch(type.id, type, { prefix: up });
              }}
              ariaLabel={`Prefix for ${type.name}`}
              clickToEdit
              maxLength={4}
              displayClassName="at-type-tag__text"
              inputClassName="at-type-tag__input"
            />
          </span>
        );
      },
    },
    {
      key: "name",
      label: "Name",
      width: 160,
      render: (row) => {
        if (row.kind === "scope") return <span className="at-tree__scope-label">{row.label}</span>;
        const { type } = row;
        return (
          <InlineEditField
            value={type.name}
            onCommit={(next) => { if (next !== type.name) onPatch(type.id, type, { name: next }); }}
            ariaLabel={`Name for ${type.prefix}`}
            clickToEdit
            maxLength={64}
          />
        );
      },
    },
    {
      key: "description",
      label: "Description",
      width: null,
      render: (row) => {
        if (row.kind === "scope") return null;
        const { type } = row;
        return (
          <InlineEditField
            value={type.description ?? ""}
            onCommit={(next) => {
              const val = next === "—" ? null : next || null;
              if (val !== (type.description ?? null)) onPatch(type.id, type, { description: val });
            }}
            ariaLabel={`Description for ${type.name}`}
            clickToEdit
            emptyDisplay="—"
            maxLength={256}
          />
        );
      },
    },
    {
      key: "colour",
      label: "Colour",
      width: 140,
      stopClick: true,
      render: (row) => {
        if (row.kind === "scope") return null;
        const { type } = row;
        return (
          <ColourPickerCell
            key={type.id}
            type={type}
            open={openPickerIdRef.current === type.id}
            onOpen={() => setOpenPickerId(type.id)}
            onClose={() => setOpenPickerId(null)}
            onPatch={onPatch}
          />
        );
      },
    },
  ];
}

// Controlled wrapper — open state lives in the page, not inside the picker.
function ColourPickerCell({
  type,
  open,
  onOpen,
  onClose,
  onPatch,
}: {
  type: ArtefactType;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPatch: PatchFn;
}) {
  return (
    <ColourPicker
      value={type.colour}
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      onChange={(hex) => onPatch(type.id, type, { colour: hex })}
    />
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ArtefactTypesPage() {
  const { full } = usePageTitle();
  void useActiveWorkspace();

  const [types, setTypes] = useState<ArtefactType[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openPickerId, setOpenPickerId] = useState<string | null>(null);
  const openPickerIdRef = useRef<string | null>(null);
  openPickerIdRef.current = openPickerId;

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await artefactTypesApi.list();
      setTypes(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load artefact types.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onPatch = useCallback(async (
    id: string,
    _current: ArtefactType,
    body: Parameters<typeof artefactTypesApi.patch>[1],
  ) => {
    try {
      const updated = await artefactTypesApi.patch(id, body);
      setTypes((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const msgs = (err.violations ?? []).map((v) => `${v.field}: ${v.message}`).join("; ");
        notify.error(msgs || "Validation failed.");
      } else {
        notify.apiError(err, "Failed to update artefact type.");
      }
    }
  }, []);

  const columns = useMemo(
    () => buildColumns(onPatch, openPickerIdRef, setOpenPickerId),
    // openPickerIdRef is a stable ref — reading .current inside render is fine.
    // setOpenPickerId is stable (from useState). Only rebuild when onPatch changes.
    [onPatch],
  );

  // All rows are flat roots — section dividers + type rows, no expand/collapse.
  const roots = useMemo<ATRow[]>(() => {
    if (!types) return [];
    const workTypes = types.filter((t) => t.scope === "work").sort((a, b) => a.sort_order - b.sort_order);
    const stratTypes = types.filter((t) => t.scope === "strategy").sort((a, b) => a.sort_order - b.sort_order);
    const rows: ATRow[] = [];
    if (workTypes.length > 0) {
      rows.push({ kind: "scope", id: "scope-work", label: "Work types" });
      workTypes.forEach((t) => rows.push({ kind: "type", id: `type-${t.id}`, type: t }));
    }
    if (stratTypes.length > 0) {
      rows.push({ kind: "scope", id: "scope-strategy", label: "Strategy types" });
      stratTypes.forEach((t) => rows.push({ kind: "type", id: `type-${t.id}`, type: t }));
    }
    return rows;
  }, [types]);

  const fetchChildren = useCallback(async (): Promise<ATRow[]> => [], []);

  // patch shim — ResourceTree calls patch(id, body) but our IDs are prefixed "type-<uuid>"
  const patchRow = useCallback(async (rowId: string, body: Record<string, unknown>): Promise<ATRow> => {
    const typeId = rowId.replace(/^type-/, "");
    const updated = await artefactTypesApi.patch(typeId, body as Parameters<typeof artefactTypesApi.patch>[1]);
    setTypes((prev) => prev?.map((t) => (t.id === updated.id ? updated : t)) ?? null);
    return { kind: "type", id: rowId, type: updated };
  }, []);

  if (loadError) {
    return (
      <PageContent>
        <p className="form__error">{loadError}</p>
        <button type="button" className="btn btn--ghost" onClick={load}>Retry</button>
      </PageContent>
    );
  }

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Manage artefact type definitions for the workspace." />
      <Panel
        name="panel_artefact_types_header"
        className="page-panel-heading"
        title="Artefact Types"
        description="Create and manage the artefact type definitions used to categorise items across the workspace."
      />
      <Panel name="panel_artefact_types_tree" title="Types" description="Click any cell to edit inline. Colour changes apply immediately. Prefix must be 1–4 uppercase characters, unique within scope.">
        <div className="at-tree__flat-wrap">
        <ResourceTree<ATRow>
          roots={roots}
          total={roots.length}
          getId={(r) => r.id}
          getParentId={() => null}
          getChildrenCount={() => 0}
          fetchChildren={fetchChildren}
          patch={patchRow}
          columns={columns}
          loading={!types && !loadError}
          ariaLabel="Artefact types"
          name="artefacttypestree"
          getRowClass={(r) => r.kind === "scope" ? "tree_accordion-dense__row--group" : undefined}
        />
        </div>
      </Panel>
    </PageContent>
  );
}
