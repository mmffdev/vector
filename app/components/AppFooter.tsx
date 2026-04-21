"use client";

import { useAuth } from "@/app/contexts/AuthContext";

export default function AppFooter() {
  const { user } = useAuth();

  return (
    <footer className={`app-footer app-footer--role-${user?.role ?? "user"}`}>
      <div className="app-footer-left">
        <span>&copy; 2026 MMFFDev. All rights reserved.</span>
      </div>
      <div>
        <a href="#" className="app-footer-link">Terms</a>
        <span className="app-footer__sep">·</span>
        <a href="#" className="app-footer-link">Privacy</a>
      </div>
    </footer>
  );
}
