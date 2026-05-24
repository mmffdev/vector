"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import RedesignShell from "@/app/redesign/components/RedesignShell";
import { PageHeaderProvider } from "@/app/contexts/PageHeaderContext";
import { NavPrefsProvider } from "@/app/contexts/NavPrefsContext";
import { LibraryReleasesProvider } from "@/app/contexts/LibraryReleasesContext";
import { MasterDebugProvider } from "@/app/contexts/MasterDebugContext";
import { DomRegistryProvider } from "@/app/contexts/DomRegistryContext";
import { ActiveNavProvider } from "@/app/contexts/ActiveNavContext";
import { useAuth } from "@/app/contexts/AuthContext";

export default function UserLayout({ children }: { children: React.ReactNode }) {
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

  // PLA062 S22: legacy identity contexts (TenantContext, ScopeContext,
  // SentinelBridge) deleted. SentinelProvider mounts at the root
  // (app/layout.tsx) so it's available to every consumer including
  // the catalogue providers — this layout just composes the route-
  // group's own provider stack.
  return (
    <MasterDebugProvider>
    <LibraryReleasesProvider>
    <NavPrefsProvider>
      <PageHeaderProvider>
        <ActiveNavProvider>
        <DomRegistryProvider>
          <RedesignShell>{children}</RedesignShell>
        </DomRegistryProvider>
        </ActiveNavProvider>
      </PageHeaderProvider>
    </NavPrefsProvider>
    </LibraryReleasesProvider>
    </MasterDebugProvider>
  );
}
