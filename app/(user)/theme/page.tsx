"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";
import { useThemePack, type ThemePack } from "@/app/hooks/useThemePack";
import { useTheme } from "@/app/hooks/useTheme";

type Status = "exposed" | "new-token" | "future";

interface Artefact {
  section: string;
  control: string;
  token: string;
  light: string;
  dark: string;
  status: Status;
  notes?: string;
}

const ARTEFACTS: Artefact[] = [
  // Section 1 — Surfaces & layout
  { section: "Surfaces", control: "Page background", token: "--bg", light: "var(--cream) = #f5f3ee", dark: "#1f1f1f", status: "exposed" },
  { section: "Surfaces", control: "Panel background", token: "--surface", light: "#f0eee9", dark: "#2a2a2a", status: "exposed" },
  { section: "Surfaces", control: "Panel hover / header bg", token: "--surface-alt", light: "#e8e5de", dark: "#3a3a3a", status: "exposed" },
  { section: "Surfaces", control: "Border (panels, dividers)", token: "--line-1", light: "#e5e7eb", dark: "#3a3a3a", status: "exposed" },
  { section: "Surfaces", control: "Subtle border", token: "--line-2", light: "#d1d5db", dark: "#4a4a4a", status: "exposed" },
  { section: "Surfaces", control: "Corner radius small", token: "--radius-sm", light: "0", dark: "0", status: "exposed" },
  { section: "Surfaces", control: "Corner radius medium", token: "--radius-md", light: "0", dark: "0", status: "exposed" },
  { section: "Surfaces", control: "Paper (auth cards)", token: "--paper", light: "#fffefa", dark: "#fffefa", status: "exposed", notes: "Shared across themes today" },

  // Section 2 — Text
  { section: "Text", control: "Body text", token: "--ink-1", light: "#1f1f1f", dark: "#ffffff", status: "exposed" },
  { section: "Text", control: "Secondary text", token: "--ink-2", light: "#4a4a4a", dark: "#e5e5e5", status: "exposed" },
  { section: "Text", control: "Muted text", token: "--ink-3", light: "#9ca3af", dark: "#9ca3af", status: "exposed" },
  { section: "Text", control: "Disabled / faint text", token: "--ink-4", light: "#c0c0c0", dark: "#6b7280", status: "exposed" },
  { section: "Text", control: "Body font family", token: "--font-sans", light: "Inter", dark: "Inter", status: "exposed", notes: "Injected via next/font" },
  { section: "Text", control: "Mono font family", token: "--font-mono", light: "JetBrains Mono", dark: "JetBrains Mono", status: "exposed" },
  { section: "Text", control: "Display font family", token: "--font-display", light: "Inter", dark: "Inter", status: "exposed" },
  { section: "Text", control: "H1 color / family / weight / size", token: "(new per-heading vars)", light: "—", dark: "—", status: "new-token", notes: "Paper specifies H1-H5 with 4 properties each" },
  { section: "Text", control: "H2 color / family / weight / size", token: "(new per-heading vars)", light: "—", dark: "—", status: "new-token" },
  { section: "Text", control: "H3 color / family / weight / size", token: "(new per-heading vars)", light: "—", dark: "—", status: "new-token" },
  { section: "Text", control: "H4 color / family / weight / size", token: "(new per-heading vars)", light: "—", dark: "—", status: "new-token" },
  { section: "Text", control: "H5 color / family / weight / size", token: "(new per-heading vars)", light: "—", dark: "—", status: "new-token" },

  // Section 3 — Navigation
  { section: "Navigation", control: "Sidebar width", token: "--sidebar-width", light: "220px", dark: "220px", status: "exposed" },
  { section: "Navigation", control: "Sidebar width (collapsed)", token: "--sidebar-width-collapsed", light: "64px", dark: "64px", status: "exposed" },
  { section: "Navigation", control: "Sidebar background", token: "--sidebar-bg", light: "—", dark: "—", status: "new-token", notes: "Currently transparent" },
  { section: "Navigation", control: "Nav link color", token: "--nav-link", light: "—", dark: "—", status: "new-token", notes: "Today inherits from .sidebar-item" },
  { section: "Navigation", control: "Nav link hover bg", token: "--nav-item-hover-bg", light: "#cccccc", dark: "#cccccc", status: "exposed", notes: "Declared in phase 0" },
  { section: "Navigation", control: "Nav link hover color", token: "--nav-link-hover", light: "—", dark: "—", status: "new-token" },
  { section: "Navigation", control: "Nav link active bg", token: "--nav-item-active-bg", light: "#cccccc", dark: "#cccccc", status: "exposed", notes: "Declared in phase 0" },
  { section: "Navigation", control: "Nav link active color", token: "--nav-link-active", light: "—", dark: "—", status: "new-token" },
  { section: "Navigation", control: "Nav group heading color", token: "--nav-group-heading", light: "—", dark: "—", status: "new-token", notes: "Currently var(--hot-pink)" },
  { section: "Navigation", control: "Nav icon color", token: "--nav-icon-color", light: "—", dark: "—", status: "new-token", notes: "Currently inherits currentColor" },

  // Section 4 — Forms & buttons
  { section: "Forms & buttons", control: "Input background", token: "--form-input-bg", light: "—", dark: "—", status: "new-token", notes: "Today var(--surface)" },
  { section: "Forms & buttons", control: "Input text", token: "--form-input-text", light: "—", dark: "—", status: "new-token", notes: "Today var(--ink-1)" },
  { section: "Forms & buttons", control: "Input border", token: "--line-1", light: "#e5e7eb", dark: "#3a3a3a", status: "exposed" },
  { section: "Forms & buttons", control: "Input focus border", token: "--accent-border", light: "rgba(163,230,53,0.5)", dark: "rgba(163,230,53,0.5)", status: "exposed" },
  { section: "Forms & buttons", control: "Primary button bg", token: "--accent", light: "#a3e635", dark: "#a3e635", status: "exposed" },
  { section: "Forms & buttons", control: "Primary button text", token: "--accent-ink", light: "#7d9d1a", dark: "#a3e635", status: "exposed" },
  { section: "Forms & buttons", control: "Primary button hover bg / text", token: "(new)", light: "—", dark: "—", status: "new-token" },
  { section: "Forms & buttons", control: "Secondary button bg / text / hover", token: "(new)", light: "—", dark: "—", status: "new-token" },

  // Section 5 — Brand accents
  { section: "Brand", control: "Accent colour", token: "--accent", light: "#a3e635", dark: "#a3e635", status: "exposed" },
  { section: "Brand", control: "Accent (soft tint)", token: "--accent-soft", light: "rgba(163,230,53,0.1)", dark: "rgba(163,230,53,0.1)", status: "exposed" },
  { section: "Brand", control: "Pink accent", token: "--hot-pink", light: "#ec4899", dark: "#ec4899", status: "exposed", notes: "Shared across themes" },
  { section: "Brand", control: "+++ divider colour", token: "--divider-prefix", light: "—", dark: "—", status: "new-token", notes: "Currently var(--hot-pink)" },

  // Semantic
  { section: "Semantic", control: "Good / success", token: "--good", light: "#10b981", dark: "#10b981", status: "exposed" },
  { section: "Semantic", control: "Warning", token: "--warn", light: "#f59e0b", dark: "#f59e0b", status: "exposed" },
  { section: "Semantic", control: "Error", token: "--error", light: "#ef4444", dark: "#ef4444", status: "exposed" },

  // Layout
  { section: "Layout", control: "App header height", token: "--app-header-wrapper-height", light: "77px", dark: "77px", status: "exposed" },

  // Future candidates (beyond the paper)
  { section: "Future candidates", control: "Base body font-size", token: "(new --font-size-base)", light: "14px", dark: "14px", status: "future", notes: "Would cascade through rem-based sizes" },
  { section: "Future candidates", control: "Line-height density (compact/cosy/spacious)", token: "(new --density scale)", light: "—", dark: "—", status: "future", notes: "Paper defers to v2" },
  { section: "Future candidates", control: "Transition speed", token: "(new --motion-fast / --motion-medium)", light: "0.15s / 0.25s", dark: "0.15s / 0.25s", status: "future", notes: "Hardcoded throughout today" },
  { section: "Future candidates", control: "Focus ring color / width", token: "(new --focus-ring)", light: "—", dark: "—", status: "future", notes: "Uses accent-border today" },
  { section: "Future candidates", control: "Scrollbar color / width", token: "(new --scrollbar-*)", light: "—", dark: "—", status: "future", notes: "Browser default today" },
  { section: "Future candidates", control: "Elevation / shadow tiers", token: "(new --elevation-1/2/3)", light: "—", dark: "—", status: "future", notes: "App is flat today — would need to add usages" },
  { section: "Future candidates", control: "Link color + hover underline", token: "(new --link / --link-hover)", light: "—", dark: "—", status: "future" },
  { section: "Future candidates", control: "Code block bg / ink", token: "(new --code-bg / --code-ink)", light: "—", dark: "—", status: "future" },
  { section: "Future candidates", control: "Toast / notification palette", token: "(new --toast-*)", light: "—", dark: "—", status: "future", notes: "Would ride on --good / --warn / --error" },
  { section: "Future candidates", control: "Page content max-width", token: "(new --page-max-width)", light: "—", dark: "—", status: "future", notes: "For reading-width lock" },
];

const STATUS_LABEL: Record<Status, string> = {
  exposed: "Exposed",
  "new-token": "New token (paper)",
  future: "Future candidate",
};

type MakerMode = "seed" | "image" | "preset";

interface Preset {
  name: string;
  seed: string;
}

const PRESETS: Preset[] = [
  { name: "Royal Blue", seed: "#3B82F6" },
  { name: "Emerald", seed: "#10B981" },
  { name: "Rose", seed: "#F43F5E" },
  { name: "Amber", seed: "#F59E0B" },
  { name: "Violet", seed: "#8B5CF6" },
  { name: "Slate", seed: "#64748B" },
];

// Lightness steps for the 10-column shade scale: seed at L≈60 on the left,
// descending roughly linearly to near-black on the right. Tuned by eye
// against the reference image (#3B82F6 → #000A1A).
const SHADE_LIGHTNESS = [60, 52, 46, 40, 34, 28, 22, 16, 10, 5] as const;

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const s = m[1];
  const full = s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rr: h = ((gg - bb) / d + (gg < bb ? 6 : 0)); break;
      case gg: h = ((bb - rr) / d + 2); break;
      default: h = ((rr - gg) / d + 4);
    }
    h *= 60;
  }
  return [h, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = clamp01(s / 100);
  const lig = clamp01(l / 100);
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * lig - 1)) * sat;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) { r = c; g = x; b = 0; }
  else if (hp < 2) { r = x; g = c; b = 0; }
  else if (hp < 3) { r = 0; g = c; b = x; }
  else if (hp < 4) { r = 0; g = x; b = c; }
  else if (hp < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const m = lig - c / 2;
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function shadesFromSeed(hex: string): string[] {
  const rgb = hexToRgb(hex);
  if (!rgb) return Array(10).fill(hex);
  const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return SHADE_LIGHTNESS.map((l) => hslToHex(h, s, l));
}

function ColourSelection({
  shades,
  seedName,
}: {
  shades: string[];
  seedName: string;
}) {
  return (
    <section className="theme-panel" aria-label="Colour selection">
      <header className="theme-panel__header">
        <h2 className="theme-panel__title">
          COLOUR SELECTION
          <span className="theme-panel__count">{seedName}</span>
        </h2>
      </header>
      <div className="theme-swatch-row" role="list" aria-label="Colour shades">
        {shades.map((hex, i) => (
          <div
            key={`${i}-${hex}`}
            role="listitem"
            className="theme-swatch"
            style={{ background: hex }}
            title={hex}
            aria-label={hex}
          />
        ))}
      </div>
    </section>
  );
}

function MakerPanel({
  seed,
  setSeed,
  mode,
  setMode,
}: {
  seed: string;
  setSeed: (hex: string) => void;
  mode: MakerMode;
  setMode: (m: MakerMode) => void;
}) {
  const [hexInput, setHexInput] = useState(seed);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const commitHex = (v: string) => {
    setHexInput(v);
    if (hexToRgb(v)) setSeed(v.toUpperCase());
  };

  const onFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const scale = 64 / Math.max(img.width, img.height);
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) { URL.revokeObjectURL(url); return; }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      // Naive dominant-colour: average of non-transparent pixels, biased
      // toward the most saturated quartile so the seed isn't muddy grey.
      let totalR = 0, totalG = 0, totalB = 0, count = 0;
      const samples: Array<[number, number, number, number]> = [];
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3]; if (a < 128) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        samples.push([r, g, b, sat]);
      }
      samples.sort((a, b) => b[3] - a[3]);
      const keep = samples.slice(0, Math.max(1, Math.floor(samples.length * 0.25)));
      for (const [r, g, b] of keep) { totalR += r; totalG += g; totalB += b; count++; }
      if (count) {
        const r = Math.round(totalR / count);
        const g = Math.round(totalG / count);
        const b = Math.round(totalB / count);
        const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
        setSeed(hex);
        setHexInput(hex);
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  return (
    <section className="theme-panel theme-maker" aria-label="Theme maker">
      <header className="theme-panel__header">
        <h2 className="theme-panel__title">THEME MAKER</h2>
        <div className="theme-maker__modes" role="tablist" aria-label="Input mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "seed"}
            className={`theme-maker__mode ${mode === "seed" ? "theme-maker__mode--active" : ""}`}
            onClick={() => setMode("seed")}
          >
            Seed colour
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "image"}
            className={`theme-maker__mode ${mode === "image" ? "theme-maker__mode--active" : ""}`}
            onClick={() => setMode("image")}
          >
            From image
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "preset"}
            className={`theme-maker__mode ${mode === "preset" ? "theme-maker__mode--active" : ""}`}
            onClick={() => setMode("preset")}
          >
            Presets
          </button>
        </div>
      </header>

      {mode === "seed" && (
        <div className="theme-maker__body theme-maker__body--seed">
          <label className="theme-maker__swatch" style={{ background: seed }}>
            <input
              type="color"
              value={seed}
              onChange={(e) => commitHex(e.target.value)}
              aria-label="Pick seed colour"
            />
          </label>
          <div className="theme-maker__field">
            <span className="theme-maker__field-label">Seed hex</span>
            <input
              type="text"
              className="form__input theme-maker__hex"
              value={hexInput}
              onChange={(e) => setHexInput(e.target.value)}
              onBlur={(e) => commitHex(e.target.value)}
              placeholder="#3B82F6"
              spellCheck={false}
            />
          </div>
          <div className="theme-maker__quick" role="group" aria-label="Quick pick">
            <span className="theme-maker__field-label">Quick pick</span>
            <div className="theme-maker__quick-row">
              {PRESETS.map((p) => (
                <button
                  key={p.seed}
                  type="button"
                  className="theme-maker__quick-swatch"
                  style={{ background: p.seed }}
                  title={`${p.name} — ${p.seed}`}
                  aria-label={`${p.name} — ${p.seed}`}
                  onClick={() => { setSeed(p.seed); setHexInput(p.seed); }}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {mode === "image" && (
        <div className="theme-maker__body theme-maker__body--image">
          <div className="theme-maker__dropzone">
            <p className="theme-maker__dropzone-lead">Upload an image or logo</p>
            <p className="theme-maker__dropzone-sub">We&apos;ll extract its dominant colour and seed the palette.</p>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => fileRef.current?.click()}
            >
              Choose file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onFilePicked}
              style={{ display: "none" }}
              aria-label="Upload image for palette extraction"
            />
          </div>
        </div>
      )}

      {mode === "preset" && (
        <div className="theme-maker__body theme-maker__body--preset">
          <div className="theme-maker__preset-grid">
            {PRESETS.map((p) => {
              const gradient = shadesFromSeed(p.seed).join(", ");
              const active = p.seed.toUpperCase() === seed.toUpperCase();
              return (
                <button
                  key={p.seed}
                  type="button"
                  className={`theme-maker__preset ${active ? "theme-maker__preset--active" : ""}`}
                  onClick={() => { setSeed(p.seed); setHexInput(p.seed); }}
                >
                  <span
                    className="theme-maker__preset-strip"
                    style={{ background: `linear-gradient(to right, ${gradient})` }}
                    aria-hidden="true"
                  />
                  <span className="theme-maker__preset-name">{p.name}</span>
                  <span className="theme-maker__preset-hex">{p.seed}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

// ─── Theme token data ────────────────────────────────────────────────────────
// Key resolved values extracted from /public/themes/*.css (first :root block).
// Used to render isolated preview cards without loading pack CSS globally.
interface ThemeTokens {
  canvas: string;
  surface: string;
  surfaceSunken: string;
  ink: string;
  inkMuted: string;
  inkContrast: string;
  border: string;
  accent: string;
  navHover: string;
}

interface ThemeEntry {
  id: ThemePack;
  label: string;
  description: string;
  keywords: string[];
  swatches: [string, string, string, string];
  tokens: ThemeTokens;
  darkTokens?: ThemeTokens;
}

const THEMES: ThemeEntry[] = [
  {
    id: "default",
    label: "Default",
    description: "Warm neutrals — the current Vector look across the app.",
    keywords: ["warm", "neutral", "cream", "default", "light"],
    swatches: ["#FFFFFF", "#EDEAE4", "#1A1A1A", "#E5E1DA"],
    tokens: { canvas:"#FFFFFF", surface:"#FFFFFF", surfaceSunken:"#EDEAE4", ink:"#1A1A1A", inkMuted:"rgba(92,92,92,0.75)", inkContrast:"#FFFFFF", border:"#E5E1DA", accent:"#1A1A1A", navHover:"#EDEAE4" },
    darkTokens: { canvas:"#1A1816", surface:"#232120", surfaceSunken:"#1F1D1B", ink:"#F4F2EE", inkMuted:"#B0ADA6", inkContrast:"#1A1816", border:"#2E2B28", accent:"#F4F2EE", navHover:"#1F1D1B" },
  },
  {
    id: "vector-mono",
    label: "Vector Mono",
    description: "Strict palette: hot pink, black, page gray, secondary gray.",
    keywords: ["pink", "black", "gray", "mono", "dark", "bold"],
    swatches: ["#FF346E", "#000000", "#C9CACF", "#ACAFBA"],
    tokens: { canvas:"#C9CACF", surface:"#C9CACF", surfaceSunken:"#ACAFBA", ink:"#000000", inkMuted:"rgba(0,0,0,0.65)", inkContrast:"#FFFFFF", border:"#000000", accent:"#FF346E", navHover:"#FF346E" },
    darkTokens: { canvas:"#000000", surface:"#1A1A1A", surfaceSunken:"#ACAFBA", ink:"#FFFFFF", inkMuted:"rgba(255,255,255,0.72)", inkContrast:"#000000", border:"#FFFFFF", accent:"#FF346E", navHover:"#FF346E" },
  },
  {
    id: "charcoal-amber",
    label: "Charcoal Amber",
    description: "Editorial dark palette: vivid amber, warm cream, charcoal canvas, pure-black header band.",
    keywords: ["amber", "charcoal", "dark", "editorial", "warm"],
    swatches: ["#E8A437", "#ECE2C8", "#2A2C2E", "#000000"],
    tokens: { canvas:"#ECE2C8", surface:"#ECE2C8", surfaceSunken:"#D5C9A8", ink:"#2A2C2E", inkMuted:"rgba(42,44,46,0.65)", inkContrast:"#ECE2C8", border:"#2A2C2E", accent:"#E8A437", navHover:"#E8A437" },
    darkTokens: { canvas:"#2A2C2E", surface:"#2A2C2E", surfaceSunken:"#000000", ink:"#ECE2C8", inkMuted:"rgba(236,226,200,0.78)", inkContrast:"#2A2C2E", border:"#ECE2C8", accent:"#E8A437", navHover:"#E8A437" },
  },
  {
    id: "vector-marine",
    label: "Vector Marine",
    description: "Warm rose canvas with midnight-teal ink and a vivid lime-zing priority highlight.",
    keywords: ["marine", "lime", "teal", "rose", "green", "nautical"],
    swatches: ["#B3F938", "#082429", "#ECD5C5", "#CED9D9"],
    tokens: { canvas:"#ECD5C5", surface:"#ECD5C5", surfaceSunken:"#CED9D9", ink:"#082429", inkMuted:"rgba(8,36,41,0.65)", inkContrast:"#FFFEF3", border:"#082429", accent:"#B3F938", navHover:"#B3F938" },
    darkTokens: { canvas:"#082429", surface:"#0E454E", surfaceSunken:"#1A6671", ink:"#FFFEF3", inkMuted:"rgba(255,254,243,0.78)", inkContrast:"#082429", border:"#FFFEF3", accent:"#B3F938", navHover:"#B3F938" },
  },
  {
    id: "atlas",
    label: "Atlas",
    description: "Customer-journey palette: green accent on white canvas, deep-navy attention tone.",
    keywords: ["green", "white", "navy", "clean", "light", "atlas"],
    swatches: ["#5FA547", "#1F3D8E", "#FFFFFF", "#D6D8DA"],
    tokens: { canvas:"#FFFFFF", surface:"#FFFFFF", surfaceSunken:"#D6D8DA", ink:"#000000", inkMuted:"rgba(0,0,0,0.65)", inkContrast:"#FFFFFF", border:"#000000", accent:"#5FA547", navHover:"#5FA547" },
    darkTokens: { canvas:"#000000", surface:"#1A1A1A", surfaceSunken:"#2A2A2A", ink:"#FFFFFF", inkMuted:"rgba(255,255,255,0.72)", inkContrast:"#000000", border:"#FFFFFF", accent:"#5FA547", navHover:"#5FA547" },
  },
  {
    id: "coral-tide",
    label: "Coral Tide",
    description: "Warm coral accent meeting deep-teal ink across cool grey neutrals.",
    keywords: ["coral", "teal", "grey", "coastal", "light"],
    swatches: ["#FF6A5B", "#064A60", "#EAEAEA", "#CDCDCD"],
    tokens: { canvas:"#EAEAEA", surface:"#EAEAEA", surfaceSunken:"#CDCDCD", ink:"#064A60", inkMuted:"rgba(6,74,96,0.75)", inkContrast:"#FFFFFF", border:"#064A60", accent:"#FF6A5B", navHover:"#FF6A5B" },
    darkTokens: { canvas:"#064A60", surface:"#064A60", surfaceSunken:"#032E3F", ink:"#FFFFFF", inkMuted:"rgba(255,255,255,0.75)", inkContrast:"#064A60", border:"#FFFFFF", accent:"#FF6A5B", navHover:"#FF6A5B" },
  },
  {
    id: "slate",
    label: "Slate",
    description: "Cool monochromatic palette: deep slate-navy ink doubles as accent, sage and pale-lavender surfaces.",
    keywords: ["slate", "navy", "blue", "cool", "mono", "lavender"],
    swatches: ["#2C3E50", "#778899", "#DFE3EE", "#A2B9BC"],
    tokens: { canvas:"#DFE3EE", surface:"#DFE3EE", surfaceSunken:"#A2B9BC", ink:"#2C3E50", inkMuted:"rgba(44,62,80,0.85)", inkContrast:"#DFE3EE", border:"#2C3E50", accent:"#2C3E50", navHover:"#2C3E50" },
    darkTokens: { canvas:"#2C3E50", surface:"#2C3E50", surfaceSunken:"#778899", ink:"#DFE3EE", inkMuted:"rgba(223,227,238,0.78)", inkContrast:"#2C3E50", border:"#DFE3EE", accent:"#DFE3EE", navHover:"#DFE3EE" },
  },
  {
    id: "harbor",
    label: "Harbor",
    description: "Nautical infographic palette: warm cream canvas, deep navy ink, terracotta orange accent.",
    keywords: ["harbor", "nautical", "cream", "navy", "terracotta", "orange"],
    swatches: ["#DD6A3C", "#26333E", "#F2EAD6", "#D3CEBF"],
    tokens: { canvas:"#F2EAD6", surface:"#F2EAD6", surfaceSunken:"#D3CEBF", ink:"#26333E", inkMuted:"rgba(38,51,62,0.78)", inkContrast:"#F2EAD6", border:"#26333E", accent:"#DD6A3C", navHover:"#DD6A3C" },
    darkTokens: { canvas:"#26333E", surface:"#26333E", surfaceSunken:"#1F6F87", ink:"#F2EAD6", inkMuted:"rgba(242,234,214,0.78)", inkContrast:"#26333E", border:"#F2EAD6", accent:"#DD6A3C", navHover:"#DD6A3C" },
  },
  {
    id: "dusk-mauve",
    label: "Dusk Mauve",
    description: "Soft monochrome palette: pale pink-lavender canvas, near-black navy ink, mauve highlight.",
    keywords: ["mauve", "lavender", "pink", "purple", "soft", "dusk"],
    swatches: ["#B080B4", "#161A2F", "#DDC8D8", "#9AB0D0"],
    tokens: { canvas:"#DDC8D8", surface:"#DDC8D8", surfaceSunken:"#9AB0D0", ink:"#161A2F", inkMuted:"rgba(22,26,47,0.70)", inkContrast:"#FFFFFF", border:"#161A2F", accent:"#B080B4", navHover:"#B080B4" },
    darkTokens: { canvas:"#161A2F", surface:"#161A2F", surfaceSunken:"#1A2348", ink:"#FFFFFF", inkMuted:"rgba(255,255,255,0.75)", inkContrast:"#161A2F", border:"#FFFFFF", accent:"#B080B4", navHover:"#B080B4" },
  },
  {
    id: "sea-glass",
    label: "Sea Glass",
    description: "Soft pastel coastal palette: mint canvas, deep-sage ink, light-blue priority highlight.",
    keywords: ["mint", "sage", "blue", "pastel", "coastal", "green"],
    swatches: ["#99CDD8", "#475048", "#DAEBE3", "#CFD6C4"],
    tokens: { canvas:"#DAEBE3", surface:"#DAEBE3", surfaceSunken:"#CFD6C4", ink:"#475048", inkMuted:"rgba(71,80,72,0.70)", inkContrast:"#FDE8D3", border:"#475048", accent:"#99CDD8", navHover:"#99CDD8" },
    darkTokens: { canvas:"#2D3631", surface:"#475048", surfaceSunken:"#5A6660", ink:"#FDE8D3", inkMuted:"rgba(253,232,211,0.78)", inkContrast:"#2D3631", border:"#FDE8D3", accent:"#99CDD8", navHover:"#99CDD8" },
  },
  {
    id: "vesper",
    label: "Vesper",
    description: "Twilight palette: blush canvas, midnight-purple ink, warm orange highlight.",
    keywords: ["twilight", "blush", "purple", "orange", "warm", "evening"],
    swatches: ["#EB9F5A", "#1D0A39", "#DBBCB9", "#C4A7AA"],
    tokens: { canvas:"#DBBCB9", surface:"#DBBCB9", surfaceSunken:"#C4A7AA", ink:"#1D0A39", inkMuted:"rgba(29,10,57,0.65)", inkContrast:"#FFFFFF", border:"#1D0A39", accent:"#EB9F5A", navHover:"#EB9F5A" },
    darkTokens: { canvas:"#1D0A39", surface:"#1D0A39", surfaceSunken:"#461952", ink:"#DBBCB9", inkMuted:"rgba(219,188,185,0.72)", inkContrast:"#1D0A39", border:"#DBBCB9", accent:"#EB9F5A", navHover:"#EB9F5A" },
  },
  {
    id: "dusk-slate",
    label: "Dusk Slate",
    description: "Monochromatic blue-gray-mauve palette: light neutral canvas, near-black navy ink.",
    keywords: ["slate", "blue", "gray", "mauve", "neutral", "dusk"],
    swatches: ["#5C707A", "#181D23", "#DCDCDC", "#A89DAB"],
    tokens: { canvas:"#DCDCDC", surface:"#DCDCDC", surfaceSunken:"#A89DAB", ink:"#181D23", inkMuted:"rgba(24,29,35,0.65)", inkContrast:"#FFFFFF", border:"#181D23", accent:"#5C707A", navHover:"#5C707A" },
    darkTokens: { canvas:"#181D23", surface:"#2C3D44", surfaceSunken:"#A89DAB", ink:"#DCDCDC", inkMuted:"rgba(220,220,220,0.72)", inkContrast:"#181D23", border:"#DCDCDC", accent:"#83919F", navHover:"#83919F" },
  },
  {
    id: "sundown",
    label: "Sundown",
    description: "Warm-pop on cool canvas: pale sky-blue surface, deep navy ink, vivid orange accent.",
    keywords: ["sundown", "orange", "sky", "blue", "navy", "warm"],
    swatches: ["#E1762E", "#10314A", "#A6CDD8", "#88AEBC"],
    tokens: { canvas:"#A6CDD8", surface:"#A6CDD8", surfaceSunken:"#88AEBC", ink:"#10314A", inkMuted:"rgba(16,49,74,0.78)", inkContrast:"#A6CDD8", border:"#10314A", accent:"#E1762E", navHover:"#E1762E" },
    darkTokens: { canvas:"#10314A", surface:"#10314A", surfaceSunken:"#5E6F7C", ink:"#E9C588", inkMuted:"rgba(233,197,136,0.78)", inkContrast:"#10314A", border:"#E9C588", accent:"#E1762E", navHover:"#E1762E" },
  },
  {
    id: "vector-bloom",
    label: "Vector Bloom",
    description: "Soft floral palette: cream canvas, pale lavender header band, raspberry accent.",
    keywords: ["floral", "cream", "lavender", "raspberry", "pink", "bloom"],
    swatches: ["#C9495F", "#2E3340", "#F5F0E8", "#EDE7EC"],
    tokens: { canvas:"#F5F0E8", surface:"#F5F0E8", surfaceSunken:"#EDE7EC", ink:"#2E3340", inkMuted:"rgba(46,51,64,0.70)", inkContrast:"#FFFFFF", border:"#5C6479", accent:"#C9495F", navHover:"#C9495F" },
    darkTokens: { canvas:"#1A1D26", surface:"#252934", surfaceSunken:"#5C6479", ink:"#F5F0E8", inkMuted:"rgba(245,240,232,0.72)", inkContrast:"#1A1D26", border:"#F5F0E8", accent:"#C9495F", navHover:"#C9495F" },
  },
  {
    id: "tideline",
    label: "Tideline",
    description: "Coastal palette: pale sky-blue canvas, near-black warm ink, vivid coral-orange accent.",
    keywords: ["coastal", "sky", "blue", "coral", "orange", "warm"],
    swatches: ["#EE9763", "#080807", "#CDEDF7", "#6F7C72"],
    tokens: { canvas:"#CDEDF7", surface:"#CDEDF7", surfaceSunken:"#6F7C72", ink:"#080807", inkMuted:"rgba(8,8,7,0.65)", inkContrast:"#FFFFFF", border:"#080807", accent:"#EE9763", navHover:"#EE9763" },
    darkTokens: { canvas:"#080807", surface:"#3D3431", surfaceSunken:"#6F7C72", ink:"#CDEDF7", inkMuted:"rgba(205,237,247,0.72)", inkContrast:"#080807", border:"#CDEDF7", accent:"#EE9763", navHover:"#EE9763" },
  },
  {
    id: "sorbet",
    label: "Sorbet",
    description: "Bright pastel palette: white canvas, blush header band, warm-orange accent.",
    keywords: ["sorbet", "pastel", "white", "blush", "orange", "light"],
    swatches: ["#E89236", "#1A1A1A", "#FFFFFF", "#F0D5DA"],
    tokens: { canvas:"#FFFFFF", surface:"#FFFFFF", surfaceSunken:"#F0D5DA", ink:"#1A1A1A", inkMuted:"rgba(26,26,26,0.65)", inkContrast:"#FFFFFF", border:"#1A1A1A", accent:"#E89236", navHover:"#E89236" },
    darkTokens: { canvas:"#1A1A1A", surface:"#1A1A1A", surfaceSunken:"#2E1820", ink:"#FFFFFF", inkMuted:"rgba(255,255,255,0.72)", inkContrast:"#1A1A1A", border:"#FFFFFF", accent:"#E89236", navHover:"#E89236" },
  },
  {
    id: "mesa",
    label: "Mesa",
    description: "Desert-landscape palette: pale ivory canvas, deep maroon ink, copper accent.",
    keywords: ["desert", "mesa", "copper", "maroon", "ivory", "warm"],
    swatches: ["#C5764A", "#5C2A1B", "#DDDDD8", "#A6B0BC"],
    tokens: { canvas:"#DDDDD8", surface:"#DDDDD8", surfaceSunken:"#A6B0BC", ink:"#5C2A1B", inkMuted:"rgba(92,42,27,0.78)", inkContrast:"#DDDDD8", border:"#5C2A1B", accent:"#C5764A", navHover:"#C5764A" },
    darkTokens: { canvas:"#5C2A1B", surface:"#5C2A1B", surfaceSunken:"#764E41", ink:"#DDDDD8", inkMuted:"rgba(221,221,216,0.78)", inkContrast:"#5C2A1B", border:"#DDDDD8", accent:"#C5764A", navHover:"#C5764A" },
  },
  {
    id: "oyster",
    label: "Oyster",
    description: "Architectural greyscale palette: warm cream canvas, silver surface-sunken, deep navy-charcoal ink.",
    keywords: ["oyster", "grey", "cream", "silver", "charcoal", "neutral"],
    swatches: ["#7C746C", "#2D3540", "#F2EEE8", "#D2D5D8"],
    tokens: { canvas:"#F2EEE8", surface:"#F2EEE8", surfaceSunken:"#D2D5D8", ink:"#2D3540", inkMuted:"rgba(45,53,64,0.72)", inkContrast:"#FFFFFF", border:"#2D3540", accent:"#7C746C", navHover:"#7C746C" },
    darkTokens: { canvas:"#2D3540", surface:"#2D3540", surfaceSunken:"#3A424E", ink:"#FFFFFF", inkMuted:"rgba(255,255,255,0.75)", inkContrast:"#2D3540", border:"#FFFFFF", accent:"#7C746C", navHover:"#7C746C" },
  },
  {
    id: "kelp",
    label: "Kelp",
    description: "Marine ramp palette: lime canvas, navy ink, bright-cyan priority highlight.",
    keywords: ["kelp", "lime", "green", "navy", "marine", "teal"],
    swatches: ["#5BC4BD", "#1A3D54", "#A6E891", "#7DDBA8"],
    tokens: { canvas:"#A6E891", surface:"#A6E891", surfaceSunken:"#7DDBA8", ink:"#1A3D54", inkMuted:"rgba(26,61,84,0.70)", inkContrast:"#A6E891", border:"#1A3D54", accent:"#5BC4BD", navHover:"#5BC4BD" },
    darkTokens: { canvas:"#1A3D54", surface:"#1F6168", surfaceSunken:"#3F8E91", ink:"#A6E891", inkMuted:"rgba(166,232,145,0.78)", inkContrast:"#1A3D54", border:"#A6E891", accent:"#5BC4BD", navHover:"#5BC4BD" },
  },
  {
    id: "linen",
    label: "Linen",
    description: "Soft warm-and-cool neutrals: warm off-white canvas, medium-warm-gray accent.",
    keywords: ["linen", "warm", "neutral", "grey", "soft", "minimal"],
    swatches: ["#B8B5B0", "#2A2925", "#EDECE9", "#D5D7DB"],
    tokens: { canvas:"#EDECE9", surface:"#EDECE9", surfaceSunken:"#D5D7DB", ink:"#2A2925", inkMuted:"rgba(42,41,37,0.70)", inkContrast:"#EDECE9", border:"#2A2925", accent:"#B8B5B0", navHover:"#B8B5B0" },
    darkTokens: { canvas:"#2A2925", surface:"#3A3833", surfaceSunken:"#4A4842", ink:"#EDECE9", inkMuted:"rgba(237,236,233,0.80)", inkContrast:"#2A2925", border:"#EDECE9", accent:"#B8B5B0", navHover:"#B8B5B0" },
  },
  {
    id: "meadow-pop",
    label: "Meadow Pop",
    description: "Garden-bloom palette: raspberry-pink accent and chartreuse pop on a pale-mint canvas.",
    keywords: ["meadow", "raspberry", "pink", "mint", "green", "bright"],
    swatches: ["#D85072", "#1B313D", "#BFE0BC", "#ABCBAD"],
    tokens: { canvas:"#BFE0BC", surface:"#BFE0BC", surfaceSunken:"#ABCBAD", ink:"#1B313D", inkMuted:"rgba(27,49,61,0.65)", inkContrast:"#FFFFFF", border:"#1B313D", accent:"#D85072", navHover:"#D85072" },
    darkTokens: { canvas:"#1B313D", surface:"#1B313D", surfaceSunken:"#2F464C", ink:"#BFE0BC", inkMuted:"rgba(191,224,188,0.72)", inkContrast:"#000000", border:"#BFE0BC", accent:"#D85072", navHover:"#D85072" },
  },
  {
    id: "cobalt-lime",
    label: "Cobalt Lime",
    description: "Dark cobalt-ink canvas with electric lime-yellow accent — maximum contrast dark theme.",
    keywords: ["cobalt", "lime", "yellow", "dark", "electric", "bold"],
    swatches: ["#D0F040", "#080810", "#080810", "#161C35"],
    tokens: { canvas:"#EEF4FA", surface:"#EEF4FA", surfaceSunken:"#C8DFF0", ink:"#0A0C14", inkMuted:"rgba(10,12,20,0.68)", inkContrast:"#EEF4FA", border:"#0A0C14", accent:"#D0F040", navHover:"#D0F040" },
    darkTokens: { canvas:"#080810", surface:"#0D1020", surfaceSunken:"#161C35", ink:"#C8DFF0", inkMuted:"rgba(200,223,240,0.75)", inkContrast:"#080810", border:"#C8DFF0", accent:"#D0F040", navHover:"#D0F040" },
  },
  {
    id: "cobalt-day",
    label: "Cobalt Day",
    description: "Light polarity twin of Cobalt Lime: clean off-white canvas with the same electric lime accent.",
    keywords: ["cobalt", "lime", "yellow", "light", "sky", "blue"],
    swatches: ["#D0F040", "#0A0C14", "#EEF4FA", "#C8DFF0"],
    tokens: { canvas:"#EEF4FA", surface:"#EEF4FA", surfaceSunken:"#C8DFF0", ink:"#0A0C14", inkMuted:"rgba(10,12,20,0.68)", inkContrast:"#EEF4FA", border:"#0A0C14", accent:"#D0F040", navHover:"#D0F040" },
    darkTokens: { canvas:"#0A0C14", surface:"#12162A", surfaceSunken:"#1B2540", ink:"#EEF4FA", inkMuted:"rgba(238,244,250,0.78)", inkContrast:"#0A0C14", border:"#EEF4FA", accent:"#D0F040", navHover:"#D0F040" },
  },
  {
    id: "abyss",
    label: "Abyss",
    description: "Deep ocean dark theme: steel-blue accent on a very dark navy canvas.",
    keywords: ["abyss", "dark", "navy", "steel", "blue", "ocean"],
    swatches: ["#4A8FA8", "#0A1A2F", "#0A1A2F", "#143352"],
    tokens: { canvas:"#E4EDE8", surface:"#E4EDE8", surfaceSunken:"#C8D8DE", ink:"#0A1A2F", inkMuted:"rgba(10,26,47,0.65)", inkContrast:"#E4EDE8", border:"#0A1A2F", accent:"#4A8FA8", navHover:"#4A8FA8" },
    darkTokens: { canvas:"#0A1A2F", surface:"#0E2240", surfaceSunken:"#143352", ink:"#E4EDE8", inkMuted:"rgba(228,237,232,0.75)", inkContrast:"#0A1A2F", border:"#E4EDE8", accent:"#4A8FA8", navHover:"#4A8FA8" },
  },
  {
    id: "tidal-amber",
    label: "Tidal Amber",
    description: "Complementary flip of Abyss: warm amber replaces the steel-blue accent on the same deep-navy backdrop.",
    keywords: ["amber", "dark", "navy", "warm", "tidal", "deep"],
    swatches: ["#C87840", "#0A1A2F", "#0A1A2F", "#143352"],
    tokens: { canvas:"#F0E4C8", surface:"#F0E4C8", surfaceSunken:"#DDD0A8", ink:"#0A1A2F", inkMuted:"rgba(10,26,47,0.70)", inkContrast:"#F0E4C8", border:"#0A1A2F", accent:"#C87840", navHover:"#C87840" },
    darkTokens: { canvas:"#0A1A2F", surface:"#0E2240", surfaceSunken:"#143352", ink:"#F0E4C8", inkMuted:"rgba(240,228,200,0.75)", inkContrast:"#0A1A2F", border:"#F0E4C8", accent:"#C87840", navHover:"#C87840" },
  },
  {
    id: "taupe-navy",
    label: "Taupe Navy",
    description: "Mid-dark slate canvas with warm taupe accent — muted and corporate.",
    keywords: ["taupe", "navy", "dark", "slate", "warm", "corporate"],
    swatches: ["#B0A090", "#2B3A4A", "#2B3A4A", "#374858"],
    tokens: { canvas:"#F0EBE0", surface:"#F0EBE0", surfaceSunken:"#DDD8CE", ink:"#2B3A4A", inkMuted:"rgba(43,58,74,0.70)", inkContrast:"#F0EBE0", border:"#2B3A4A", accent:"#B0A090", navHover:"#B0A090" },
    darkTokens: { canvas:"#2B3A4A", surface:"#2B3A4A", surfaceSunken:"#374858", ink:"#F0EBE0", inkMuted:"rgba(240,235,224,0.75)", inkContrast:"#2B3A4A", border:"#F0EBE0", accent:"#B0A090", navHover:"#B0A090" },
  },
  {
    id: "chalk-navy",
    label: "Chalk Navy",
    description: "Light polarity flip of Taupe Navy: warm chalk-white canvas with deep navy ink.",
    keywords: ["chalk", "navy", "light", "warm", "white", "minimal"],
    swatches: ["#2B3A4A", "#2B3A4A", "#F0EBE0", "#DDD8CE"],
    tokens: { canvas:"#F0EBE0", surface:"#F0EBE0", surfaceSunken:"#DDD8CE", ink:"#2B3A4A", inkMuted:"rgba(43,58,74,0.70)", inkContrast:"#F0EBE0", border:"#2B3A4A", accent:"#2B3A4A", navHover:"#2B3A4A" },
    darkTokens: { canvas:"#2B3A4A", surface:"#374858", surfaceSunken:"#455870", ink:"#F0EBE0", inkMuted:"rgba(240,235,224,0.75)", inkContrast:"#2B3A4A", border:"#F0EBE0", accent:"#B0A090", navHover:"#B0A090" },
  },
  {
    id: "buckthorn",
    label: "Buckthorn",
    description: "Dark navy canvas with warm buckthorn-tan accent — earthy sophistication.",
    keywords: ["buckthorn", "tan", "navy", "dark", "earthy", "warm"],
    swatches: ["#A67B5B", "#002850", "#002850", "#003A6B"],
    tokens: { canvas:"#F0F0F8", surface:"#F0F0F8", surfaceSunken:"#E0E0EC", ink:"#002850", inkMuted:"rgba(0,40,80,0.70)", inkContrast:"#F0F0F8", border:"#002850", accent:"#A67B5B", navHover:"#A67B5B" },
    darkTokens: { canvas:"#002850", surface:"#002850", surfaceSunken:"#003A6B", ink:"#E8E8F2", inkMuted:"rgba(232,232,242,0.75)", inkContrast:"#002850", border:"#E8E8F2", accent:"#A67B5B", navHover:"#A67B5B" },
  },
  {
    id: "moonlit",
    label: "Moonlit",
    description: "Light twin of Buckthorn: pale silver-white canvas with the same warm tan accent.",
    keywords: ["moonlit", "silver", "white", "tan", "light", "soft"],
    swatches: ["#A67B5B", "#002850", "#F0F0F8", "#E0E0EC"],
    tokens: { canvas:"#F0F0F8", surface:"#F0F0F8", surfaceSunken:"#E0E0EC", ink:"#002850", inkMuted:"rgba(0,40,80,0.70)", inkContrast:"#F0F0F8", border:"#002850", accent:"#A67B5B", navHover:"#A67B5B" },
    darkTokens: { canvas:"#002850", surface:"#003A6B", surfaceSunken:"#0A4A80", ink:"#F0F0F8", inkMuted:"rgba(240,240,248,0.75)", inkContrast:"#002850", border:"#F0F0F8", accent:"#A67B5B", navHover:"#A67B5B" },
  },
  {
    id: "nightberry",
    label: "Nightberry",
    description: "Vivid hot-pink accent blazes against a near-black canvas — high-drama dark theme.",
    keywords: ["pink", "black", "dark", "vivid", "bold", "dramatic"],
    swatches: ["#FC5A8D", "#1A1A1A", "#1A1A1A", "#2A1E22"],
    tokens: { canvas:"#F8F0F4", surface:"#F8F0F4", surfaceSunken:"#EDD8E2", ink:"#3C1A2A", inkMuted:"rgba(60,26,42,0.68)", inkContrast:"#F8F0F4", border:"#3C1A2A", accent:"#FC5A8D", navHover:"#FC5A8D" },
    darkTokens: { canvas:"#1A1A1A", surface:"#1A1A1A", surfaceSunken:"#2A1E22", ink:"#F8E8EE", inkMuted:"rgba(248,232,238,0.75)", inkContrast:"#1A1A1A", border:"#F8E8EE", accent:"#FC5A8D", navHover:"#FC5A8D" },
  },
  {
    id: "berry-dawn",
    label: "Berry Dawn",
    description: "Light polarity of Nightberry: soft rose-cream canvas with the same hot-pink accent.",
    keywords: ["rose", "pink", "cream", "light", "soft", "feminine"],
    swatches: ["#FC5A8D", "#3C1A2A", "#F8F0F4", "#EDD8E2"],
    tokens: { canvas:"#F8F0F4", surface:"#F8F0F4", surfaceSunken:"#EDD8E2", ink:"#3C1A2A", inkMuted:"rgba(60,26,42,0.68)", inkContrast:"#F8F0F4", border:"#3C1A2A", accent:"#FC5A8D", navHover:"#FC5A8D" },
    darkTokens: { canvas:"#1A1A1A", surface:"#2A1E22", surfaceSunken:"#3A2830", ink:"#F8E8EE", inkMuted:"rgba(248,232,238,0.75)", inkContrast:"#1A1A1A", border:"#F8E8EE", accent:"#FC5A8D", navHover:"#FC5A8D" },
  },
  {
    id: "ember-wine",
    label: "Ember Wine",
    description: "Smouldering red-orange accent on a deep garnet canvas — rich and dramatic.",
    keywords: ["ember", "wine", "red", "garnet", "dark", "dramatic"],
    swatches: ["#C1440E", "#3A0008", "#3A0008", "#5E0010"],
    tokens: { canvas:"#F4E8DC", surface:"#F4E8DC", surfaceSunken:"#E4D0BC", ink:"#3A0008", inkMuted:"rgba(58,0,8,0.65)", inkContrast:"#F4E8DC", border:"#3A0008", accent:"#C1440E", navHover:"#C1440E" },
    darkTokens: { canvas:"#3A0008", surface:"#3A0008", surfaceSunken:"#5E0010", ink:"#F4E8DC", inkMuted:"rgba(244,232,220,0.75)", inkContrast:"#3A0008", border:"#F4E8DC", accent:"#C1440E", navHover:"#C1440E" },
  },
  {
    id: "saffron-tide",
    label: "Saffron Tide",
    description: "Golden saffron accent on a warm cream canvas with dusty-violet structure.",
    keywords: ["saffron", "gold", "cream", "violet", "warm", "mediterranean"],
    swatches: ["#F4C430", "#1E1A26", "#F2EEE3", "#E2DCCC"],
    tokens: { canvas:"#F2EEE3", surface:"#F2EEE3", surfaceSunken:"#E2DCCC", ink:"#1E1A26", inkMuted:"rgba(30,26,38,0.68)", inkContrast:"#F2EEE3", border:"#1E1A26", accent:"#F4C430", navHover:"#F4C430" },
    darkTokens: { canvas:"#1E1A26", surface:"#2A2635", surfaceSunken:"#383445", ink:"#F2EEE3", inkMuted:"rgba(242,238,227,0.75)", inkContrast:"#1E1A26", border:"#F2EEE3", accent:"#F4C430", navHover:"#F4C430" },
  },
  {
    id: "spectrum",
    label: "Spectrum",
    description: "Light palette with a terracotta-orange accent on warm parchment.",
    keywords: ["spectrum", "terracotta", "orange", "parchment", "warm", "light"],
    swatches: ["#E07030", "#1A2B4A", "#F0E8D0", "#DDD0B0"],
    tokens: { canvas:"#F0E8D0", surface:"#F0E8D0", surfaceSunken:"#DDD0B0", ink:"#1A2B4A", inkMuted:"rgba(26,43,74,0.70)", inkContrast:"#F0E8D0", border:"#1A2B4A", accent:"#E07030", navHover:"#E07030" },
    darkTokens: { canvas:"#1A2B4A", surface:"#243760", surfaceSunken:"#304578", ink:"#F0E8D0", inkMuted:"rgba(240,232,208,0.80)", inkContrast:"#1A2B4A", border:"#F0E8D0", accent:"#E07030", navHover:"#E07030" },
  },
  {
    id: "spectrum-dusk",
    label: "Spectrum Dusk",
    description: "Dark twin of Spectrum: same orange accent set against deep ink-blue canvas.",
    keywords: ["spectrum", "orange", "dark", "navy", "blue", "dusk"],
    swatches: ["#E07030", "#1A2B4A", "#1A2B4A", "#243760"],
    tokens: { canvas:"#F0E8D0", surface:"#F0E8D0", surfaceSunken:"#DDD0B0", ink:"#1A2B4A", inkMuted:"rgba(26,43,74,0.70)", inkContrast:"#F0E8D0", border:"#1A2B4A", accent:"#E07030", navHover:"#E07030" },
    darkTokens: { canvas:"#1A2B4A", surface:"#1A2B4A", surfaceSunken:"#243760", ink:"#F0E8D0", inkMuted:"rgba(240,232,208,0.75)", inkContrast:"#1A2B4A", border:"#F0E8D0", accent:"#E07030", navHover:"#E07030" },
  },
  {
    id: "stratum",
    label: "Stratum",
    description: "Warm coral-red accent on a dark charcoal canvas — geologic layers of warmth.",
    keywords: ["stratum", "coral", "charcoal", "dark", "red", "warm"],
    swatches: ["#E06050", "#2D3035", "#2D3035", "#3A4048"],
    tokens: { canvas:"#EBE5D8", surface:"#EBE5D8", surfaceSunken:"#D8D0C2", ink:"#1E2025", inkMuted:"rgba(30,32,37,0.70)", inkContrast:"#EBE5D8", border:"#1E2025", accent:"#E06050", navHover:"#E06050" },
    darkTokens: { canvas:"#2D3035", surface:"#2D3035", surfaceSunken:"#3A4048", ink:"#EAE2D8", inkMuted:"rgba(234,226,216,0.75)", inkContrast:"#2D3035", border:"#EAE2D8", accent:"#E06050", navHover:"#E06050" },
  },
  {
    id: "coral-chalk",
    label: "Coral Chalk",
    description: "Light polarity of Stratum: the same coral-red accent on chalky white canvas.",
    keywords: ["coral", "chalk", "red", "white", "light", "summer"],
    swatches: ["#E06050", "#1E2025", "#EBE5D8", "#D8D0C2"],
    tokens: { canvas:"#EBE5D8", surface:"#EBE5D8", surfaceSunken:"#D8D0C2", ink:"#1E2025", inkMuted:"rgba(30,32,37,0.70)", inkContrast:"#EBE5D8", border:"#1E2025", accent:"#E06050", navHover:"#E06050" },
    darkTokens: { canvas:"#1E2025", surface:"#2A2D35", surfaceSunken:"#383C45", ink:"#EBE5D8", inkMuted:"rgba(235,229,216,0.75)", inkContrast:"#1E2025", border:"#EBE5D8", accent:"#E06050", navHover:"#E06050" },
  },
  {
    id: "oslo",
    label: "Oslo",
    description: "Nordic cool: muted teal-blue accent on deep midnight canvas — minimal, cold, Scandinavian.",
    keywords: ["oslo", "nordic", "teal", "blue", "dark", "minimal"],
    swatches: ["#4C8EA0", "#0D2137", "#0D2137", "#153048"],
    tokens: { canvas:"#C8DDE4", surface:"#C8DDE4", surfaceSunken:"#B0C8D0", ink:"#0D2137", inkMuted:"rgba(13,33,55,0.70)", inkContrast:"#C8DDE4", border:"#0D2137", accent:"#4C8EA0", navHover:"#4C8EA0" },
    darkTokens: { canvas:"#0D2137", surface:"#0D2137", surfaceSunken:"#153048", ink:"#C8DDE4", inkMuted:"rgba(200,221,228,0.75)", inkContrast:"#0D2137", border:"#C8DDE4", accent:"#4C8EA0", navHover:"#4C8EA0" },
  },
  {
    id: "blush-steel",
    label: "Blush Steel",
    description: "Warm blush-copper accent on a deep steel-blue canvas — industrial romanticism.",
    keywords: ["blush", "steel", "copper", "blue", "warm", "dark"],
    swatches: ["#D89060", "#1A2A3A", "#F5EBE8", "#E8D5D0"],
    tokens: { canvas:"#F5EBE8", surface:"#F5EBE8", surfaceSunken:"#E8D5D0", ink:"#1A2A3A", inkMuted:"rgba(26,42,58,0.70)", inkContrast:"#F5EBE8", border:"#1A2A3A", accent:"#D89060", navHover:"#D89060" },
    darkTokens: { canvas:"#1A2A3A", surface:"#253548", surfaceSunken:"#334055", ink:"#F5EBE8", inkMuted:"rgba(245,235,232,0.75)", inkContrast:"#1A2A3A", border:"#F5EBE8", accent:"#D89060", navHover:"#D89060" },
  },
  {
    id: "maritime",
    label: "Maritime",
    description: "Dark navy canvas with a vivid tangerine accent — the classic nautical contrast.",
    keywords: ["maritime", "navy", "tangerine", "orange", "dark", "nautical"],
    swatches: ["#E06020", "#1A2B4A", "#1A2B4A", "#243760"],
    tokens: { canvas:"#F2EDE4", surface:"#F2EDE4", surfaceSunken:"#E4D8C8", ink:"#1A2B4A", inkMuted:"rgba(26,43,74,0.70)", inkContrast:"#F2EDE4", border:"#1A2B4A", accent:"#E06020", navHover:"#E06020" },
    darkTokens: { canvas:"#1A2B4A", surface:"#1A2B4A", surfaceSunken:"#243760", ink:"#F2EDE4", inkMuted:"rgba(242,237,228,0.75)", inkContrast:"#1A2B4A", border:"#F2EDE4", accent:"#E06020", navHover:"#E06020" },
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Periwinkle-blue accent over a luminous lime-mint canvas — ethereal northern lights.",
    keywords: ["aurora", "periwinkle", "blue", "lime", "mint", "light"],
    swatches: ["#8090D0", "#1A2060", "#EAF8D8", "#C8F0A0"],
    tokens: { canvas:"#EAF8D8", surface:"#EAF8D8", surfaceSunken:"#C8F0A0", ink:"#1A2060", inkMuted:"rgba(26,32,96,0.70)", inkContrast:"#EAF8D8", border:"#1A2060", accent:"#8090D0", navHover:"#8090D0" },
    darkTokens: { canvas:"#1A2060", surface:"#222A78", surfaceSunken:"#2C3590", ink:"#EAF8D8", inkMuted:"rgba(234,248,216,0.80)", inkContrast:"#1A2060", border:"#EAF8D8", accent:"#C8F0A0", navHover:"#C8F0A0" },
  },
  {
    id: "ironworks",
    label: "Ironworks",
    description: "Burnished gold accent on a near-black iron canvas — foundry heat and industrial weight.",
    keywords: ["iron", "gold", "dark", "black", "industrial", "warm"],
    swatches: ["#C87820", "#1A1C1E", "#1A1C1E", "#252830"],
    tokens: { canvas:"#D8DCE2", surface:"#D8DCE2", surfaceSunken:"#C0C4CC", ink:"#1A1C1E", inkMuted:"rgba(26,28,30,0.65)", inkContrast:"#D8DCE2", border:"#1A1C1E", accent:"#C87820", navHover:"#C87820" },
    darkTokens: { canvas:"#1A1C1E", surface:"#1A1C1E", surfaceSunken:"#252830", ink:"#D8DCE2", inkMuted:"rgba(216,220,226,0.75)", inkContrast:"#1A1C1E", border:"#D8DCE2", accent:"#C87820", navHover:"#C87820" },
  },
  {
    id: "rosewood",
    label: "Rosewood",
    description: "Deep rose-red accent on a warm ivory canvas — antique elegance with botanical character.",
    keywords: ["rosewood", "rose", "red", "ivory", "warm", "elegant"],
    swatches: ["#6B2737", "#2A1018", "#F5EEF0", "#E8D4D8"],
    tokens: { canvas:"#F5EEF0", surface:"#F5EEF0", surfaceSunken:"#E8D4D8", ink:"#2A1018", inkMuted:"rgba(42,16,24,0.70)", inkContrast:"#F5EEF0", border:"#2A1018", accent:"#6B2737", navHover:"#6B2737" },
    darkTokens: { canvas:"#2A1018", surface:"#3A1C24", surfaceSunken:"#4A2830", ink:"#F5EEF0", inkMuted:"rgba(245,238,240,0.80)", inkContrast:"#2A1018", border:"#F5EEF0", accent:"#6B2737", navHover:"#6B2737" },
  },
];

// ─── Theme preview card ───────────────────────────────────────────────────────
function ThemePreviewCard({ theme, mode = "light" }: { theme: ThemeEntry; mode?: "light" | "dark" }) {
  const t = (mode === "dark" && theme.darkTokens) ? theme.darkTokens : theme.tokens;
  const vars: React.CSSProperties = {
    "--tp-canvas":   t.canvas,
    "--tp-surface":  t.surface,
    "--tp-sunken":   t.surfaceSunken,
    "--tp-ink":      t.ink,
    "--tp-ink-m":    t.inkMuted,
    "--tp-ink-c":    t.inkContrast,
    "--tp-border":   t.border,
    "--tp-accent":   t.accent,
    "--tp-nav":      t.navHover,
  } as React.CSSProperties;

  return (
    <div className="tp-card" style={vars} aria-label={`${theme.label} preview`}>
      {/* Simulated sidebar strip */}
      <div className="tp-sidebar">
        <div className="tp-sidebar__logo" />
        <div className="tp-sidebar__item tp-sidebar__item--active" />
        <div className="tp-sidebar__item" />
        <div className="tp-sidebar__item" />
        <div className="tp-sidebar__item" />
      </div>

      {/* Main content area */}
      <div className="tp-body">
        {/* Type specimen */}
        <div className="tp-types">
          <div className="tp-h1">H1 Heading</div>
          <div className="tp-h2">H2 Heading</div>
          <div className="tp-h3">H3 Subheading</div>
          <div className="tp-h4">H4 Label</div>
          <div className="tp-h5">H5 Caption</div>
          <div className="tp-h6">H6 Micro</div>
          <div className="tp-p">Body paragraph text — the quick brown fox jumps over the lazy dog.</div>
        </div>

        {/* Form fields */}
        <div className="tp-fields">
          <div className="tp-field">
            <div className="tp-field__label">Field label</div>
            <div className="tp-field__input">Sample input value</div>
          </div>
          <div className="tp-field">
            <div className="tp-field__label">Another field</div>
            <div className="tp-field__input tp-field__input--placeholder">Placeholder text</div>
          </div>
        </div>

        {/* Buttons */}
        <div className="tp-buttons">
          <div className="tp-btn tp-btn--primary">Primary</div>
          <div className="tp-btn tp-btn--secondary">Secondary</div>
          <div className="tp-btn tp-btn--ghost">Ghost</div>
        </div>

        {/* Mini table */}
        <div className="tp-table">
          <div className="tp-table__head">
            <div className="tp-table__cell">Name</div>
            <div className="tp-table__cell">Value</div>
            <div className="tp-table__cell">Status</div>
          </div>
          <div className="tp-table__row">
            <div className="tp-table__cell">Alpha</div>
            <div className="tp-table__cell">100</div>
            <div className="tp-table__cell tp-table__cell--accent">Active</div>
          </div>
          <div className="tp-table__row tp-table__row--alt">
            <div className="tp-table__cell">Beta</div>
            <div className="tp-table__cell">42</div>
            <div className="tp-table__cell">Draft</div>
          </div>
          <div className="tp-table__row">
            <div className="tp-table__cell">Gamma</div>
            <div className="tp-table__cell">8</div>
            <div className="tp-table__cell">Closed</div>
          </div>
        </div>

        {/* Nav highlight chip */}
        <div className="tp-nav-chip">
          <div className="tp-nav-chip__dot" />
          <span>Nav highlight</span>
        </div>
      </div>
    </div>
  );
}

// ─── Swatch strip ─────────────────────────────────────────────────────────────
function SwatchStrip({ colors }: { colors: [string, string, string, string] }) {
  return (
    <div className="theme-swatch-strip" aria-hidden="true">
      {colors.map((c, i) => (
        <span key={i} className="theme-swatch-strip__chip" style={{ background: c }} title={c} />
      ))}
    </div>
  );
}

// ─── Themes tab ───────────────────────────────────────────────────────────────
const PAGE_SIZE_OPTIONS = [5, 10, 15, 20, 50, 100, "all"] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type TopTab = "maker" | "themes";

function ThemesTab() {
  const { pack, choose, mounted, saveError } = useThemePack();
  const { theme: globalMode, setMode: setGlobalMode } = useTheme();
  const [cardModes, setCardModes] = useState<Record<string, "light" | "dark">>({});

  const effectiveMode = (id: string): "light" | "dark" =>
    cardModes[id] ?? (globalMode === "dark" ? "dark" : "light");

  const toggleCardMode = (id: string) =>
    setCardModes((prev) => ({ ...prev, [id]: effectiveMode(id) === "light" ? "dark" : "light" }));

  const [query,    setQuery]    = useState("");
  const [polarity, setPolarity] = useState<"light" | "dark">(globalMode === "dark" ? "dark" : "light");

  useEffect(() => {
    setPolarity(globalMode === "dark" ? "dark" : "light");
    setPage(1);
  }, [globalMode]);
  const [hue,      setHue]      = useState<"" | "warm" | "cool" | "green" | "pink" | "neutral">("");
  const [vibe,     setVibe]     = useState<"" | "bold" | "soft" | "minimal" | "coastal">("");
  const [page, setPage]   = useState(1);
  const [size, setSize]   = useState<PageSize>(() => {
    if (typeof window === "undefined") return 50;
    const stored = window.localStorage.getItem("theme-lib:page-size");
    if (stored === "all") return "all";
    const n = Number(stored);
    return (PAGE_SIZE_OPTIONS as readonly (number | string)[]).includes(n) ? (n as PageSize) : 50;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("theme-lib:page-size", String(size));
  }, [size]);

  const HUE_KEYS: Record<string, string[]> = {
    warm:    ["amber", "orange", "coral", "red", "gold", "terracotta", "copper", "warm", "ember", "garnet", "saffron"],
    cool:    ["blue", "teal", "navy", "marine", "slate", "cobalt", "cool", "arctic", "sky", "steel", "oslo", "nordic"],
    green:   ["green", "lime", "mint", "sage", "kelp", "meadow"],
    pink:    ["pink", "lavender", "mauve", "berry", "purple", "blush", "raspberry", "rose"],
    neutral: ["grey", "gray", "cream", "white", "ivory", "silver", "black", "neutral", "mono", "charcoal", "linen", "chalk"],
  };
  const VIBE_KEYS: Record<string, string[]> = {
    bold:    ["bold", "vivid", "dramatic", "electric", "bright"],
    soft:    ["soft", "pastel", "feminine", "gentle"],
    minimal: ["minimal", "clean", "mono", "neutral"],
    coastal: ["coastal", "nautical", "marine", "nordic", "ocean"],
  };

  const filtered = useMemo(() => {
    let result = THEMES as typeof THEMES;

    const q = query.toLowerCase().trim();
    if (q) {
      result = result.filter((t) => {
        const haystack = [t.label, t.description, ...t.keywords, ...t.swatches, ...Object.values(t.tokens)].join(" ").toLowerCase();
        return haystack.includes(q);
      });
    }

    if (polarity) result = result.filter((t) => t.keywords.includes(polarity));
    if (hue)      result = result.filter((t) => t.keywords.some((k) => HUE_KEYS[hue]?.includes(k)));
    if (vibe)     result = result.filter((t) => t.keywords.some((k) => VIBE_KEYS[vibe]?.includes(k)));

    return result;
  }, [query, polarity, hue, vibe]);

  const totalPages = size === "all" ? 1 : Math.max(1, Math.ceil(filtered.length / (size as number)));
  const safePage   = Math.min(page, totalPages);
  const rows       = size === "all" ? filtered : filtered.slice((safePage - 1) * (size as number), safePage * (size as number));

  const handleQuery    = (v: string) => { setQuery(v);    setPage(1); };
  const handlePolarity = (v: "light" | "dark") => { setPolarity(v); setPage(1); };
  const handleHue      = (v: string) => { setHue(v as "" | "warm" | "cool" | "green" | "pink" | "neutral"); setPage(1); };
  const handleVibe     = (v: string) => { setVibe(v as "" | "bold" | "soft" | "minimal" | "coastal"); setPage(1); };
  const handleSize     = (v: PageSize) => { setSize(v); setPage(1); };
  const hasFilters = !!(query || hue || vibe);
  const resetFilters = () => { setQuery(""); setHue(""); setVibe(""); setPage(1); };

  const renderPaginationBar = (position: "top" | "bottom") => (
    <div className={`theme-lib__pagination${position === "bottom" ? " theme-lib__pagination--bottom" : ""}`}>
      <div className="theme-lib__page-size">
        <span className="theme-lib__page-size-label">Show</span>
        {PAGE_SIZE_OPTIONS.map((n) => (
          <button
            key={n}
            type="button"
            className={`btn btn--sm ${size === n ? "btn--secondary" : "btn--primary"}`}
            onClick={() => handleSize(n)}
            aria-pressed={size === n}
          >
            {n === "all" ? "All" : n}
          </button>
        ))}
      </div>
      {size !== "all" && (
        <>
          <div className="theme-lib__page-info">
            Page {safePage} of {totalPages}
          </div>
          <div className="theme-lib__page-nav">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              ‹ Prev
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              Next ›
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <section className="theme-panel theme-lib" aria-label="Theme library">
      {/* Controls bar */}
      <div className="theme-lib__bar">
        <input
          type="search"
          className="form__input theme-lib__search"
          placeholder="Search by name, keyword, or hex…"
          value={query}
          onChange={(e) => handleQuery(e.target.value)}
          aria-label="Filter themes"
        />
        <div className="theme-lib__filters">
          <div className="theme-lib__polarity" role="group" aria-label="Filter by polarity">
            <button
              type="button"
              className={`btn btn--sm ${polarity === "light" ? "btn--secondary" : "btn--primary"}`}
              onClick={() => handlePolarity("light")}
              aria-pressed={polarity === "light"}
              aria-label="Show light themes"
              title="Light themes"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
              Light
            </button>
            <button
              type="button"
              className={`btn btn--sm ${polarity === "dark" ? "btn--secondary" : "btn--primary"}`}
              onClick={() => handlePolarity("dark")}
              aria-pressed={polarity === "dark"}
              aria-label="Show dark themes"
              title="Dark themes"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
              Dark
            </button>
          </div>
          <select
            className="form__select form__select--sm theme-lib__filter-select"
            value={hue}
            onChange={(e) => handleHue(e.target.value)}
            aria-label="Filter by colour family"
          >
            <option value="">All Colours</option>
            <option value="warm">Warm</option>
            <option value="cool">Cool</option>
            <option value="green">Green</option>
            <option value="pink">Pink &amp; Purple</option>
            <option value="neutral">Neutral</option>
          </select>
          <select
            className="form__select form__select--sm theme-lib__filter-select"
            value={vibe}
            onChange={(e) => handleVibe(e.target.value)}
            aria-label="Filter by vibe"
          >
            <option value="">All Vibes</option>
            <option value="bold">Bold</option>
            <option value="soft">Soft</option>
            <option value="minimal">Minimal</option>
            <option value="coastal">Coastal</option>
          </select>
          {hasFilters && (
            <button
              type="button"
              className="theme-lib__filter-clear"
              onClick={resetFilters}
              aria-label="Clear all filters"
            >
              ✕ Clear
            </button>
          )}
        </div>
        <div className="theme-lib__count" aria-live="polite" aria-atomic="true">
          {filtered.length} theme{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {renderPaginationBar("top")}

      {/* Card grid — standard table-wrap container, 4 cols, hairline dividers */}
      <div className="table-wrap theme-lib__table-wrap">
        <div className="theme-lib__scroll">
          {rows.length === 0 ? (
            <div className="theme-lib__empty">
              No themes match the current filters.{" "}
              <button type="button" className="theme-lib__filter-clear theme-lib__filter-clear--inline" onClick={resetFilters}>Clear filters</button>
            </div>
          ) : (
            <div className="theme-lib__grid">
              {rows.map((theme) => {
                const cardMode = effectiveMode(theme.id);
                const active = mounted && pack === theme.id && cardMode === globalMode;
                const hasDark = !!theme.darkTokens;
                return (
                  <div
                    key={theme.id}
                    className={`theme-lib__item${active ? " theme-lib__item--active" : ""}`}
                  >
                    <ThemePreviewCard theme={theme} mode={cardMode} />
                    <div className="theme-lib__meta">
                      <div className="theme-lib__meta-top">
                        <SwatchStrip colors={theme.swatches} />
                        <div className="theme-lib__meta-actions">
                          {hasDark && (
                            <button
                              type="button"
                              className="theme-card-mode-toggle"
                              onClick={() => toggleCardMode(theme.id)}
                              aria-label={`Switch ${theme.label} preview to ${cardMode === "light" ? "dark" : "light"} mode`}
                              title={cardMode === "light" ? "Show dark mode preview" : "Show light mode preview"}
                            >
                              <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
                                <rect x="0.5" y="0.5" width="19" height="19" fill={cardMode === "light" ? "#ffffff" : "#000000"} stroke={cardMode === "light" ? "#000000" : "#ffffff"} strokeWidth="1" />
                                <rect x="3.5" y="3.5" width="13" height="13" fill={cardMode === "light" ? "#000000" : "#ffffff"} />
                              </svg>
                            </button>
                          )}
                          {active ? (
                            <span className="theme-lib__active-badge">Active</span>
                          ) : (
                            <button
                              type="button"
                              className="btn btn--primary btn--sm"
                              onClick={() => {
                                void choose(theme.id);
                                setGlobalMode(cardMode);
                              }}
                            >
                              Apply
                            </button>
                          )}
                        </div>
                      </div>
                      <h2 className="theme-lib__name">{theme.label}</h2>
                      <p className="theme-lib__desc">{theme.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {renderPaginationBar("bottom")}

      {saveError && (
        <div className="theme-packs__error" role="alert" aria-live="polite">
          {saveError}
        </div>
      )}
    </section>
  );
}

export default function ThemePage() {
  const { user } = useAuth();
  const [seed, setSeed] = useState<string>("#3B82F6");
  const [mode, setMode] = useState<MakerMode>("seed");
  const [topTab, setTopTab] = useState<TopTab>("themes");

  const shades = useMemo(() => shadesFromSeed(seed), [seed]);
  const seedName = useMemo(() => {
    const hit = PRESETS.find((p) => p.seed.toUpperCase() === seed.toUpperCase());
    return hit ? hit.name : seed.toUpperCase();
  }, [seed]);

  if (!user) return null;

  const sections = Array.from(new Set(ARTEFACTS.map((a) => a.section)));
  const counts = ARTEFACTS.reduce<Record<Status, number>>(
    (acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }),
    { exposed: 0, "new-token": 0, future: 0 },
  );

  return (
    <PageShell title="Theme" subtitle="Choose how Vector looks for you">
      <div className="tabs" role="tablist" aria-label="Theme sections">
        <button
          type="button"
          role="tab"
          aria-selected={topTab === "themes"}
          className={`tabs__tab${topTab === "themes" ? " tabs__tab--active" : ""}`}
          onClick={() => setTopTab("themes")}
        >
          Themes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={topTab === "maker"}
          className={`tabs__tab${topTab === "maker" ? " tabs__tab--active" : ""}`}
          onClick={() => setTopTab("maker")}
        >
          Maker
        </button>
      </div>

      {topTab === "themes" ? (
        <ThemesTab />
      ) : (
        <>
      <MakerPanel seed={seed} setSeed={setSeed} mode={mode} setMode={setMode} />

      <div className="theme-panels">
        <ColourSelection shades={shades} seedName={seedName} />

        <section className="theme-panel" aria-label="My pallets">
          <header className="theme-panel__header">
            <h2 className="theme-panel__title">MY PALLETS</h2>
          </header>
          <p className="theme-panel__empty">No saved palettes yet.</p>
        </section>
      </div>

      <div className="theme-intro">
        <p className="theme-intro__lead">
          The list below is every CSS artefact the theme maker can swap for the user interface,
          per <code>dev/planning/feature_theme_maker.md</code>. <strong>Exposed</strong> means the
          token already exists in <code>globals.css</code>. <strong>New token</strong> means the
          paper specifies it but it isn&apos;t declared yet. <strong>Future candidate</strong> is
          beyond the paper &mdash; worth considering.
        </p>
        <p className="theme-intro__counts">
          Totals: {counts.exposed} exposed &middot; {counts["new-token"]} new tokens (paper) &middot; {counts.future} future candidates
        </p>
      </div>

      {sections.map((section) => (
        <div key={section} className="theme-section">
          <h3 className="theme-section__title">{section}</h3>
          <div className="table-wrap">
            <table className="table">
              <thead className="table__head">
                <tr>
                  <th className="table__cell">Control</th>
                  <th className="table__cell">CSS token</th>
                  <th className="table__cell">Light default</th>
                  <th className="table__cell">Dark default</th>
                  <th className="table__cell">Status</th>
                  <th className="table__cell">Notes</th>
                </tr>
              </thead>
              <tbody>
                {ARTEFACTS.filter((a) => a.section === section).map((a) => (
                  <tr key={`${a.section}-${a.control}`} className="table__row">
                    <td className="table__cell">{a.control}</td>
                    <td className="table__cell"><code>{a.token}</code></td>
                    <td className="table__cell table__cell--muted">{a.light}</td>
                    <td className="table__cell table__cell--muted">{a.dark}</td>
                    <td className="table__cell">
                      <span className={`theme-status theme-status--${a.status}`}>
                        {STATUS_LABEL[a.status]}
                      </span>
                    </td>
                    <td className="table__cell table__cell--muted">{a.notes ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
        </>
      )}
    </PageShell>
  );
}
