"use client";

// B20.4.1 — tab-bar landing for /user-management. Cloned in shape from
// app/(user)/workspace-admin/artefacts/layout.tsx (the canonical
// horizontal tab-bar pattern). Two tabs today (Users, Permissions);
// extends naturally when B20.5+ refinements (Saved Views, Audit
// Timeline, etc.) land as additional siblings.
//
// Reuses the .artefacts-tab-bar__* class family rather than introducing
// a parallel .user-management-tab-bar__* pack — generalising the
// primitive is its own future story.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const TABS = [
  { key: "users",       label: "Users"       },
  { key: "permissions", label: "Permissions" },
] as const;

type TabKey = typeof TABS[number]["key"];

const SEG_TO_KEY: Record<string, TabKey> = {
  "users":       "users",
  "permissions": "permissions",
};

// Horizontal travel indicator — same hook shape as the artefacts tab
// bar. Stretches across old→new, then settles. Keeps the visual
// language consistent across admin tab bars.
function useHorizontalTravel(containerRef: React.RefObject<HTMLElement | null>, activeKey: string | null) {
  const targetRefs = useRef<Map<string, HTMLElement | null>>(new Map());
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  const [phase, setPhase] = useState<"idle" | "stretch" | "settle">("idle");
  const timer = useRef<number | null>(null);

  const setTarget = useCallback((key: string, el: HTMLElement | null) => {
    if (el) targetRefs.current.set(key, el);
    else targetRefs.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    if (!activeKey) { setBar(null); setPhase("idle"); return; }
    const target = targetRefs.current.get(activeKey);
    const container = containerRef.current;
    if (!target || !container) return;

    const newBar = { left: target.offsetLeft, width: target.offsetWidth };

    if (!bar) { setBar(newBar); setPhase("idle"); return; }

    const bridgeLeft  = Math.min(bar.left, newBar.left);
    const bridgeRight = Math.max(bar.left + bar.width, newBar.left + newBar.width);
    setBar({ left: bridgeLeft, width: bridgeRight - bridgeLeft });
    setPhase("stretch");

    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setBar(newBar);
      setPhase("settle");
    }, 140);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey]);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  return { bar, phase, setTarget };
}

export default function UserManagementLayout({ children }: { children: React.ReactNode }) {
  const router   = useRouter();
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const rootIdx  = segments.indexOf("user-management");
  const tabSeg   = rootIdx >= 0 ? segments[rootIdx + 1] ?? "" : "";
  const activeKey: TabKey = SEG_TO_KEY[tabSeg] ?? "users";

  const containerRef = useRef<HTMLDivElement>(null);
  const { bar, phase, setTarget } = useHorizontalTravel(containerRef, activeKey);

  return (
    <>
      <div className="artefacts-tab-bar">
        <div
          ref={containerRef}
          className="artefacts-tab-bar__tabs"
          role="tablist"
          aria-label="User Management sections"
        >
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={key === activeKey}
              ref={(el) => setTarget(key, el)}
              className={`artefacts-tab-bar__tab${key === activeKey ? " is-active" : ""}`}
              onClick={() => router.push(`/user-management/${key}`)}
            >
              {label}
            </button>
          ))}
          {bar && (
            <span
              className={`artefacts-tab-bar__indicator artefacts-tab-bar__indicator--${phase}`}
              style={{ left: bar.left, width: bar.width }}
              aria-hidden
            />
          )}
        </div>
      </div>
      {children}
    </>
  );
}
