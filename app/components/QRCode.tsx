"use client";

import { useEffect, useId, useRef, useState } from "react";
import QRCodeLib from "qrcode";

export type QRCodeLevel = "L" | "M" | "Q" | "H";
export type QRCodeRender = "svg" | "canvas";

export interface QRCodeProps {
  value: string;
  size?: number;
  render?: QRCodeRender;
  level?: QRCodeLevel;
  logo?: React.ReactNode | false;
  logoSize?: number;
  caption?: string;
  className?: string;
}

const VectorMark = ({ size }: { size: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <path
      d="M3 4 L12 20 L21 4 L17 4 L12 13 L7 4 Z"
      fill="currentColor"
    />
  </svg>
);

export default function QRCode({
  value,
  size = 256,
  render = "svg",
  level = "Q",
  logo,
  logoSize = 0.18,
  caption,
  className,
}: QRCodeProps) {
  const [svgMarkup, setSvgMarkup] = useState<string>("");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const titleId = useId();

  const cappedLogoSize = Math.min(Math.max(logoSize, 0), 0.22);
  const logoBoxPx = Math.round(size * cappedLogoSize);
  const plateBoxPx = Math.round(logoBoxPx * 1.35);

  useEffect(() => {
    if (render !== "svg") return;
    let cancelled = false;
    QRCodeLib.toString(value, {
      type: "svg",
      errorCorrectionLevel: level,
      margin: 0,
      color: { dark: "#000000", light: "#00000000" },
    })
      .then((markup) => {
        if (cancelled) return;
        const sized = markup
          .replace(/width="[^"]+"/, `width="${size}"`)
          .replace(/height="[^"]+"/, `height="${size}"`);
        setSvgMarkup(sized);
      })
      .catch(() => {
        if (!cancelled) setSvgMarkup("");
      });
    return () => {
      cancelled = true;
    };
  }, [value, size, level, render]);

  useEffect(() => {
    if (render !== "canvas") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    QRCodeLib.toCanvas(canvas, value, {
      errorCorrectionLevel: level,
      margin: 0,
      width: size,
      color: { dark: "#000000", light: "#ffffff" },
    }).catch(() => {});
  }, [value, size, level, render]);

  const showLogo = logo !== false;
  const logoContent = logo ?? <VectorMark size={Math.round(logoBoxPx * 0.7)} />;

  return (
    <div
      className={
        className ? `qr-code__Container ${className}` : "qr-code__Container"
      }
      style={{ width: size, height: size + (caption ? 20 : 0) }}
      role="img"
      aria-labelledby={caption ? titleId : undefined}
      aria-label={caption ? undefined : `QR code for ${value}`}
    >
      <div
        className="qr-code__Container_Code"
        style={{ width: size, height: size }}
      >
        {render === "svg" ? (
          <div
            className="qr-code__Container_Svg"
            dangerouslySetInnerHTML={{ __html: svgMarkup }}
          />
        ) : (
          <canvas
            ref={canvasRef}
            className="qr-code__Container_Canvas"
            width={size}
            height={size}
          />
        )}
        {showLogo && (
          <div
            className="qr-code__Container_LogoPlate"
            style={{ width: plateBoxPx, height: plateBoxPx }}
          >
            <div
              className="qr-code__Container_Logo"
              style={{ width: logoBoxPx, height: logoBoxPx }}
            >
              {logoContent}
            </div>
          </div>
        )}
      </div>
      {caption && (
        <div id={titleId} className="qr-code__Container_Caption">
          {caption}
        </div>
      )}
    </div>
  );
}
