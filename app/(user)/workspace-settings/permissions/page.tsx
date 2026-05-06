"use client";

import Table from "@/app/components/Table";

type AdminUserRole = string;

const CAPABILITIES: Array<{ key: string; label: string }> = [
  { key: "read",           label: "Read content" },
  { key: "comment",        label: "Comment" },
  { key: "create",         label: "Create items" },
  { key: "edit_own",       label: "Edit own items" },
  { key: "edit_any",       label: "Edit any item" },
  { key: "publish",        label: "Publish releases" },
  { key: "manage_users",   label: "Manage users" },
  { key: "manage_billing", label: "Manage billing" },
];

const ROLES: AdminUserRole[] = ["user", "padmin", "gadmin"];

const DEFAULT_GRID: Record<AdminUserRole, Record<string, boolean>> = {
  user:   { read: true,  comment: true,  create: true,  edit_own: true,  edit_any: false, publish: false, manage_users: false, manage_billing: false },
  padmin: { read: true,  comment: true,  create: true,  edit_own: true,  edit_any: true,  publish: true,  manage_users: false, manage_billing: false },
  gadmin: { read: true,  comment: true,  create: true,  edit_own: true,  edit_any: true,  publish: true,  manage_users: true,  manage_billing: true  },
};

export default function PermissionsPage() {
  const columns = [
    { key: "label", header: "Capability", width: 220 },
    ...ROLES.map((role) => ({
      key: role,
      header: role,
      width: 120,
      kind: "pill" as const,
      pillVariant: (row: { key: string }) =>
        (DEFAULT_GRID[role][row.key] ? "success" : "neutral") as "success" | "neutral",
      pillLabel: (row: { key: string }) => (DEFAULT_GRID[role][row.key] ? "Allow" : "Deny"),
    })),
  ];

  return (
    <Table<{ key: string; label: string }>
      pageId="workspace-settings"
      slot="permissions"
      ariaLabel="Permissions"
      columns={columns}
      rows={CAPABILITIES}
      rowKey={(r) => r.key}
      toolbar={{
        meta: `${CAPABILITIES.length} capabilities × ${ROLES.length} roles`,
        actions: (
          <button type="button" className="btn btn--primary" disabled>
            Save changes
          </button>
        ),
      }}
    />
  );
}
