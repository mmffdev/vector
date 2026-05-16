"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import RedesignShell from "@/app/redesign/components/RedesignShell";
import { PageHeaderProvider } from "@/app/contexts/PageHeaderContext";
import { NavPrefsProvider } from "@/app/contexts/NavPrefsContext";
import { LibraryReleasesProvider } from "@/app/contexts/LibraryReleasesContext";
import { MasterDebugProvider } from "@/app/contexts/MasterDebugContext";
import { DomRegistryProvider } from "@/app/contexts/DomRegistryContext";
import { TenantProvider } from "@/app/contexts/TenantContext";
import { ActiveNavProvider } from "@/app/contexts/ActiveNavContext";
import { ScopeProvider } from "@/app/contexts/ScopeContext";
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

  return (
    <TenantProvider>
    <MasterDebugProvider>
    <LibraryReleasesProvider>
    <NavPrefsProvider>
      <PageHeaderProvider>
        <ActiveNavProvider>
        <ScopeProvider>
        <DomRegistryProvider>
          <RedesignShell>{children}</RedesignShell>
        </DomRegistryProvider>
        </ScopeProvider>
        </ActiveNavProvider>
      </PageHeaderProvider>
    </NavPrefsProvider>
    </LibraryReleasesProvider>
    </MasterDebugProvider>
    </TenantProvider>
  );
}
