"use client";

// DebugPanel — dev-only sticky bar between top bar and page content.
// Toggled by clicking the Vector logo in Rail 1 (isDebugOpen in ShellContext).
// Stays mounted across navigation; close button dismisses it.
// Click any value to copy it to clipboard.
// Remove from RedesignShell.tsx before go-live.

import { useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import { useScope } from "@/app/contexts/ScopeContext";
import { useSentinel } from "@/app/contexts/Sentinel";
import { useActiveWorkspace } from "@/app/hooks/useActiveWorkspace";
import { useArtefactTypeCatalogue } from "@/app/contexts/ArtefactTypeCatalogueContext";
import { useShell } from "@/app/redesign/ShellContext";

function CopyValue({ raw }: { raw: string }) {
  const [flash, setFlash] = useState(false);

  const copy = useCallback(() => {
    void navigator.clipboard.writeText(raw).then(() => {
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    });
  }, [raw]);

  return (
    <button
      type="button"
      className={`debug-panel__Row_Value${flash ? " is-copied" : ""}`}
      onClick={copy}
      title={`Click to copy: ${raw}`}
    >
      {flash ? "✓ copied" : raw}
    </button>
  );
}

function Row({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  const str = String(value);
  return (
    <div className={`debug-panel__Row${warn ? " is-warn" : ""}`}>
      <span className="debug-panel__Row_Label">{label}</span>
      <CopyValue raw={str} />
    </div>
  );
}

function Divider({ label }: { label: string }) {
  return <div className="debug-panel__Divider">{label}</div>;
}

export default function DebugPanel() {
  const { closeDebugPanel, activeSectionId, activeSection, isScopeOpen } = useShell();
  const pathname = usePathname() ?? "";
  const { user, loading: authLoading, permissions } = useAuth();
  const { grants, activeNodeId, activeGrant, loading: scopeLoading, error: scopeError } = useScope();
  const sentinel = useSentinel();
  const activeWorkspaceId = useActiveWorkspace();
  const { types, loading: catLoading, error: catError } = useArtefactTypeCatalogue();

  const jwtWorkspaceMatchesScope =
    activeWorkspaceId && activeGrant
      ? activeWorkspaceId === activeGrant.workspace_id
      : null;

  return (
    <div className="debug-panel" role="status" aria-label="Debug panel">
      <div className="debug-panel__Header">
        <span className="debug-panel__Header_Title">⚙ DEV DEBUG — click any value to copy</span>
        <button
          type="button"
          className="debug-panel__Header_Close"
          onClick={closeDebugPanel}
          aria-label="Close debug panel"
        >
          ✕
        </button>
      </div>

      <div className="debug-panel__Body">

        {/* ── Auth / User ────────────────────────────── */}
        <Divider label="AUTH" />
        <Row label="authLoading" value={String(authLoading)} />
        <Row label="user.id" value={user?.id ?? "—"} />
        <Row label="user.email" value={user?.email ?? "—"} />
        <Row label="user.role" value={user?.role?.code ?? "—"} />
        <Row label="user.subscription_id" value={user?.subscription_id ?? "—"} />
        <Row
          label="user.workspace_id (JWT)"
          value={user?.workspace_id || "⚠ empty (legacy token)"}
          warn={!user?.workspace_id}
        />
        <Row label="auth.permissions count" value={permissions?.size ?? 0} />

        {/* ── Workspace ─────────────────────────────── */}
        <Divider label="WORKSPACE" />
        <Row
          label="useActiveWorkspace()"
          value={activeWorkspaceId ?? "null"}
          warn={!activeWorkspaceId}
        />

        {/* ── Scope / Grants ────────────────────────── */}
        <Divider label="SCOPE" />
        <Row label="scopeLoading" value={String(scopeLoading)} />
        <Row label="scopeError" value={scopeError ?? "none"} warn={!!scopeError} />
        <Row label="grants.length" value={grants.length} />
        <Row label="activeNodeId" value={activeNodeId ?? "null"} warn={!activeNodeId} />
        <Row label="activeGrant.node_id" value={activeGrant?.node_id ?? "null"} />
        <Row label="activeGrant.workspace_id" value={activeGrant?.workspace_id ?? "null"} />
        <Row label="activeGrant.name" value={activeGrant?.name ?? "null"} />
        <Row label="activeGrant.label_override" value={activeGrant?.label_override ?? "null"} />
        <Row
          label="JWT workspace = scope workspace"
          value={
            jwtWorkspaceMatchesScope === null
              ? "—"
              : jwtWorkspaceMatchesScope
              ? "✓ match"
              : "✗ MISMATCH"
          }
          warn={jwtWorkspaceMatchesScope === false}
        />
        <Row
          label="sentinel.workspaceInSync (B16.8 P3)"
          value={sentinel.workspaceInSync ? "✓ in sync" : "✗ DESYNC"}
          warn={!sentinel.workspaceInSync}
        />

        {/* ── Artefact Type Catalogue ───────────────── */}
        <Divider label="CATALOGUE" />
        <Row label="catLoading" value={String(catLoading)} />
        <Row label="catError" value={catError ?? "none"} warn={!!catError} />
        <Row label="types.length" value={types.length} warn={types.length === 0} />
        <Row
          label="catalogue workspace_id"
          value={types.length > 0 ? (types[0] as any).workspace_id ?? "—" : "—"}
        />

        {/* ── Shell / Nav ───────────────────────────── */}
        <Divider label="SHELL / NAV" />
        <Row label="pathname" value={pathname} />
        <Row label="activeSectionId" value={activeSectionId || "—"} />
        <Row label="activeSection.name" value={activeSection?.name ?? "—"} />
        <Row label="activeSection.pages" value={activeSection?.pages.length ?? 0} />
        <Row label="isScopeOpen" value={String(isScopeOpen)} />
      </div>
    </div>
  );
}
