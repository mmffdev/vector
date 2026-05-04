"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";

const isProd = process.env.NODE_ENV === "production";

interface Target {
  address: string;
  rect: { top: number; left: number; width: number; height: number };
}

export default function AddressDevtool() {
  const { user } = useAuth();
  const enabled = !isProd || user?.role.code === "gadmin";
  if (!enabled) return null;
  return <Devtool />;
}

function Devtool() {
  const [armed, setArmed] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const targetRef = useRef<Target | null>(null);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  const findTarget = useCallback((x: number, y: number): Target | null => {
    const stack = (document.elementsFromPoint(x, y) as HTMLElement[]) ?? [];
    for (const el of stack) {
      const addr = el.getAttribute?.("data-address");
      if (addr) {
        const r = el.getBoundingClientRect();
        return {
          address: addr,
          rect: { top: r.top, left: r.left, width: r.width, height: r.height },
        };
      }
    }
    return null;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "a" || e.key === "A" || e.code === "KeyA")) {
        e.preventDefault();
        setArmed((v) => {
          const next = !v;
          if (!next) {
            setFrozen(false);
            setTarget(null);
          }
          return next;
        });
      } else if (e.key === "Escape" && armed) {
        setArmed(false);
        setFrozen(false);
        setTarget(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  useEffect(() => {
    if (!armed || frozen) return;
    const onMove = (e: MouseEvent) => {
      const t = findTarget(e.clientX, e.clientY);
      setTarget(t);
    };
    const onScrollOrResize = () => {
      const cur = targetRef.current;
      if (!cur) return;
      const els = document.querySelectorAll<HTMLElement>(`[data-address="${CSS.escape(cur.address)}"]`);
      const el = els[0];
      if (!el) return;
      const r = el.getBoundingClientRect();
      setTarget({
        address: cur.address,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [armed, frozen, findTarget]);

  useEffect(() => {
    if (!armed) return;
    const onClick = (e: MouseEvent) => {
      if (!e.altKey) return;
      const t = findTarget(e.clientX, e.clientY);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      setTarget(t);
      setFrozen((f) => !f);
    };
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [armed, findTarget]);

  const copy = useCallback(async () => {
    const cur = targetRef.current;
    if (!cur) return;
    try {
      await navigator.clipboard.writeText(cur.address);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1200);
    } catch {
      setCopyState("idle");
    }
  }, []);

  // Share link = current URL with the addressable address pinned in the
  // hash. <AddressAnchorResolver /> in the root layout reads the hash and
  // scrolls/highlights on landing. Clearing query params is intentional —
  // share links should land on the canonical view of the address.
  const copyShareLink = useCallback(async () => {
    const cur = targetRef.current;
    if (!cur) return;
    try {
      const u = new URL(window.location.href);
      u.hash = `addr=${encodeURIComponent(cur.address)}`;
      await navigator.clipboard.writeText(u.toString());
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 1200);
    } catch {
      setShareState("idle");
    }
  }, []);

  const pillStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!target) return undefined;
    const PILL_GAP = 4;
    const ESTIMATED_PILL_H = 22;
    let top = target.rect.top - ESTIMATED_PILL_H - PILL_GAP;
    if (top < 4) top = target.rect.top + PILL_GAP;
    return { top, left: target.rect.left };
  }, [target]);

  const outlineStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!target) return undefined;
    return {
      top: target.rect.top,
      left: target.rect.left,
      width: target.rect.width,
      height: target.rect.height,
    };
  }, [target]);

  return (
    <>
      {armed && (
        <div className="address-devtool__hint" role="status" aria-live="polite">
          {frozen ? "frozen — ⌥click to release · ESC to exit" : "address devtool armed — hover · ⌥click to freeze · ESC to exit"}
        </div>
      )}
      {armed && target && outlineStyle && (
        <div className="address-devtool__outline" style={outlineStyle} aria-hidden="true" />
      )}
      {armed && target && pillStyle && (
        <div className="address-devtool__pill" style={pillStyle}>
          <button type="button" className="address-devtool__address" onClick={copy} title="Copy address">
            {target.address}
          </button>
          {copyState === "copied" && <span className="address-devtool__copy-state">copied</span>}
          <button
            type="button"
            className="btn btn--icon btn--ghost btn--xs address-devtool__share"
            onClick={copyShareLink}
            title="Copy share link"
            aria-label="Copy share link"
          >
            ↗
          </button>
          {shareState === "copied" && <span className="address-devtool__copy-state">link copied</span>}
        </div>
      )}
    </>
  );
}
