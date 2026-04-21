"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/app/components/Sidebar";
import Topbar from "@/app/components/Topbar";
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
    <div className="app-shell">
      <Topbar />
      <div className="app-body">
        <Sidebar />
        <div className="app-content-wrapper">
          <div className="page-header-bar">{children}</div>
          <main className="main-content"></main>
        </div>
      </div>
      <footer className="footer">
        <div className="footer-left">
          <span>&copy; 2026 MMFFDev. All rights reserved.</span>
        </div>
        <div>
          <a href="#" className="footer-link">Terms</a>
          <span className="footer__sep">·</span>
          <a href="#" className="footer-link">Privacy</a>
        </div>
      </footer>
    </div>
  );
}
