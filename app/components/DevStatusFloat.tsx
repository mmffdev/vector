"use client";

import { useEffect, useRef, useState } from "react";
import "@dev/styles/dev.css";
import ServiceHealthPanel from "./ServiceHealthPanel";
import { useServiceHealth } from "./useServiceHealth";

// Dead-code eliminated in production build — returns null if not dev.
export default function DevStatusFloat() {
  if (process.env.NODE_ENV !== "development") return null;
  return <FloatPanel />;
}

function FloatPanel() {
  const [open, setOpen] = useState(false);
  const rootRef         = useRef<HTMLDivElement>(null);
  const { result, loading } = useServiceHealth();

  const services  = result?.services ?? [];
  const downCount = services.filter((s) => s.status === "down").length;
  const dotStatus =
    loading && !result   ? "checking"
    : downCount > 0      ? "down"
    : services.length > 0 ? "up"
    : "checking";

  useEffect(() => {
    if (!open) return;
    const onKey   = (e: KeyboardEvent)  => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent)     => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className="devf" ref={rootRef}>
      {open && (
        <div className="devf__panel" role="dialog" aria-label="Service health">
          <ServiceHealthPanel />
        </div>
      )}

      <button
        className={`devf__trigger devf__trigger--${dotStatus}`}
        onClick={() => setOpen((o) => !o)}
        title="Dev service health"
        aria-label="Toggle service health panel"
        aria-expanded={open}
      >
        <ServerIcon />
        <span className={`devf__dot devf__dot--${dotStatus}`} aria-hidden />
      </button>
    </div>
  );
}

function ServerIcon() {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    >
      <rect x="2" y="3" width="20" height="8" rx="2" />
      <rect x="2" y="13" width="20" height="8" rx="2" />
      <circle cx="18" cy="7"  r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18" cy="17" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
