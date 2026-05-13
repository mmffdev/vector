"use client";

import { useEffect, useRef, useState } from "react";
import "@dev/styles/dev.css";
import ServiceHealthPanel from "./ServiceHealthPanel";
import { useServiceHealth } from "./useServiceHealth";
import { apiRoot } from "@/app/lib/api";

type EnvName = "dev" | "staging" | "production" | "unknown";
type Letter = "D" | "S" | "P" | "?";
type PipelineStatus = { env: EnvName; letter: Letter; healthy: boolean };

const POLL_MS = 10_000;

function useEnvStatus() {
  const [info, setInfo] = useState<PipelineStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const data = await apiRoot<PipelineStatus>("/status/pipeline", { skipAuth: true });
        if (!cancelled) setInfo(data);
      } catch { /* ignore */ } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);
  return info;
}

// Dead-code eliminated in production build — returns null if not dev.
export default function DevStatusFloat() {
  if (process.env.NODE_ENV !== "development") return null;
  return <FloatPanel />;
}

function FloatPanel() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { result, loading } = useServiceHealth();
  const envInfo = useEnvStatus();

  const services  = result?.services ?? [];
  const downCount = services.filter((s) => s.status === "down").length;
  const healthStatus =
    loading && !result    ? "checking"
    : downCount > 0       ? "down"
    : services.length > 0 ? "up"
    : "checking";

  const env    = envInfo?.env ?? "unknown";
  const letter = envInfo?.letter ?? "?";

  useEffect(() => {
    if (!open) return;
    const onKey   = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent)    => {
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
        className={`devf__trigger devf__trigger--${healthStatus}`}
        onClick={() => setOpen((o) => !o)}
        title={`Backend: ${env} — ${healthStatus === "down" ? `${downCount} service(s) down` : healthStatus}`}
        aria-label="Toggle service health panel"
        aria-expanded={open}
      >
        <span className={`devf__env-letter devf__env-letter--${env}`}>{letter}</span>
      </button>
    </div>
  );
}
