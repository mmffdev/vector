"use client";

import React, { useEffect, useId, useRef, useState, ReactNode } from "react";
import { TbHelpHexagon } from "react-icons/tb";

interface PaneHeaderProps {
  paneId: string;
  title: ReactNode;
  helpBody?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export default function PaneHeader({ paneId, title, helpBody, children, className }: PaneHeaderProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const labelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(paneId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore — clipboard unavailable
    }
  };

  return (
    <header className={className ? `pane-header ${className}` : "pane-header"} data-pane-id={paneId}>
      <div className="pane-header__main">
        <div className="pane-header__title-row">
          <h2 id={labelId} className="pane-header__title">{title}</h2>
          <button
            ref={triggerRef}
            type="button"
            className="pane-header__help-btn"
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-label={`Help for ${paneId}`}
            onClick={() => setOpen((v) => !v)}
          >
            <TbHelpHexagon aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>

      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-labelledby={labelId}
          className="pane-header__popover"
        >
          <div className="pane-header__popover-row">
            <button
              type="button"
              className="pane-header__pane-id"
              onClick={copyId}
              title="Click to copy"
            >
              {paneId}
              <span className="pane-header__copy-state" aria-live="polite">
                {copied ? "copied" : "copy"}
              </span>
            </button>
            <button
              type="button"
              className="pane-header__close"
              aria-label="Close help"
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
              }}
            >
              ×
            </button>
          </div>
          <div className="pane-header__popover-body">
            {helpBody ?? <p className="pane-header__popover-empty">No help text yet for this pane.</p>}
          </div>
        </div>
      )}
    </header>
  );
}
