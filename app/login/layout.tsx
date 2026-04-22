"use client";

import { useEffect } from "react";

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", "light");
  }, []);

  return <>{children}</>;
}
