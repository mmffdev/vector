"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";

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
  { section: "Text", control: "Body font family", token: "--font-sans", light: "Zen Maru Gothic", dark: "Zen Maru Gothic", status: "exposed", notes: "Injected via next/font" },
  { section: "Text", control: "Mono font family", token: "--font-mono", light: "JetBrains Mono", dark: "JetBrains Mono", status: "exposed" },
  { section: "Text", control: "Display font family", token: "--font-display", light: "Archivo Black", dark: "Archivo Black", status: "exposed" },
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

export default function ThemePage() {
  const { user } = useAuth();
  const [seed, setSeed] = useState<string>("#3B82F6");
  const [mode, setMode] = useState<MakerMode>("seed");

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
    </PageShell>
  );
}
