"use client";

import { useEffect, useState } from "react";

interface WebhookFormProps {
  workspaceId: string;
  webhookId: string | null;
  onSubmit: () => void;
  onCancel: () => void;
}

interface FormData {
  url: string;
  events: string | null;
  secret: string;
}

const EVENT_FILTERS = [
  { value: "", label: "All events" },
  { value: "item.created", label: "Item created" },
  { value: "item.updated", label: "Item updated" },
  { value: "item.deleted", label: "Item deleted" },
  { value: "item.status_changed", label: "Item status changed" },
  { value: "sprint.started", label: "Sprint started" },
  { value: "sprint.closed", label: "Sprint closed" },
];

export default function WebhookForm({ workspaceId, webhookId, onSubmit, onCancel }: WebhookFormProps) {
  const [form, setForm] = useState<FormData>({ url: "", events: null, secret: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (webhookId) {
      fetchWebhook();
    }
  }, [webhookId]);

  const fetchWebhook = async () => {
    if (!webhookId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/v2/workspaces/${workspaceId}/webhooks/${webhookId}`);
      if (!res.ok) throw new Error("Failed to fetch webhook");
      const data = await res.json();
      setForm({
        url: data.url,
        events: data.events || null,
        secret: data.secret || "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: keyof FormData, value: string | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const method = webhookId ? "PATCH" : "POST";
      const url = webhookId
        ? `/api/v2/workspaces/${workspaceId}/webhooks/${webhookId}`
        : `/api/v2/workspaces/${workspaceId}/webhooks`;

      const payload: Record<string, any> = {
        url: form.url,
        events: form.events || null,
      };
      if (form.secret) payload.secret = form.secret;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      onSubmit();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-8 rounded border border-neutral-300 bg-neutral-50 p-6">
      <h3 className="mb-6 text-lg font-semibold">{webhookId ? "Edit Webhook" : "New Webhook"}</h3>

      {error && <div className="mb-4 rounded bg-red-100 p-3 text-red-700 text-sm">{error}</div>}

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          URL <span className="text-red-600">*</span>
        </label>
        <input
          type="url"
          className="form-input w-full"
          placeholder="https://example.com/webhook"
          value={form.url}
          onChange={(e) => handleChange("url", e.target.value)}
          required
        />
        <p className="mt-1 text-xs text-neutral-600">The endpoint where events will be delivered (HTTPS required)</p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Event Filter</label>
        <select
          className="form-input w-full"
          value={form.events || ""}
          onChange={(e) => handleChange("events", e.target.value || null)}
        >
          {EVENT_FILTERS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-600">Leave empty to receive all events</p>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium">Secret</label>
          <button
            type="button"
            className="text-xs text-blue-600 hover:underline"
            onClick={() => setShowSecret(!showSecret)}
          >
            {showSecret ? "Hide" : "Show"}
          </button>
        </div>
        <input
          type={showSecret ? "text" : "password"}
          className="form-input w-full"
          placeholder={webhookId ? "Leave blank to keep current secret" : "Auto-generated if left blank"}
          value={form.secret}
          onChange={(e) => handleChange("secret", e.target.value)}
        />
        <p className="mt-1 text-xs text-neutral-600">Used to sign request bodies as HMAC-SHA256 in the X-Vector-Signature header</p>
      </div>

      <div className="flex gap-3">
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? "Saving…" : webhookId ? "Update Webhook" : "Create Webhook"}
        </button>
        <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={loading}>
          Cancel
        </button>
      </div>
    </form>
  );
}
