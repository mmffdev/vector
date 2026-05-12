"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppViewport from "@/app/components/AppViewport";
import PageWrapper from "@/app/components/PageWrapper";
import AppSidebar_2 from "@/app/components/AppSidebar_2";
import ScopeRail from "@/app/components/ScopeRail";
import AppFooter from "@/app/components/AppFooter";
import PageHeaderBar from "@/app/components/PageHeaderBar";
import { PageHeaderProvider } from "@/app/contexts/PageHeaderContext";
import { NavPrefsProvider } from "@/app/contexts/NavPrefsContext";
import { LibraryReleasesProvider } from "@/app/contexts/LibraryReleasesContext";
import { MasterDebugProvider } from "@/app/contexts/MasterDebugContext";
import { DomRegistryProvider, ViewportSlot } from "@/app/contexts/DomRegistryContext";
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
          <div className="app-root">
            <ViewportSlot kind="header">
              <PageHeaderBar />
            </ViewportSlot>
            <ScopeRail />
            <ViewportSlot kind="side_bar"><AppSidebar_2 /></ViewportSlot>
            <div className="app-main-column">
              <ViewportSlot kind="app">
                <AppViewport className="app-viewport-container">
                  <PageWrapper className="page-wrapper">{children}</PageWrapper>
                </AppViewport>
              </ViewportSlot>
              <ViewportSlot kind="footer"><AppFooter /></ViewportSlot>
            </div>
          </div>
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
