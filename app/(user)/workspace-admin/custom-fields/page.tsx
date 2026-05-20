"use client";

// Custom Fields list — workspace-admin surface for the global field
// library. Despite the historic /workspace-admin/ URL, the *library*
// itself spans the whole product: fields attach to artefacts today,
// and to sprints / releases / milestones / etc. as those features
// land. This page manages the catalogue; bindings live elsewhere.
//
// Scope rules (server-enforced — see fields/handler.go):
//   • Workspace-scope rows  → editable by workspace admin OR tenant admin
//   • Tenant-scope rows     → editable by tenant admin only
//   • Global rows           → read-only here (vector_admin owns them)
//
// The page lists fields grouped by scope (two Tables), and routes
// create/edit through a dedicated /custom-fields/[id] page rather
// than a modal — fields carry options_json + config_json that deserve
// the screen real estate.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import PageContent from "@/app/components/PageContent";
import PageDescription from "@/app/components/PageDescription";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { ApiError } from "@/app/lib/api";
import {
  archiveWorkspaceField,
  getWorkspaceFields,
  type WorkspaceField,
} from "@/app/lib/fieldsApi";

export default function CustomFieldsPage() {
  const { full } = usePageTitle();
  const router = useRouter();
  const activeWorkspaceId = useActiveWorkspace();

  const [rows, setRows] = useState<WorkspaceField[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setErr(null);
    try {
      const data = await getWorkspaceFields(activeWorkspaceId);
      setRows(data);
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? `Error ${e.status}: ${String(e.body ?? "")}`
          : "Failed to load custom fields.",
      );
      setRows([]);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const { tenantFields, workspaceFields, globalFields } = useMemo(() => {
    const out = {
      tenantFields: [] as WorkspaceField[],
      workspaceFields: [] as WorkspaceField[],
      globalFields: [] as WorkspaceField[],
    };
    for (const r of rows ?? []) {
      if (r.scope === "tenant") out.tenantFields.push(r);
      else if (r.scope === "workspace") out.workspaceFields.push(r);
      else out.globalFields.push(r);
    }
    return out;
  }, [rows]);

  async function onArchive(id: string, label: string) {
    if (!activeWorkspaceId) return;
    if (
      !confirm(
        `Archive the “${label}” field? Existing values stay attached to their artefacts; the field disappears from new pickers.`,
      )
    ) {
      return;
    }
    setErr(null);
    setInfo(null);
    try {
      await archiveWorkspaceField(activeWorkspaceId, id);
      setInfo("Field archived.");
      await load();
    } catch (e) {
      setErr(
        e instanceof ApiError
          ? `Error ${e.status}: ${String(e.body ?? "")}`
          : "Archive failed.",
      );
    }
  }

  const columns = (scope: "tenant" | "workspace" | "global") =>
    [
      {
        key: "label" as const,
        header: "Label",
        kind: "custom" as const,
        render: (r: WorkspaceField) => r.label,
      },
      {
        key: "name" as const,
        header: "Name",
        width: 220,
        kind: "custom" as const,
        render: (r: WorkspaceField) => <code>{r.name}</code>,
      },
      {
        key: "data_type" as const,
        header: "Type",
        width: 140,
        kind: "custom" as const,
        render: (r: WorkspaceField) => r.data_type,
      },
      {
        key: "updated_at" as const,
        header: "Updated",
        width: 180,
        kind: "custom" as const,
        render: (r: WorkspaceField) =>
          new Date(r.updated_at).toLocaleDateString(),
      },
      {
        key: "actions" as const,
        header: "",
        width: 220,
        kind: "custom" as const,
        render: (r: WorkspaceField) =>
          scope === "global" ? (
            <span className="form__hint">Read-only</span>
          ) : (
            <div className="form__actions form__actions-_inline">
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => router.push(`/workspace-admin/custom-fields/${r.id}`)}
              >
                Edit
              </button>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => onArchive(r.id, r.label)}
              >
                Archive
              </button>
            </div>
          ),
      },
    ];

  return (
    <PageContent>
      <PageHeading
        level={1}
        title={full}
        subtitle="Manage the library of custom fields used across artefacts, sprints, releases, and milestones."
      />
      <PageDescription title="Custom Fields">
        <p className="form__hint">
          Custom fields are the reusable property definitions attached to
          objects across the product — artefacts today, with sprints,
          releases and milestones following. Each field has a stable{" "}
          <code>name</code>, a human <code>label</code>, a{" "}
          <code>data_type</code>, and a <em>scope</em>. Workspace-scope
          fields apply only to one workspace; Tenant-scope fields apply
          tenant-wide. Archiving keeps existing values intact but hides
          the field from new pickers. Changing a field’s data type is
          blocked once values exist — archive and recreate instead.
        </p>
      </PageDescription>

      {err && <div className="form__error">{err}</div>}
      {info && <div className="form__info">{info}</div>}

      <Panel
        name="custom_fields_actions"
        title="Create"
      >
        <div className="form__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => router.push("/workspace-admin/custom-fields/new")}
          >
            New custom field
          </button>
        </div>
      </Panel>

      <Panel name="custom_fields_workspace" title="Workspace fields">
        {rows == null ? (
          <p className="form__hint">Loading…</p>
        ) : workspaceFields.length === 0 ? (
          <p className="form__hint">
            No workspace-scope fields yet.
          </p>
        ) : (
          <Table<WorkspaceField>
            pageId="custom-fields"
            slot="workspace"
            ariaLabel="Workspace fields"
            rowKey={(r) => r.id}
            rows={workspaceFields}
            columns={columns("workspace")}
          />
        )}
      </Panel>

      <Panel name="custom_fields_tenant" title="Tenant fields">
        {rows == null ? (
          <p className="form__hint">Loading…</p>
        ) : tenantFields.length === 0 ? (
          <p className="form__hint">
            No tenant-scope fields yet.
          </p>
        ) : (
          <Table<WorkspaceField>
            pageId="custom-fields"
            slot="tenant"
            ariaLabel="Tenant fields"
            rowKey={(r) => r.id}
            rows={tenantFields}
            columns={columns("tenant")}
          />
        )}
      </Panel>

      {globalFields.length > 0 && (
        <Panel name="custom_fields_global" title="Global fields (read-only)">
          <Table<WorkspaceField>
            pageId="custom-fields"
            slot="global"
            ariaLabel="Global fields"
            rowKey={(r) => r.id}
            rows={globalFields}
            columns={columns("global")}
          />
        </Panel>
      )}
    </PageContent>
  );
}
