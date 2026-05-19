"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import QRCodeLib from "qrcode";
import QRCode from "./QRCode";

interface QRCodeTriggerProps {
  value?: string;
  label?: string;
}

export default function QRCodeTrigger({ value, label }: QRCodeTriggerProps) {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState<string>("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const pathname = usePathname() ?? "";

  useEffect(() => {
    if (value) {
      setResolved(value);
      return;
    }
    if (typeof window !== "undefined") {
      // Encode origin + pathname only — strip ?query and #hash so the QR
      // stays sparse. Query params are usually transient UI state, not
      // the canonical address. Once the short-link service ships
      // (parked theme B-SHARE), this becomes /s/<slug> instead.
      const { origin, pathname: path } = window.location;
      setResolved(`${origin}${path}`);
    }
  }, [value, pathname]);

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

  const flash = (state: "copied" | "failed") => {
    setCopyState(state);
    window.setTimeout(() => setCopyState("idle"), 1400);
  };

  const renderToPngBlob = async (): Promise<Blob | null> => {
    try {
      const dataUrl = await QRCodeLib.toDataURL(resolved, {
        errorCorrectionLevel: "Q",
        margin: 1,
        width: 1024,
        color: { dark: "#000000", light: "#ffffff" },
      });
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch {
      return null;
    }
  };

  const copyImage = async () => {
    try {
      const blob = await renderToPngBlob();
      if (!blob) return flash("failed");
      const item = new ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([item]);
      flash("copied");
    } catch {
      flash("failed");
    }
  };

  const downloadPng = async () => {
    const blob = await renderToPngBlob();
    if (!blob) return flash("failed");
    triggerDownload(blob, "qr-code.png");
  };

  const downloadSvg = async () => {
    try {
      const markup = await QRCodeLib.toString(resolved, {
        type: "svg",
        errorCorrectionLevel: "Q",
        margin: 1,
        color: { dark: "#000000", light: "#ffffff" },
      });
      const blob = new Blob([markup], { type: "image/svg+xml" });
      triggerDownload(blob, "qr-code.svg");
    } catch {
      flash("failed");
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(resolved);
      flash("copied");
    } catch {
      flash("failed");
    }
  };

  return (
    <div className="qr-code__Trigger">
      <button
        ref={triggerRef}
        type="button"
        className="qr-code__Trigger_Button"
        aria-label={label ?? "Show QR code for this page"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        {resolved && (
          <span className="qr-code__Trigger_Frame">
            <span className="qr-code__Trigger_Code">
              <QRCode value={resolved} size={36} level="Q" logo={false} />
            </span>
            <span className="qr-code__Trigger_Caption">Share me</span>
          </span>
        )}
      </button>
      {open && resolved && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Page QR code"
          className="qr-code__Popover"
        >
          <div className="qr-code__Popover_CodeWrap">
            <QRCode value={resolved} size={256} level="Q" />
          </div>
          <div className="qr-code__Popover_Url" title={resolved}>
            {resolved}
          </div>
          <div className="qr-code__Popover_Actions">
            <button
              type="button"
              className="btn btn-ghost qr-code__Popover_Action"
              onClick={copyImage}
            >
              Copy image
            </button>
            <button
              type="button"
              className="btn btn-ghost qr-code__Popover_Action"
              onClick={downloadPng}
            >
              Download PNG
            </button>
            <button
              type="button"
              className="btn btn-ghost qr-code__Popover_Action"
              onClick={downloadSvg}
            >
              Download SVG
            </button>
            <button
              type="button"
              className="btn btn-ghost qr-code__Popover_Action"
              onClick={copyLink}
            >
              Copy link
            </button>
          </div>
          {copyState !== "idle" && (
            <div
              className={`qr-code__Popover_Status qr-code__Popover_Status-${copyState}`}
              role="status"
              aria-live="polite"
            >
              {copyState === "copied" ? "Copied" : "Action failed"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
