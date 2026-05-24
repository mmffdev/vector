"use client";

// PLA-0006 — (overlay) route group.
//
// Pages under this group render full-viewport over everything else.
// Unlike (user), this layout intentionally OMITS the app shell
// (sidebar, header, footer) — pages are responsible for their own
// chrome and a Finish/Close affordance that returns the user to the
// previous route.
//
// Auth is still enforced — same gate as (user), so unauthenticated
// hits redirect to /login.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MasterDebugProvider } from "@/app/contexts/MasterDebugContext";
import { LibraryReleasesProvider } from "@/app/contexts/LibraryReleasesContext";
import { NavPrefsProvider } from "@/app/contexts/NavPrefsContext";
import { PageHeaderProvider } from "@/app/contexts/PageHeaderContext";
import { DomRegistryProvider, ViewportSlot } from "@/app/contexts/DomRegistryContext";
import { useAuth } from "@/app/contexts/AuthContext";

export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/login");
      return;
    }
    if (user.force_password_change) {
      router.replace("/change-password");
    }
  }, [loading, user, router]);

  if (loading || !user || user.force_password_change) return null;

  // PLA062 S22: SentinelProvider mounts at the root (app/layout.tsx)
  // so it's available to every consumer including the catalogue
  // providers — this overlay layout just composes its own provider
  // stack. AuthContext stays for the credential flow only — its
  // deletion is gated on extracting login/logout to app/lib/auth.ts
  // (deferred, see S22 closure note).
  return (
    <MasterDebugProvider>
      <LibraryReleasesProvider>
        <NavPrefsProvider>
          <PageHeaderProvider>
            <DomRegistryProvider>
              <ViewportSlot kind="app">
                <div className="overlay-root">{children}</div>
              </ViewportSlot>
            </DomRegistryProvider>
          </PageHeaderProvider>
        </NavPrefsProvider>
      </LibraryReleasesProvider>
    </MasterDebugProvider>
  );
}
