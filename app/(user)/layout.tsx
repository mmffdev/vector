"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AppViewport from "@/app/components/AppViewport";
import PageWrapper from "@/app/components/PageWrapper";
import AppSidebar_2 from "@/app/components/AppSidebar_2";
import AppFooter from "@/app/components/AppFooter";
import PageHeaderBar from "@/app/components/PageHeaderBar";
import PageTitleRow from "@/app/components/PageTitleRow";
import { PageHeaderProvider } from "@/app/contexts/PageHeaderContext";
import { NavPrefsProvider } from "@/app/contexts/NavPrefsContext";
import { LibraryReleasesProvider } from "@/app/contexts/LibraryReleasesContext";
import { MasterDebugProvider } from "@/app/contexts/MasterDebugContext";
import { DomRegistryProvider, ViewportSlot } from "@/app/contexts/DomRegistryContext";
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
    <MasterDebugProvider>
    <LibraryReleasesProvider>
    <NavPrefsProvider>
      <PageHeaderProvider>
        <DomRegistryProvider>
          <div className="app-root">
            <ViewportSlot kind="side_bar"><AppSidebar_2 /></ViewportSlot>
            <div className="app-main-column">
              <ViewportSlot kind="header">
                <PageHeaderBar />
                <PageTitleRow />
              </ViewportSlot>
              <ViewportSlot kind="app">
                <AppViewport className="app-viewport-container">
                  <PageWrapper className="page-wrapper">{children}</PageWrapper>
                </AppViewport>
              </ViewportSlot>
              <ViewportSlot kind="footer"><AppFooter /></ViewportSlot>
            </div>
          </div>
        </DomRegistryProvider>
      </PageHeaderProvider>
    </NavPrefsProvider>
    </LibraryReleasesProvider>
    </MasterDebugProvider>
  );
}
