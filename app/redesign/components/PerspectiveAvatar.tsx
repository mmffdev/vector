"use client";

import { useEffect, useRef, useState } from "react";
import { PERSPECTIVES } from "@/app/lib/nav-v2";
import { useShell } from "../ShellContext";

export default function PerspectiveAvatar() {
  const { perspective, setPerspectiveId } = useShell();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className="rd-avatar-wrap">
      <button
        type="button"
        className="rd-avatar"
        title={`Perspective: ${perspective.name}`}
        aria-label={`Switch perspective. Current: ${perspective.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        {perspective.initials}
      </button>
      {open && (
        <div className="rd-avatar__popover" role="menu">
          {PERSPECTIVES.map((p) => {
            const active = p.id === perspective.id;
            return (
              <button
                key={p.id}
                type="button"
                role="menuitem"
                className={`rd-avatar__option${active ? " is-active" : ""}`}
                onClick={() => {
                  setPerspectiveId(p.id);
                  setOpen(false);
                }}
              >
                <span className="rd-avatar__option-initials">{p.initials}</span>
                <span className="rd-avatar__option-name">{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
