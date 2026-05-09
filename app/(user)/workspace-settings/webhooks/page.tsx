"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Table from "@/app/components/Table";
import UnsavedChangesBar from "@/app/components/UnsavedChangesBar";
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
  const params = useParams();
  const workspaceId = Array.isArray(params.workspace_id) ? params.workspace_id[0] : params.workspace_id;

  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  useEffect(() => {
    fetchWebhooks();
  }, [workspaceId]);

  const fetchWebhooks = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/workspaces/${workspaceId}/webhooks`);
      if (!res.ok) throw new Error("Failed to fetch webhooks");
      const data = await res.json();
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
    if (!confirm("Delete this webhook?")) return;
    try {
      const res = await fetch(`/api/v2/workspaces/${workspaceId}/webhooks/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete webhook");
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
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Webhooks</h2>
          <p className="text-sm text-neutral-600">Manage webhook subscriptions for work item and sprint events</p>
        </div>
        <button className="btn btn--primary" onClick={handleCreate}>
          New Webhook
        </button>
      </div>

      {showForm && (
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
  );
}
