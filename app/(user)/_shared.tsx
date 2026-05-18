"use client";

import { useEffect } from "react";

// Shared Modal component used by workspaces and users tabs.
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h2 className="modal__title">{title}</h2>
          <button onClick={onClose} className="btn btn--icon btn--ghost modal__close" aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}

// AdminUser DTO returned by /api/admin/users
export type AdminUserRole = string;

export interface AdminUser {
  id: string;
  subscription_id: string;
  email: string;
  role: AdminUserRole;
  is_active: boolean;
  first_name: string | null;
  last_name: string | null;
  department: string | null;
  last_login: string | null;
  force_password_change: boolean;
  created_at: string;
}

export interface RoleSummary {
  id: string;
  code: string;
  label: string;
  is_external: boolean;
  is_system: boolean;
  rank: number;
}
