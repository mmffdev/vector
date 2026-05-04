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
import { DomRegistryProvider } from "@/app/contexts/DomRegistryContext";
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

  return (
    <MasterDebugProvider>
      <LibraryReleasesProvider>
        <NavPrefsProvider>
          <PageHeaderProvider>
            <DomRegistryProvider>
              <div className="overlay-root">{children}</div>
            </DomRegistryProvider>
          </PageHeaderProvider>
        </NavPrefsProvider>
      </LibraryReleasesProvider>
    </MasterDebugProvider>
  );
}
