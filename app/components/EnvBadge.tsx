"use client";

import { useEffect, useRef, useState } from "react";
import { apiInfra } from "@/app/lib/api";

type EnvName = "dev" | "staging" | "production" | "unknown";
type Letter = "D" | "S" | "P" | "?";

type Component = {
  name: string;
  ok: boolean;
  detail?: string;
  at: string;
};

type PipelineStatus = {
  env: EnvName;
  letter: Letter;
  db_host: string;
  commit?: string;
  build_time?: string;
  started_at?: string;
  healthy: boolean;
  components: Component[];
};

const POLL_IDLE_MS = 10_000;
const POLL_SWITCHING_MS = 1_000;
const SWITCH_TIMEOUT_MS = 60_000;
const PROD_HOLD_MS = 3_000;

const ALL: { env: Exclude<EnvName, "unknown">; letter: Exclude<Letter, "?"> }[] = [
  { env: "dev", letter: "D" },
  { env: "staging", letter: "S" },
  { env: "production", letter: "P" },
];

export default function EnvBadge() {
  const [info, setInfo] = useState<PipelineStatus | null>(null);
  const [error, setError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState<null | { target: Exclude<EnvName, "unknown">; startedAt: number }>(null);
  const [prodHold, setProdHold] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const switchingRef = useRef(switching);
  switchingRef.current = switching;
  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const data = await apiInfra<PipelineStatus>("/status/pipeline", { skipAuth: true });
        if (cancelled) return;
        setInfo(data);
        setError(false);
        const sw = switchingRef.current;
        if (sw && data.env === sw.target) {
          setSwitching(null);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (cancelled) return;
        const sw = switchingRef.current;
        const interval = sw ? POLL_SWITCHING_MS : POLL_IDLE_MS;
        timer = setTimeout(tick, interval);
        if (sw && Date.now() - sw.startedAt > SWITCH_TIMEOUT_MS) {
          setSwitching(null);
          setError(true);
        }
      }
    };

    tick();
    const onFocus = () => tick();
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        cancelHold();
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const cancelHold = () => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    holdStartRef.current = 0;
    setProdHold(0);
  };

  const performSwitch = async (target: Exclude<EnvName, "unknown">) => {
    setMenuOpen(false);
    cancelHold();
    setSwitching({ target, startedAt: Date.now() });
    setError(false);
    try {
      await apiInfra("/env/switch", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
    } catch {
      // Backend may have died mid-response — expected mid-restart. The
      // polling loop is what confirms the switch.
    }
  };

  // For dev/staging — single click. For production — 3s mousedown hold so
  // a stray click can't redirect every write to the live shared DB.
  const onClick = (target: Exclude<EnvName, "unknown">) => {
    if (target !== "production") {
      void performSwitch(target);
    }
  };

  const beginProdHold = () => {
    holdStartRef.current = Date.now();
    setProdHold(0);
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const pct = Math.min(100, (elapsed / PROD_HOLD_MS) * 100);
      setProdHold(pct);
      if (elapsed >= PROD_HOLD_MS) {
        if (holdTimerRef.current) {
          clearInterval(holdTimerRef.current);
          holdTimerRef.current = null;
        }
        void performSwitch("production");
      }
    }, 50);
  };

  // ----- render -----

  if (switching) {
    return (
      <div className="env-badge env-badge--switching" title={`Switching to ${switching.target}…`}>
        <span className="env-badge__pulse" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="env-badge env-badge--error" title="Backend unreachable">
        !
      </div>
    );
  }

  if (!info) return <div className="env-badge env-badge--loading" />;

  const others = ALL.filter((o) => o.env !== info.env);
  const failed = info.components.filter((c) => !c.ok);
  const degraded = !info.healthy && failed.length > 0;
  const componentLines = info.components.length
    ? info.components.map((c) => `${c.ok ? "✓" : "✗"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`).join("\n")
    : "no components reporting";
  const title = `${info.env} (${info.db_host})\n${componentLines}\n— click to switch —`;

  return (
    <div className="env-badge-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`env-badge env-badge--${info.env} env-badge--button${degraded ? " env-badge--degraded" : ""}`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {info.letter}
        {degraded && <span className="env-badge__degraded-dot" aria-label={`${failed.length} degraded`} />}
      </button>
      {menuOpen && (
        <div className="env-badge-menu" role="menu">
          {others.map((opt) => {
            const isProd = opt.env === "production";
            const holdActive = isProd && prodHold > 0;
            return (
              <button
                key={opt.env}
                type="button"
                role="menuitem"
                className={`env-badge env-badge--${opt.env} env-badge--button env-badge--menu-item${holdActive ? " env-badge--prod-confirming" : ""}`}
                title={isProd ? "Hold for 3 seconds to switch to PRODUCTION" : `Switch backend to ${opt.env}`}
                onClick={() => onClick(opt.env)}
                onMouseDown={isProd ? beginProdHold : undefined}
                onMouseUp={isProd ? cancelHold : undefined}
                onMouseLeave={isProd ? cancelHold : undefined}
                onTouchStart={isProd ? beginProdHold : undefined}
                onTouchEnd={isProd ? cancelHold : undefined}
                style={isProd && holdActive ? ({ ["--prod-hold" as string]: `${prodHold}%` } as React.CSSProperties) : undefined}
              >
                {opt.letter}
                {holdActive && <span className="env-badge__hold-fill" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
