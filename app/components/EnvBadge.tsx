"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/app/lib/api";

type EnvName = "dev" | "staging" | "production" | "unknown";
type Letter = "D" | "S" | "P" | "?";

type EnvInfo = {
  env: EnvName;
  letter: Letter;
  db_host: string;
  backend_env: string;
};

const POLL_IDLE_MS = 10_000;
const POLL_SWITCHING_MS = 1_000;
const SWITCH_TIMEOUT_MS = 60_000;

const ALL: { env: Exclude<EnvName, "unknown">; letter: Exclude<Letter, "?"> }[] = [
  { env: "dev", letter: "D" },
  { env: "staging", letter: "S" },
  { env: "production", letter: "P" },
];

export default function EnvBadge() {
  const [info, setInfo] = useState<EnvInfo | null>(null);
  const [error, setError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switching, setSwitching] = useState<null | { target: Exclude<EnvName, "unknown">; startedAt: number }>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const switchingRef = useRef(switching);
  switchingRef.current = switching;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const data = await api<EnvInfo>("/api/env", { skipAuth: true });
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
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const fireSwitch = async (target: Exclude<EnvName, "unknown">) => {
    if (target === "production") {
      const answer = window.prompt(
        'Switching to PRODUCTION (mmffdev.com). Every write hits the live shared DB.\nType "production" to confirm:'
      );
      if (answer !== "production") return;
    }
    setMenuOpen(false);
    setSwitching({ target, startedAt: Date.now() });
    setError(false);
    try {
      await api("/api/env/switch", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
    } catch {
      // Backend may have died mid-response — that's expected.
      // The polling loop is what confirms the switch.
    }
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
  const title = `${info.env} (${info.db_host})${info.backend_env ? ` — BACKEND_ENV=${info.backend_env}` : " — no BACKEND_ENV set"} — click to switch`;

  return (
    <div className="env-badge-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`env-badge env-badge--${info.env} env-badge--button`}
        title={title}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      >
        {info.letter}
      </button>
      {menuOpen && (
        <div className="env-badge-menu" role="menu">
          {others.map((opt) => (
            <button
              key={opt.env}
              type="button"
              role="menuitem"
              className={`env-badge env-badge--${opt.env} env-badge--button env-badge--menu-item`}
              title={`Switch backend to ${opt.env}`}
              onClick={() => fireSwitch(opt.env)}
            >
              {opt.letter}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
