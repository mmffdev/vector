"use client";

import { useEffect, useState } from "react";
import PageContent from "@/app/components/PageContent";
import PageHeading from "@/app/components/PageHeading";
import Panel from "@/app/components/Panel";
import Table from "@/app/components/Table";
import { usePageTitle } from "@/app/hooks/usePageTitle";
import UnsavedChangesBar from "@/app/components/UnsavedChangesBar";
import { apiSite } from "@/app/lib/api";
import { workspacesApi } from "@/app/lib/workspacesApi";
import WebhookForm from "./WebhookForm";

interface Webhook {
  id: string;
  workspace_id: string;
  url: string;
  events: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function WebhooksPage() {
  const { full } = usePageTitle();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  // Resolve the caller's live workspace. No shared workspace context yet
  // (PLA-0026 follow-up); current convention is first-row of workspacesApi.list().
  useEffect(() => {
    (async () => {
      try {
        const ws = await workspacesApi.list();
        if (ws.length === 0) {
          setError("No workspace available");
          setLoading(false);
          return;
        }
        setWorkspaceId(ws[0].id);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load workspace");
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (workspaceId) fetchWebhooks();
  }, [workspaceId]);

  const fetchWebhooks = async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiSite<{ webhooks?: Webhook[] }>(`/workspaces/${workspaceId}/webhooks`);
      setWebhooks(data.webhooks || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!workspaceId) return;
    if (!confirm("Delete this webhook?")) return;
    try {
      await apiSite(`/workspaces/${workspaceId}/webhooks/${id}`, { method: "DELETE" });
      await fetchWebhooks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  const handleFormSubmit = async () => {
    setShowForm(false);
    setUnsavedChanges(false);
    await fetchWebhooks();
  };

  if (loading) return <div className="p-4">Loading webhooks…</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;

  const columns = [
    { key: "url", label: "URL" },
    { key: "events", label: "Events" },
    { key: "status", label: "Status" },
    { key: "created_at", label: "Created" },
    { key: "actions", label: "Actions" },
  ];

  const rows = webhooks.map((wh) => ({
    id: wh.id,
    url: <code className="text-xs break-all">{wh.url}</code>,
    events: wh.events || "(all events)",
    status: wh.is_active ? <span className="text-green-700 font-medium">Active</span> : <span className="text-neutral-500">Inactive</span>,
    created_at: new Date(wh.created_at).toLocaleDateString(),
    actions: (
      <div className="flex gap-2">
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => handleEdit(wh.id)}
        >
          Edit
        </button>
        <button
          className="btn btn--secondary btn--sm"
          onClick={() => handleDelete(wh.id)}
        >
          Delete
        </button>
      </div>
    ),
  }));

  return (
    <PageContent>
      <PageHeading level={1} title={full} subtitle="Configure webhook endpoints for workspace event notifications." />
      <Panel
        name="panel_webhooks_header"
        className="page-panel-heading"
        title="Webhooks"
        description="Manage webhook endpoints that receive event notifications from this workspace."
      />
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button className="btn btn--primary" onClick={handleCreate}>
            New Webhook
          </button>
        </div>
      </div>

      {showForm && workspaceId && (
        <WebhookForm
          workspaceId={workspaceId}
          webhookId={editingId}
          onSubmit={handleFormSubmit}
          onCancel={() => setShowForm(false)}
        />
      )}

      {webhooks.length > 0 ? (
        <Table columns={columns} rows={rows} />
      ) : (
        <div className="rounded border border-neutral-300 bg-neutral-50 p-6 text-center">
          <p className="text-neutral-600">No webhooks yet. Create one to start receiving events.</p>
        </div>
      )}

      {unsavedChanges && (
        <UnsavedChangesBar onSave={() => {}} onDiscard={() => setUnsavedChanges(false)} />
      )}
    </div>
    </PageContent>
  );
}
