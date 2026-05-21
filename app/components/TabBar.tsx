"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export interface TabBarTab {
  /** URL segment for this tab — also used as the active-state key. */
  key: string;
  /** Visible label. */
  label: string;
  /** Absolute href the tab navigates to on click. */
  href: string;
}

interface TabBarProps {
  /** Ordered list of tabs. The first tab is the default when no segment matches. */
  tabs: TabBarTab[];
  /**
   * Optional ARIA label for the tablist. Falls back to "Sections".
   */
  ariaLabel?: string;
}

/**
 * Horizontal travel indicator — stretch to bridge old→new, then elastic settle.
 * Mirrors useTravelIndicator from app/redesign/components/nav_travel_indicator.tsx
 * but reads offsetLeft + offsetWidth instead of offsetTop + offsetHeight.
 */
function useHorizontalTravel(
  containerRef: React.RefObject<HTMLElement | null>,
  activeKey: string | null,
) {
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

    // Stretch phase: span from leftmost to rightmost edge of old+new.
    const bridgeLeft = Math.min(bar.left, newBar.left);
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

/**
 * Resolve which tab is active by checking which tab's href is a prefix of
 * the current pathname (longest match wins, so /a/b beats /a). Falls back
 * to the first tab when nothing matches.
 */
function resolveActiveKey(tabs: TabBarTab[], pathname: string): string {
  let best: { key: string; len: number } | null = null;
  for (const t of tabs) {
    if (pathname === t.href || pathname.startsWith(t.href + "/")) {
      if (!best || t.href.length > best.len) {
        best = { key: t.key, len: t.href.length };
      }
    }
  }
  return best?.key ?? tabs[0]?.key ?? "";
}

/**
 * Sticky horizontal tab bar with animated travel indicator. Lives at the top
 * of a route group's content area; clicks navigate to sibling routes. Pair
 * with a parent layout.tsx that renders <TabBar> above {children}.
 *
 * Example:
 *
 *   <TabBar
 *     ariaLabel="Notifications sections"
 *     tabs={[
 *       { key: "notifications", label: "Notifications", href: "/user/notifications/notifications" },
 *       { key: "settings",      label: "Settings",      href: "/user/notifications/settings"      },
 *     ]}
 *   />
 */
export default function TabBar({ tabs, ariaLabel = "Sections" }: TabBarProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const activeKey = resolveActiveKey(tabs, pathname);

  const containerRef = useRef<HTMLDivElement>(null);
  const { bar, phase, setTarget } = useHorizontalTravel(containerRef, activeKey);

  return (
    <div className="tab-bar">
      <div
        ref={containerRef}
        className="tab-bar__tabs"
        role="tablist"
        aria-label={ariaLabel}
      >
        {tabs.map(({ key, label, href }) => (
          <button
            key={key}
            role="tab"
            aria-selected={key === activeKey}
            ref={(el) => setTarget(key, el)}
            className={`tab-bar__tab${key === activeKey ? " is-active" : ""}`}
            onClick={() => router.push(href)}
          >
            {label}
          </button>
        ))}
        {bar && (
          <span
            className={`tab-bar__indicator tab-bar__indicator--${phase}`}
            style={{ left: bar.left, width: bar.width }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}
