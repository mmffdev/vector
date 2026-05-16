"use client";

// PLA-0005 — Panel primitive (AC13).
// PLA-0008 — Popover renders rich HelpDoc (title + body + videos + images +
//            link to full /help/<id> page) via HelpDocRenderer.
//
// Registers itself in the addressable substrate via useRegisterAddressable
// ({kind: 'panel', name}), exposes a TbHelpHexagon top-right that opens
// a popover with:
//   • click-to-copy address pill (canonical samantha._… string)
//   • full HelpDoc fetched from /api/page-help/:addressable_id, rendered
//     in compact variant. Backend sanitises body_html on write; renderer
//     re-checks YouTube + image URL whitelists at render time.
// ESC + outside-click dismiss.
//
// Children are wrapped in the Provider returned by useRegisterAddressable
// so descendants nest correctly inside this panel's address.

import React, { useEffect, useId, useRef, useState, ReactNode } from "react";
import { TbHelpHexagon } from "react-icons/tb";
import { useRegisterAddressable } from "@/app/contexts/DomRegistryContext";
import {
  useSamanthaSdk,
  resolveSdkHelp,
  helpValueAsFragment,
} from "@/app/contexts/SamanthaSdkContext";
import HelpDocRenderer, { type HelpDoc } from "@/app/components/HelpDocRenderer";
import { apiSite as api, ApiError } from "@/app/lib/api";

export type BorderProp = {
  type?:  "solid" | "dashed" | "dotted" | "none";
  width?: string;
  color?: string;
  sides?: "all" | "top" | "right" | "bottom" | "left" | ("top" | "right" | "bottom" | "left")[];
};

export function buildBorderStyle(border: BorderProp): React.CSSProperties {
  const val = `${border.width ?? "1px"} ${border.type ?? "solid"} ${border.color ?? "var(--border-panel)"}`;
  const sides = border.sides ?? "all";
  if (sides === "all") return { border: val };
  const list = Array.isArray(sides) ? sides : [sides];
  const style: React.CSSProperties = { border: "none" };
  if (list.includes("top"))    style.borderTop    = val;
  if (list.includes("right"))  style.borderRight  = val;
  if (list.includes("bottom")) style.borderBottom = val;
  if (list.includes("left"))   style.borderLeft   = val;
  return style;
}

interface PanelProps {
  // Snake-case identifier under this parent. Validated by the substrate
  // against /^[a-z0-9_]{1,64}$/ — invalid names throw synchronously.
  name: string;
  title?: ReactNode;
  className?: string;
  children?: ReactNode;
  // Optional description rendered as a <p> below the title in the header.
  description?: ReactNode;
  // Call-site override: pass `helpable={false}` to suppress the help icon
  // even if the substrate row says helpable=true. Use when a Panel is
  // wrapping for heading/addressable semantics but parent context already
  // owns the help (e.g. a repeater under a <PageDescription>).
  helpable?: boolean;
  // Shorthand margin [top, right, bottom, left] — each value is a CSS string
  // (e.g. "20px", "var(--gap-block-bottom)"). Defaults to 0 for any omitted slot.
  margin?: [string?, string?, string?, string?];
  // Shorthand padding [top, right, bottom, left]. Null/omitted slot = var(--space-4) (16px), the panel CSS default.
  padding?: [string?, string?, string?, string?];
  // Border override. Null prop = panel CSS default (1px solid var(--border-panel)).
  // sides: "all" | single side | array of sides.
  border?: {
    type?:  "solid" | "dashed" | "dotted" | "none";
    width?: string;
    color?: string;
    sides?: "all" | "top" | "right" | "bottom" | "left" | ("top" | "right" | "bottom" | "left")[];
  };
  // Background colour. Any CSS color string (hex, token, etc.). Null/omitted = transparent.
  background?: string;
  // Corner radius {top, right, bottom, left} — maps to border-radius corners TL/TR/BR/BL.
  // Each key is a CSS string. Null/omitted = "0".
  radius?: { top?: string; right?: string; bottom?: string; left?: string };
}

export default function Panel({ name, title, description, className, children, helpable: helpableProp, margin, padding, border, background, radius }: PanelProps) {
  const { address, addressable_id, helpable: helpableFromRegistry, Provider } = useRegisterAddressable({
    kind: "panel",
    name,
  });
  const helpable = helpableProp === false ? false : helpableFromRegistry;
  const sdk = useSamanthaSdk();

  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [doc, setDoc] = useState<HelpDoc | null>(null);
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

  // Lazy-fetch help doc the first time the popover opens AND we know
  // the addressable_id. If the addressable is still registering on first
  // mount, the next open after id resolution will fetch.
  //
  // Resolution order (Samantha SDK contract): backend doc (page_help joined
  // to library_help_defaults — full title/body/videos/images shape) -> SDK
  // manifest helpDefaults (when this Panel is mounted inside a
  // <SamanthaSdkProvider>; provides body_html only) -> empty state.
  // Backend wins so gadmin-authored copy always overrides bundled defaults.
  useEffect(() => {
    if (!open) return;
    if (doc !== null) return;
    if (!addressable_id) return;
    let cancelled = false;
    setBodyLoading(true);
    api<Partial<HelpDoc> | null>(`/page-help/${addressable_id}`)
      .catch((err) => {
        // 404 is expected when no help doc exists yet; return null and let
        // the SDK-defaults fallback below run. Re-throw anything else so the
        // outer .catch can run the same fallback path.
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      })
      .then((data) => {
        if (cancelled) return;
        const sdkRaw = resolveSdkHelp(sdk.helpDefaults, "panel", name);
        const sdkFrag = sdkRaw ? helpValueAsFragment(sdkRaw) : null;
        const backendHasBody = (data?.body_html ?? "").trim().length > 0;
        const next: HelpDoc = {
          addressable_id: addressable_id,
          title: data?.title ?? sdkFrag?.title ?? null,
          body_html: backendHasBody ? data!.body_html! : sdkFrag?.body_html ?? "",
          video_embeds:
            (data?.video_embeds && data.video_embeds.length > 0)
              ? data.video_embeds
              : sdkFrag?.video_embeds ?? [],
          image_urls:
            (data?.image_urls && data.image_urls.length > 0)
              ? data.image_urls
              : sdkFrag?.image_urls ?? [],
        };
        setDoc(next);
      })
      .catch(() => {
        if (cancelled) return;
        const sdkRaw = resolveSdkHelp(sdk.helpDefaults, "panel", name);
        const sdkFrag = sdkRaw ? helpValueAsFragment(sdkRaw) : null;
        setDoc({
          addressable_id: addressable_id,
          title: sdkFrag?.title ?? null,
          body_html: sdkFrag?.body_html ?? "",
          video_embeds: sdkFrag?.video_embeds ?? [],
          image_urls: sdkFrag?.image_urls ?? [],
        });
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, addressable_id, doc, sdk.helpDefaults, name]);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  };

  const hasTitle = title !== undefined && title !== "" && title !== null;

  const marginStyle = margin
    ? {
        marginTop:    margin[0] ?? "0",
        marginRight:  margin[1] ?? "0",
        marginBottom: margin[2] ?? "0",
        marginLeft:   margin[3] ?? "0",
      }
    : undefined;

  const paddingStyle = padding
    ? {
        paddingTop:    padding[0] ?? "var(--space-4)",
        paddingRight:  padding[1] ?? "var(--space-4)",
        paddingBottom: padding[2] ?? "var(--space-4)",
        paddingLeft:   padding[3] ?? "var(--space-4)",
      }
    : undefined;

  const borderStyle = border ? buildBorderStyle(border) : undefined;

  const backgroundStyle = background ? { background } : undefined;

  const radiusStyle = radius
    ? {
        borderTopLeftRadius:     radius.top    ?? "0",
        borderTopRightRadius:    radius.right  ?? "0",
        borderBottomRightRadius: radius.bottom ?? "0",
        borderBottomLeftRadius:  radius.left   ?? "0",
      }
    : undefined;

  const helpBtn = helpable ? (
    <button
      ref={triggerRef}
      type="button"
      className={hasTitle ? "btn btn--icon btn--ghost btn--sm panel__help-btn" : "btn btn--icon btn--ghost btn--sm panel__help-btn panel__help-btn--floating"}
      aria-expanded={open}
      aria-haspopup="dialog"
      aria-label={`Help for ${address}`}
      onClick={() => setOpen((v) => !v)}
    >
      <TbHelpHexagon aria-hidden="true" />
    </button>
  ) : null;

  return (
    <Provider>
      <section
        className={className ? `panel ${className}` : "panel"}
        data-addressable-id={addressable_id ?? undefined}
        data-address={address}
        style={{ ...marginStyle, ...paddingStyle, ...borderStyle, ...backgroundStyle, ...radiusStyle }}
      >
        {hasTitle ? (
          <header className="panel__header">
            <h2 id={labelId} className="panel__title">{title}</h2>
            {description && <p className="panel__description">{description}</p>}
            {helpBtn}
          </header>
        ) : (
          <>
            <span id={labelId} className="sr-only">{name}</span>
            {helpBtn}
          </>
        )}

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
                className="btn btn--icon btn--ghost btn--sm panel__close"
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
              ) : doc ? (
                <HelpDocRenderer
                  doc={doc}
                  variant="compact"
                  emptyState={
                    <p className="panel__popover-empty">
                      No help text yet for this panel.
                    </p>
                  }
                />
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
