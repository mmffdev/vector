"use client";

// PLA-0005 — Panel primitive (AC13).
//
// Registers itself in the addressable substrate via useRegisterAddressable
// ({kind: 'panel', name}), exposes a TbHelpHexagon top-right that opens
// a popover with:
//   • click-to-copy address pill (canonical samantha._… string)
//   • body_html fetched from /api/page-help/:addressable_id (sanitised by
//     the backend; rendered via dangerouslySetInnerHTML on the assumption
//     the editor only allows safe markup — guarded by gadmin role).
// ESC + outside-click dismiss.
//
// Children are wrapped in the Provider returned by useRegisterAddressable
// so descendants nest correctly inside this panel's address.

import { useEffect, useId, useRef, useState, ReactNode } from "react";
import { TbHelpHexagon } from "react-icons/tb";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import { useSamanthaSdk, resolveSdkHelp } from "@/app/contexts/SamanthaSdkContext";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:5100";

interface PanelProps {
  // Snake-case identifier under this parent. Validated by the substrate
  // against /^[a-z0-9_]{1,64}$/ — invalid names throw synchronously.
  name: string;
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export default function Panel({ name, title, className, children }: PanelProps) {
  const { address, addressable_id, helpable, Provider } = useRegisterAddressable({
    kind: "panel",
    name,
  });
  const sdk = useSamanthaSdk();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bodyHtml, setBodyHtml] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const labelId = useId();

  // ESC + outside-click dismiss while open.
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

  // Lazy-fetch help body the first time the popover opens AND we know
  // the addressable_id. If the addressable is still registering on first
  // mount, the next open after id resolution will fetch.
  //
  // Resolution order (Samantha SDK contract): backend body (page_help
  // joined to library_help_defaults) -> SDK manifest helpDefaults
  // (when this Panel is mounted inside a <SamanthaSdkProvider>) ->
  // empty/null. Backend wins so gadmin-authored copy always overrides
  // a custom app's bundled defaults.
  useEffect(() => {
    if (!open) return;
    if (bodyHtml !== null) return;
    if (!addressable_id) return;
    let cancelled = false;
    setBodyLoading(true);
    fetch(`${API_BASE}/api/page-help/${addressable_id}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { body_html?: string } | null) => {
        if (cancelled) return;
        const fromBackend = data?.body_html ?? "";
        if (fromBackend) {
          setBodyHtml(fromBackend);
          return;
        }
        const fromSdk = resolveSdkHelp(sdk.helpDefaults, "panel", name);
        setBodyHtml(fromSdk ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        const fromSdk = resolveSdkHelp(sdk.helpDefaults, "panel", name);
        setBodyHtml(fromSdk ?? "");
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, addressable_id, bodyHtml, sdk.helpDefaults, name]);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  };

  return (
    <Provider>
      <section
        className={className ? `panel ${className}` : "panel"}
        data-addressable-id={addressable_id ?? undefined}
        data-address={address}
      >
        <header className="panel__header">
          {title !== undefined ? (
            <h2 id={labelId} className="panel__title">{title}</h2>
          ) : (
            <span id={labelId} className="panel__title panel__title--empty" aria-hidden="true" />
          )}
          {helpable && (
            <button
              ref={triggerRef}
              type="button"
              className="panel__help-btn"
              aria-expanded={open}
              aria-haspopup="dialog"
              aria-label={`Help for ${address}`}
              onClick={() => setOpen((v) => !v)}
            >
              <TbHelpHexagon aria-hidden="true" />
            </button>
          )}
        </header>

        <div className="panel__body">{children}</div>

        {helpable && open && (
          <div
            ref={popoverRef}
            role="dialog"
            aria-labelledby={labelId}
            className="panel__popover"
          >
            <div className="panel__popover-row">
              <button
                type="button"
                className="panel__address-pill"
                onClick={copyAddress}
                title="Click to copy"
              >
                {address}
                <span className="panel__copy-state" aria-live="polite">
                  {copied ? "copied" : "copy"}
                </span>
              </button>
              <button
                type="button"
                className="panel__close"
                aria-label="Close help"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                ×
              </button>
            </div>
            <div className="panel__popover-body">
              {bodyLoading ? (
                <p className="panel__popover-empty">Loading…</p>
              ) : bodyHtml ? (
                <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              ) : (
                <p className="panel__popover-empty">No help text yet for this panel.</p>
              )}
            </div>
          </div>
        )}
      </section>
    </Provider>
  );
}
