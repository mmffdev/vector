"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ResourceTree,
  PrimaryCellTreeLines,
  PrimaryCellExpander,
  type ColumnDef,
  type RenderCtx,
} from "@/app/components/ResourceTree";
import { ITEM_TYPES, CORE_FIELDS } from "@/app/lib/work-item-types";
// Type lifted from the retired CustomFieldManager.tsx (deleted 2026-05-19,
// dead code — no importers remained after the v2 PoC delete). The same
// shape is returned by /api/dev/artefact-types/{id}/fields.
export interface ArtefactTypeBinding {
  id: string;
  field_library_id: string;
  field_name: string;
  label: string;
  field_type: string;
  options_json: unknown;
  position: number;
  required: boolean;
  default_value: string | null;
}

// ─── Row types ────────────────────────────────────────────────────────────────

type FieldRow =
  | { kind: "type";    id: string; typeKey: string; label: string; prefix: string; fieldCount: number; childTotal: number }
  | { kind: "field";   id: string; parentId: string; name: string; label: string; fieldType: string; source: string; note?: string; core: boolean; treatAsLast?: boolean }
  | { kind: "section"; id: string; parentId: string; label: string }
  | { kind: "empty";   id: string; parentId: string }
  | { kind: "action";  id: string; parentId: string; typeKey: string };

// ─── BFF helper ───────────────────────────────────────────────────────────────

const ITEM_TYPE_TO_PREFIX: Record<string, string> = {
  epic: "EP", story: "US", defect: "DE", task: "TA", risk: "RSK",
};

async function bff<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

interface ArtefactTypeRemote {
  id: string; prefix: string; name: string;
}

// ─── Columns ──────────────────────────────────────────────────────────────────

const columns: ColumnDef<FieldRow>[] = [
  {
    key: "field",
    label: "Field",
    width: null,
    minWidth: 160,
    render: (row, ctx: RenderCtx<FieldRow>) => {
      if (row.kind === "section") {
        return <span className="cf-tree__section-label">{row.label}</span>;
      }
      if (row.kind === "empty") {
        return <span className="form__hint cf-tree__empty-hint">No custom fields.</span>;
      }
      if (row.kind === "action") {
        return null;
      }
      return (
        <span className="tree_accordion-dense__summary">
          <PrimaryCellTreeLines
            depth={ctx.depth}
            isLast={row.kind === "field" && row.treatAsLast ? true : ctx.isLast}
            hasVisibleChildren={ctx.hasVisibleChildren}
            continuations={ctx.continuations}
          />
          <PrimaryCellExpander
            expanded={ctx.expanded}
            hasChildren={ctx.hasChildren}
            onToggle={ctx.toggle}
          />
          {row.kind === "type" ? (
            <span className="cf-tree__type-label">
              <span className="cf-type-heading__prefix">{row.prefix}</span>
              <span>{row.label}</span>
            </span>
          ) : (
            <span>{row.label}</span>
          )}
        </span>
      );
    },
  },
  {
    key: "slug",
    label: "Slug",
    width: 200,
    render: (row) => {
      if (row.kind !== "field") return null;
      return <code className="form__hint">{row.name}</code>;
    },
  },
  {
    key: "type",
    label: "Type",
    width: 100,
    render: (row) => {
      if (row.kind === "type") return <span className="form__hint">{row.fieldCount} field{row.fieldCount !== 1 ? "s" : ""}</span>;
      if (row.kind === "section" || row.kind === "empty" || row.kind === "action") return null;
      return <span className={`pill pill--neutral pill--sm${row.core ? " pill--muted" : ""}`}>{row.fieldType}</span>;
    },
  },
  {
    key: "source",
    label: "Source",
    width: 240,
    render: (row) => {
      if (row.kind === "type" || row.kind === "section" || row.kind === "empty" || row.kind === "action") return null;
      return <span className="form__hint">{row.source}</span>;
    },
  },
  {
    key: "note",
    label: "Note",
    width: 180,
    render: (row) => {
      if (row.kind === "action") {
        return (
          <button className="btn btn--sm btn--secondary" type="button" onClick={() => console.log("add custom field", row.typeKey)}>
            + Add Custom Field
          </button>
        );
      }
      if (row.kind === "type" || row.kind === "section" || row.kind === "empty") return null;
      if (row.kind === "field" && !row.note) return null;
      return <span className="form__hint">{(row as Extract<FieldRow, {kind:"field"}>).note}</span>;
    },
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function CustomFieldsTree() {
  const [roots, setRoots] = useState<FieldRow[]>([]);
  const [childMap, setChildMap] = useState<Map<string, FieldRow[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const newChildMap = new Map<string, FieldRow[]>();

        // Build roots and core children first — always available
        const newRoots: FieldRow[] = ITEM_TYPES.map((t) => {
          const id = `type-${t.key}`;
          const coreChildren: FieldRow[] = CORE_FIELDS.map((f, i) => ({
            kind: "field",
            id: `${id}-core-${i}`,
            parentId: id,
            name: f.name,
            label: f.label,
            fieldType: f.type,
            source: f.source,
            note: f.note,
            core: true,
          }));
          newChildMap.set(id, coreChildren);
          return { kind: "type", id, typeKey: t.key, label: t.label, prefix: t.prefix, fieldCount: coreChildren.length, childTotal: coreChildren.length } as FieldRow;
        });

        // Try to load custom bindings; silently skip if API unavailable
        let remoteTypes: ArtefactTypeRemote[] = [];
        try {
          const typesRes = await bff<{ items: ArtefactTypeRemote[] }>("/api/dev/artefact-types");
          remoteTypes = typesRes.items;
        } catch { /* API not yet available — core fields only */ }

        const bindingResults = await Promise.allSettled(
          ITEM_TYPES.map(async (t) => {
            const prefix = ITEM_TYPE_TO_PREFIX[t.key];
            const match = remoteTypes.find((r) => r.prefix === prefix);
            if (!match) return { key: t.key, bindings: [] as ArtefactTypeBinding[] };
            const res = await bff<{ items: ArtefactTypeBinding[] }>(`/api/dev/artefact-types/${match.id}/fields`);
            return { key: t.key, bindings: res.items };
          })
        );

        const finalRoots = newRoots.map((root) => {
          const t = ITEM_TYPES.find((x) => `type-${x.key}` === root.id)!;
          const result = bindingResults.find((r) => r.status === "fulfilled" && r.value.key === t.key);
          const bindings = result?.status === "fulfilled" ? result.value.bindings : [];
          const customChildren: FieldRow[] = bindings
            .sort((a, b) => a.position - b.position)
            .map((b) => ({
              kind: "field",
              id: `${root.id}-custom-${b.id}`,
              parentId: root.id,
              name: b.field_name,
              label: b.field_name.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
              fieldType: b.field_type,
              source: "custom field",
              note: b.required ? "required" : undefined,
              core: false,
            }));
          const existingCore = newChildMap.get(root.id) ?? [];
          // Mark the last real field before the section so it draws an elbow (└─)
          // rather than a T (├─). The section/empty/action rows that follow should
          // not influence the preceding field row's isLast calculation in ResourceTree.
          const lastFieldIdx = customChildren.length > 0
            ? -1  // last custom child gets treatAsLast
            : existingCore.length - 1;
          const markedCore = existingCore.map((r, i) =>
            r.kind === "field" && i === lastFieldIdx && customChildren.length === 0
              ? { ...r, treatAsLast: true }
              : r
          ) as FieldRow[];
          const markedCustom = customChildren.map((r, i) =>
            i === customChildren.length - 1 ? { ...r, treatAsLast: true } : r
          ) as FieldRow[];
          const sectionRow: FieldRow = { kind: "section", id: `${root.id}-section-custom`, parentId: root.id, label: "Custom Fields" };
          const emptyRow: FieldRow = { kind: "empty", id: `${root.id}-empty`, parentId: root.id };
          const actionRow: FieldRow = { kind: "action", id: `${root.id}-action-add`, parentId: root.id, typeKey: t.key };
          const customSection = customChildren.length === 0 ? [emptyRow] : markedCustom;
          const allChildren = [...markedCore, sectionRow, ...customSection, actionRow];
          newChildMap.set(root.id, allChildren);
          const actualFieldCount = existingCore.length + customChildren.length;
          return { ...root, fieldCount: actualFieldCount, childTotal: allChildren.length } as FieldRow;
        });

        if (!cancelled) {
          setRoots(finalRoots);
          setChildMap(newChildMap);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load fields.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchChildren = useCallback(async (parentId: string): Promise<FieldRow[]> => {
    return childMap.get(parentId) ?? [];
  }, [childMap]);

  const patch = useCallback(async (_id: string, _body: Record<string, unknown>): Promise<FieldRow> => {
    throw new Error("Fields are read-only in this view.");
  }, []);

  if (error) {
    return <p className="form__error">{error}</p>;
  }

  const totalFields = [...childMap.values()].flat().filter(r => r.kind === "field").length;

  return (
    <>
      <header className="tree_accordion-dense__panel-head">
        <span className="tree_accordion-dense__panel-head-num">{totalFields}</span>
        <div className="tree_accordion-dense__panel-head-body">
          <h3 className="tree_accordion-dense__panel-head-title">Field registry</h3>
          <p className="tree_accordion-dense__panel-head-subtitle">
            Core fields are system-managed and read-only. Custom fields are workspace-specific.
          </p>
        </div>
      </header>
      <div className="cf-tree__wrap">
      <ResourceTree<FieldRow>
        roots={roots}
        total={roots.length}
        getId={(r) => r.id}
        getParentId={(r) => (r.kind === "field" || r.kind === "section" || r.kind === "empty" || r.kind === "action") ? r.parentId : null}
        getChildrenCount={(r) => r.kind === "type" ? r.childTotal : 0}
        getRowClass={(r) => {
          if (r.kind === "section") return "tree_accordion-dense__row--group";
          if (r.kind === "action") return "cf-tree__row--action";
          return undefined;
        }}
        fetchChildren={fetchChildren}
        patch={patch}
        columns={columns}
        loading={loading}
        ariaLabel="Custom fields by artefact type"
        name="customfieldstree"
      />
      </div>
    </>
  );
}
