"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MdOutlineEdit } from "react-icons/md";
import PageContent from "@/app/components/PageContent";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import PageHeading from "@/app/components/PageHeading";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import { useAuth, useHasPermission } from "@/app/contexts/AuthContext";
import { ApiError } from "@/app/lib/api";
import { workspacesApi, emitWorkspacesChanged, type Workspace } from "@/app/lib/workspacesApi";
import { Modal } from "../../_shared";

function ArchivedWorkspacesSection({
  rows,
  err,
  canRestore,
  onRestore,
}: {
  rows: Workspace[] | null;
  err: string | null;
  canRestore: boolean;
  onRestore: (id: string) => Promise<void>;
}) {
  return (
    <>
      <h3 className="eyebrow">Archived workspaces</h3>
      {err && <div className="form__error">{err}</div>}
      {rows && (
        <Table<Workspace>
          pageId="workspace-settings"
          slot="archived_workspaces"
          ariaLabel="Archived workspaces"
          rows={rows}
          rowKey={(w) => w.id}
          empty="No archived workspaces."
          columns={[
            { key: "name", header: "Name" },
            { key: "slug", header: "Slug", width: 200, kind: "mono" },
            {
              key: "archived",
              header: "Archived",
              width: 140,
              kind: "custom",
              render: (w) =>
                w.archived_at ? new Date(w.archived_at).toLocaleDateString() : "—",
            },
            {
              key: "actions",
              header: "",
              width: 160,
              kind: "custom",
              render: (w) => (
                <ArchivedWorkspaceActionsCell
                  w={w}
                  canRestore={canRestore}
                  onRestore={() => onRestore(w.id)}
                />
              ),
            },
          ]}
        />
      )}
    </>
  );
}

function ArchivedWorkspaceActionsCell({
  w,
  canRestore,
  onRestore,
}: {
  w: Workspace;
  canRestore: boolean;
  onRestore: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!canRestore) return null;

  async function restore() {
    if (!confirm(`Restore workspace "${w.name}" to the live list?`)) return;
    setErr(null);
    setBusy(true);
    try {
      await onRestore();
    } catch (e) {
      setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="u-row u-row--gap-2">
      <button
        type="button"
        className="btn btn--secondary btn--sm"
        onClick={restore}
        disabled={busy}
      >
        {busy ? "Restoring…" : "Restore"}
      </button>
      {err && <span className="form__error">{err}</span>}
    </div>
  );
}

function WorkspaceNameCell({
  w,
  isEditing,
  onCancelEdit,
  onRename,
}: {
  w: Workspace;
  isEditing: boolean;
  canArchive: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(w.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setName(w.name);
      setErr(null);
    }
  }, [isEditing, w.name]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === w.name) {
      onCancelEdit();
      return;
    }
    setErr(null);
    setBusy(true);
    try {
      await onRename(trimmed);
    } catch (e) {
      setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Rename failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isEditing) return <span>{w.name}</span>;
  return (
    <div className="u-row u-row--gap-2">
      <input
        type="text"
        className="form__input form__input--sm"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
        }}
      />
      <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onCancelEdit} disabled={busy}>
        Cancel
      </button>
      {err && <span className="form__error">{err}</span>}
    </div>
  );
}

function WorkspaceActionsCell({
  w,
  isEditing,
  canArchive,
  onStartEdit,
  onArchive,
}: {
  w: Workspace;
  isEditing: boolean;
  canArchive: boolean;
  onStartEdit: () => void;
  onArchive: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function archive() {
    if (!confirm(`Archive workspace "${w.name}"?`)) return;
    setBusy(true);
    try {
      await onArchive();
    } catch (e) {
      setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Archive failed");
    } finally {
      setBusy(false);
    }
  }

  if (isEditing) return null;
  return (
    <div className="u-row u-row--gap-2">
      <button
        type="button"
        className="btn btn--icon btn--ghost btn--sm"
        aria-label="Rename workspace"
        title="Rename workspace"
        onClick={onStartEdit}
      >
        <MdOutlineEdit size={14} />
      </button>
      {canArchive && (
        <button type="button" className="btn btn--danger btn--sm" onClick={archive} disabled={busy}>
          {busy ? "Archiving…" : "Archive"}
        </button>
      )}
      {err && <span className="form__error">{err}</span>}
    </div>
  );
}

function CreateWorkspaceModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const desc = description.trim();
      await workspacesApi.create({
        name: name.trim(),
        slug: slug.trim(),
        ...(desc ? { description: desc } : {}),
      });
      emitWorkspacesChanged();
      onCreated();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const body = e.body as { error?: string } | string | undefined;
        const code = typeof body === "object" && body ? body.error : undefined;
        setErr(code === "slug_taken"
          ? "A live workspace already uses that slug. Pick a different slug."
          : `Conflict: ${String(body ?? "")}`);
      } else {
        setErr(e instanceof ApiError ? String(e.body ?? `Error ${e.status}`) : "Create failed");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title="New workspace">
      <form onSubmit={onSubmit} className="form">
        <label className="form__label">
          Name
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="form__input"
            autoFocus
          />
        </label>
        <label className="form__label">
          Slug
          <input
            type="text"
            required
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="form__input t-mono"
            pattern="[a-z0-9][a-z0-9-]*"
            title="Lowercase letters, numbers, and hyphens; must start with a letter or number."
          />
          <span className="form__hint">Lowercase letters, numbers, hyphens. Must be unique among live workspaces.</span>
        </label>
        <label className="form__label">
          Description
          <textarea
            className="form__input form__textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {err && <div className="form__error">{err}</div>}
        <div className="modal__actions">
          <button type="button" onClick={onClose} className="btn btn--secondary" disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim() || !slug.trim()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function WorkspacesPage() {
  const { full } = usePageTitle();
  const { user } = useAuth();
  const canAccess = useHasPermission("workspace.archive");
  const router = useRouter();

  useEffect(() => {
    if (user && !canAccess) router.replace("/workspace-settings");
  }, [user, canAccess, router]);

  if (!user || !canAccess) return null;

  const canArchive      = useHasPermission("workspace.archive");
  const canViewArchived = useHasPermission("workspace.view_archived");
  const canRestore      = useHasPermission("workspace.restore");

  const [rows, setRows]               = useState<Workspace[] | null>(null);
  const [archivedRows, setArchivedRows] = useState<Workspace[] | null>(null);
  const [err, setErr]                 = useState<string | null>(null);
  const [archivedErr, setArchivedErr] = useState<string | null>(null);
  const [showCreate, setShowCreate]   = useState(false);
  const [editingId, setEditingId]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const data = await workspacesApi.list();
      setRows(data);
    } catch (e) {
      setErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load");
    }
  }, []);

  const loadArchived = useCallback(async () => {
    if (!canViewArchived) return;
    setArchivedErr(null);
    try {
      const data = await workspacesApi.listArchived();
      setArchivedRows(data);
    } catch (e) {
      setArchivedErr(e instanceof ApiError ? `Error ${e.status}: ${String(e.body ?? "")}` : "Failed to load archived workspaces");
    }
  }, [canViewArchived]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadArchived(); }, [loadArchived]);

  async function renameWorkspace(id: string, name: string) {
    await workspacesApi.rename(id, name);
    emitWorkspacesChanged();
    setEditingId(null);
    await load();
  }

  async function archiveWorkspace(id: string) {
    await workspacesApi.archive(id);
    emitWorkspacesChanged();
    await Promise.all([load(), loadArchived()]);
  }

  async function restoreWorkspace(id: string) {
    await workspacesApi.restore(id);
    emitWorkspacesChanged();
    await Promise.all([load(), loadArchived()]);
  }

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Create and manage workspaces within this tenant." />
      <Panel
        name="panel_workspaces_header"
        className="page-panel-heading"
        title="Workspaces"
        description="Create new workspaces, rename existing ones, and manage archived workspaces."
      />
    <div>
      <div className="toolbar">
        <div className="toolbar__meta">
          {rows ? `${rows.length} workspace${rows.length === 1 ? "" : "s"}` : "Loading…"}
        </div>
        <button onClick={() => setShowCreate(true)} className="btn btn--primary">
          + New workspace
        </button>
      </div>

      {err && <div className="form__error">{err}</div>}

      <Table<Workspace>
        pageId="workspace-settings"
        slot="workspaces"
        ariaLabel="Workspaces"
        rows={rows}
        rowKey={(w) => w.id}
        loading={!rows}
        empty='No live workspaces. Use "+ New workspace" to create one.'
        columns={[
          {
            key: "name",
            header: "Name",
            kind: "custom",
            render: (w) => (
              <WorkspaceNameCell
                w={w}
                isEditing={editingId === w.id}
                canArchive={canArchive}
                onStartEdit={() => setEditingId(w.id)}
                onCancelEdit={() => setEditingId(null)}
                onRename={(name) => renameWorkspace(w.id, name)}
              />
            ),
          },
          { key: "slug", header: "Slug", width: 200, kind: "mono" },
          {
            key: "created",
            header: "Created",
            width: 140,
            kind: "custom",
            render: (w) => new Date(w.created_at).toLocaleDateString(),
          },
          {
            key: "actions",
            header: "",
            width: 200,
            kind: "custom",
            render: (w) => (
              <WorkspaceActionsCell
                w={w}
                isEditing={editingId === w.id}
                canArchive={canArchive}
                onStartEdit={() => setEditingId(w.id)}
                onArchive={() => archiveWorkspace(w.id)}
              />
            ),
          },
        ]}
      />

      {canViewArchived && (
        <ArchivedWorkspacesSection
          rows={archivedRows}
          err={archivedErr}
          canRestore={canRestore}
          onRestore={restoreWorkspace}
        />
      )}

      {showCreate && (
        <CreateWorkspaceModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
    </PageContent>
  );
}
