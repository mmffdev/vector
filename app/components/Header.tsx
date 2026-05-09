"use client";

// PLA-0006 / 00264 — Header adopter for the addressable substrate.
//
// Same shape as <Panel> but for identity strips: page titles, model
// names, summary blocks. Renders no panel border / padding of its own;
// the caller supplies layout via className (e.g. "model-preview__header"
// on /portfolio-model). The substrate plumbing — useRegisterAddressable,
// data-address, data-addressable-id, help button + popover, Provider for
// child addresses — is identical to Panel.

import { useEffect, useId, useRef, useState, ReactNode } from "react";
import { TbHelpHexagon } from "react-icons/tb";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import {
  useSamanthaSdk,
  resolveSdkHelp,
  helpValueAsFragment,
} from "@/app/contexts/SamanthaSdkContext";
import { apiSite as api, ApiError } from "@/app/lib/api";

interface HeaderProps {
  // Snake-case identifier under this parent. Substrate validates against
  // /^[a-z0-9_]{1,64}$/ — invalid names throw synchronously.
  name: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  className?: string;
  // Caller can opt out of the help icon when this header is purely
  // decorative. Defaults to true so identity strips are explainable.
  helpable?: boolean;
  children?: ReactNode;
}

export default function Header({
  name,
  title,
  subtitle,
  className,
  helpable: helpableProp = true,
  children,
}: HeaderProps) {
  const { address, addressable_id, helpable: helpableFromRegistry, Provider } =
    useRegisterAddressable({ kind: "header", name });
  // The icon hides when EITHER the caller opts out OR gadmin has flipped
  // the substrate's helpable bit off — both signals deserve to be honoured.
  const helpable = helpableProp && helpableFromRegistry;
  const sdk = useSamanthaSdk();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [bodyHtml, setBodyHtml] = useState<string | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
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

  useEffect(() => {
    if (!open) return;
    if (bodyHtml !== null) return;
    if (!addressable_id) return;
    let cancelled = false;
    setBodyLoading(true);
    api<{ body_html?: string } | null>(`/page-help/${addressable_id}`)
      .catch((err) => {
        // 404 = no help doc; fall through to SDK defaults rather than treat
        // as an error. Re-throw anything else.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      })
      .then((data) => {
        if (cancelled) return;
        const fromBackend = data?.body_html ?? "";
        if (fromBackend) {
          setBodyHtml(fromBackend);
          return;
        }
        const sdkRaw = resolveSdkHelp(sdk.helpDefaults, "header", name);
        const sdkBody = sdkRaw ? helpValueAsFragment(sdkRaw).body_html ?? "" : "";
        setBodyHtml(sdkBody);
      })
      .catch(() => {
        if (cancelled) return;
        const sdkRaw = resolveSdkHelp(sdk.helpDefaults, "header", name);
        const sdkBody = sdkRaw ? helpValueAsFragment(sdkRaw).body_html ?? "" : "";
        setBodyHtml(sdkBody);
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
      <header
        className={className ? `addr-header ${className}` : "addr-header"}
        data-addressable-id={addressable_id ?? undefined}
        data-address={address}
      >
        <div className="addr-header__row">
          <div className="addr-header__title-block">
            {title !== undefined && (
              <h2 id={labelId} className="addr-header__title">{title}</h2>
            )}
            {subtitle !== undefined && (
              <p className="addr-header__subtitle">{subtitle}</p>
            )}
          </div>
          {helpable && (
            <button
              ref={triggerRef}
              type="button"
              className="btn btn--icon btn--ghost btn--sm addr-header__help-btn"
              aria-expanded={open}
              aria-haspopup="dialog"
              aria-label={`Help for ${address}`}
              onClick={() => setOpen((v) => !v)}
            >
              <TbHelpHexagon aria-hidden="true" />
            </button>
          )}
        </div>

        {children !== undefined && <div className="addr-header__body">{children}</div>}

        {helpable && open && (
          <div
            ref={popoverRef}
            role="dialog"
            aria-labelledby={labelId}
            className="addr-header__popover"
          >
            <div className="addr-header__popover-row">
              <button
                type="button"
                className="addr-header__address-pill"
                onClick={copyAddress}
                title="Click to copy"
              >
                {address}
                <span className="addr-header__copy-state" aria-live="polite">
                  {copied ? "copied" : "copy"}
                </span>
              </button>
              <button
                type="button"
                className="btn btn--icon btn--ghost btn--sm addr-header__close"
                aria-label="Close help"
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                }}
              >
                ×
              </button>
            </div>
            <div className="addr-header__popover-body">
              {bodyLoading ? (
                <p className="addr-header__popover-empty">Loading…</p>
              ) : bodyHtml ? (
                <div dangerouslySetInnerHTML={{ __html: bodyHtml }} />
              ) : (
                <p className="addr-header__popover-empty">No help text yet for this header.</p>
              )}
            </div>
          </div>
        )}
      </header>
    </Provider>
  );
}
