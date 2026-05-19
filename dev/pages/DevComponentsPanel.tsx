"use client";

/**
 * DevComponentsPanel — Component anatomy, playground, and improvement notes.
 *
 * Structure:
 *   - Sticky two-level collapsible TOC (H1 = component, H2 = sub-section)
 *   - IntersectionObserver scroll-tracks both levels
 *   - Each component: Synopsis · Props playground · Improvements · Extensions · Cross-component
 *
 * To add a new component: add an entry to COMPONENTS, write sections below,
 * add H2 ids following the pattern `{slug}-{section}`.
 */

import { useEffect, useRef, useState } from "react";
import Panel from "@/app/components/Panel";
import NavigationPie from "@/app/components/NavigationPie";
import QRCode, { type QRCodeLevel, type QRCodeRender } from "@/app/components/QRCode";
import QRCodeTrigger from "@/app/components/QRCodeTrigger";

/* ─── TOC data ─────────────────────────────────────────────────────── */

interface TocH2 {
  id: string;
  label: string;
}

interface TocEntry {
  slug: string;
  label: string;
  h2s: TocH2[];
}

const COMPONENTS: TocEntry[] = [
  {
    slug: "panel",
    label: "Panel",
    h2s: [
      { id: "panel-synopsis",        label: "Synopsis" },
      { id: "panel-props",           label: "Props & Playground" },
      { id: "panel-improvements",    label: "Improvements" },
      { id: "panel-extensions",      label: "Extensions" },
      { id: "panel-cross-component", label: "Cross-component usage" },
    ],
  },
  {
    slug: "navigation-pie",
    label: "NavigationPie",
    h2s: [
      { id: "navigation-pie-synopsis", label: "Synopsis" },
      { id: "navigation-pie-playground", label: "Playground" },
    ],
  },
  {
    slug: "qr-code",
    label: "QRCode",
    h2s: [
      { id: "qr-code-synopsis",        label: "Synopsis" },
      { id: "qr-code-props",           label: "Props & Playground" },
      { id: "qr-code-improvements",    label: "Improvements" },
      { id: "qr-code-extensions",      label: "Extensions" },
      { id: "qr-code-cross-component", label: "Cross-component usage" },
    ],
  },
  {
    slug: "qr-code-trigger",
    label: "QRCodeTrigger",
    h2s: [
      { id: "qr-code-trigger-synopsis",        label: "Synopsis" },
      { id: "qr-code-trigger-props",           label: "Props & Playground" },
      { id: "qr-code-trigger-improvements",    label: "Improvements" },
      { id: "qr-code-trigger-extensions",      label: "Extensions" },
      { id: "qr-code-trigger-cross-component", label: "Cross-component usage" },
    ],
  },
];

/* ─── Two-level collapsible TOC ─────────────────────────────────────── */

function ComponentsToc({
  activeId,
  onNavigate,
}: {
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>(
    Object.fromEntries(COMPONENTS.map((c) => [c.slug, true]))
  );

  const toggle = (slug: string) =>
    setOpen((prev) => ({ ...prev, [slug]: !prev[slug] }));

  const isH1Active = (entry: TocEntry) =>
    entry.h2s.some((h) => h.id === activeId) || activeId === entry.slug;

  return (
    <nav className="dui-toc" aria-label="Components">
      <div className="dui-toc__label">Components</div>
      <ul className="dui-toc__list">
        {COMPONENTS.map((entry) => (
          <li key={entry.slug}>
            <button
              type="button"
              className={`dui-toc__toggle${isH1Active(entry) ? " is-active" : ""}`}
              onClick={() => toggle(entry.slug)}
              aria-expanded={open[entry.slug]}
            >
              <span className={`dui-toc__chevron${open[entry.slug] ? " dui-toc__chevron--open" : ""}`}>▶</span>
              {entry.label}
            </button>
            {open[entry.slug] && (
              <ul className="dui-toc__sub">
                {entry.h2s.map((h) => (
                  <li key={h.id}>
                    <a
                      href={`#${h.id}`}
                      className={activeId === h.id ? "is-active" : ""}
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigate(h.id);
                      }}
                    >
                      {h.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ─── Panel playground ───────────────────────────────────────────────── */

type BorderType = "solid" | "dashed" | "dotted" | "none";

interface PlaygroundState {
  title: string;
  helpable: boolean;
  background: string;
  borderType: BorderType;
  borderWidth: string;
  borderColorTop: string;
  borderColorRight: string;
  borderColorBottom: string;
  borderColorLeft: string;
  radiusTop: string;
  radiusRight: string;
  radiusBottom: string;
  radiusLeft: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
}

const DEFAULTS: PlaygroundState = {
  title: "Sample panel title",
  helpable: false,
  background: "",
  borderType: "solid",
  borderWidth: "1px",
  borderColorTop: "",
  borderColorRight: "",
  borderColorBottom: "",
  borderColorLeft: "",
  radiusTop: "",
  radiusRight: "",
  radiusBottom: "",
  radiusLeft: "",
  paddingTop: "",
  paddingRight: "",
  paddingBottom: "",
  paddingLeft: "",
};

function PanelPlayground() {
  const [s, setS] = useState<PlaygroundState>(DEFAULTS);
  const set = <K extends keyof PlaygroundState>(k: K, v: PlaygroundState[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const addUnit = (v: string) => v && /^\d+$/.test(v.trim()) ? `${v}px` : v;
  const addHash = (v: string) => v && /^[0-9a-fA-F]{3,8}$/.test(v.trim()) ? `#${v}` : v;

  // If only one side colour is set, treat it as all-sides. Otherwise per-side.
  const bc = {
    top:    addHash(s.borderColorTop),
    right:  addHash(s.borderColorRight),
    bottom: addHash(s.borderColorBottom),
    left:   addHash(s.borderColorLeft),
  };
  const filledSides = [bc.top, bc.right, bc.bottom, bc.left].filter(Boolean);
  const allSameColor = filledSides.length === 1
    ? filledSides[0]!
    : filledSides.length === 0 ? "var(--border)" : null;

  // What Panel receives (unified border prop — per-side is an extension):
  const borderProp = {
    type: s.borderType,
    width: addUnit(s.borderWidth) || undefined,
    color: (allSameColor ?? bc.top) || "var(--border)",
  };

  // Inline override for the preview when per-side colours differ:
  const perSideBorderStyle: React.CSSProperties = allSameColor === null ? {
    borderTop:    `${addUnit(s.borderWidth) || "1px"} ${s.borderType} ${bc.top    || "var(--border)"}`,
    borderRight:  `${addUnit(s.borderWidth) || "1px"} ${s.borderType} ${bc.right  || "var(--border)"}`,
    borderBottom: `${addUnit(s.borderWidth) || "1px"} ${s.borderType} ${bc.bottom || "var(--border)"}`,
    borderLeft:   `${addUnit(s.borderWidth) || "1px"} ${s.borderType} ${bc.left   || "var(--border)"}`,
  } : {};

  const paddingProp: [string?, string?, string?, string?] | undefined =
    s.paddingTop || s.paddingRight || s.paddingBottom || s.paddingLeft
      ? [addUnit(s.paddingTop) || undefined, addUnit(s.paddingRight) || undefined, addUnit(s.paddingBottom) || undefined, addUnit(s.paddingLeft) || undefined]
      : undefined;

  const anyRadius = s.radiusTop || s.radiusRight || s.radiusBottom || s.radiusLeft;
  const radiusProp = anyRadius
    ? {
        top:    addUnit(s.radiusTop)    || "0",
        right:  addUnit(s.radiusRight)  || "0",
        bottom: addUnit(s.radiusBottom) || "0",
        left:   addUnit(s.radiusLeft)   || "0",
      }
    : undefined;

  const jsx = [
    `<Panel`,
    `  name="playground"`,
    s.title         ? `  title="${s.title}"` : null,
    s.helpable      ? `  helpable={true}` : null,
    s.background    ? `  background="${addHash(s.background)}"` : null,
    radiusProp      ? `  radius={{ top: "${addUnit(s.radiusTop)}" /* TL */, right: "${addUnit(s.radiusRight)}" /* TR */, bottom: "${addUnit(s.radiusBottom)}" /* BR */, left: "${addUnit(s.radiusLeft)}" /* BL */ }}` : null,
    paddingProp     ? `  padding={["${s.paddingTop}", "${s.paddingRight}", "${s.paddingBottom}", "${s.paddingLeft}"]}` : null,
    allSameColor !== null
      ? (allSameColor !== "var(--border)" || s.borderType !== "solid" || s.borderWidth !== "1px")
        ? `  border={{ type: "${s.borderType}", width: "${addUnit(s.borderWidth)}", color: "${allSameColor}" }}`
        : null
      : `  // per-side colours — extend Panel with border-top/right/bottom/left props\n  // borderTop="${addUnit(s.borderWidth)} ${s.borderType} ${bc.top}" borderRight="${addUnit(s.borderWidth)} ${s.borderType} ${bc.right}" borderBottom="${addUnit(s.borderWidth)} ${s.borderType} ${bc.bottom}" borderLeft="${addUnit(s.borderWidth)} ${s.borderType} ${bc.left}"`,
    `>`,
    `  Panel content goes here`,
    `</Panel>`,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="dui-cat__section" id="panel-props">
      <h2 className="dui-doc__h2">Props &amp; Playground</h2>
      <p className="dui-doc__p">
        Adjust the controls to see props update the live preview in real time. The JSX snippet below reflects the current configuration.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--space-6)", alignItems: "start", marginTop: "var(--space-4)" }}>

        {/* Live preview */}
        <div>
          <div className="dui-cat__demo-label">Live preview</div>
          <div style={{ padding: "var(--space-4)", background: "var(--surface-sunken)", borderRadius: 6 }}>
            <div style={allSameColor === null ? perSideBorderStyle : undefined}>
              <Panel
                name="playground"
                title={s.title || undefined}
                helpable={s.helpable}
                background={addHash(s.background) || undefined}
                border={allSameColor !== null ? borderProp : { type: "none" }}
                radius={radiusProp}
                padding={paddingProp}
              >
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>
                  Panel content goes here. This area is <code>panel__body</code>.
                </p>
              </Panel>
            </div>
          </div>
          <div className="dui-cat__demo-label" style={{ marginTop: "var(--space-4)" }}>JSX</div>
          <pre className="dui-doc__code">{jsx}</pre>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div className="dui-cat__demo-label">Controls</div>

          <label className="dui-form__field">
            <span className="dui-form__label">title</span>
            <input
              className="dui-form__input"
              value={s.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="(no title)"
            />
          </label>

          <label className="dui-form__field dui-form__field--inline">
            <input
              type="checkbox"
              checked={s.helpable}
              onChange={(e) => set("helpable", e.target.checked)}
            />
            <span className="dui-form__label">helpable</span>
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">background</span>
            <input
              className="dui-form__input"
              value={s.background}
              onChange={(e) => set("background", e.target.value)}
              placeholder="e.g. var(--surface-raised)"
            />
          </label>

          <fieldset className="dui-form__fieldset">
            <legend className="dui-form__legend">border</legend>
            <label className="dui-form__field">
              <span className="dui-form__label">type</span>
              <select className="dui-form__select" value={s.borderType} onChange={(e) => set("borderType", e.target.value as BorderType)}>
                <option value="solid">solid</option>
                <option value="dashed">dashed</option>
                <option value="dotted">dotted</option>
                <option value="none">none</option>
              </select>
            </label>
            <label className="dui-form__field">
              <span className="dui-form__label">width</span>
              <input className="dui-form__input" value={s.borderWidth} onChange={(e) => set("borderWidth", e.target.value)} placeholder="1px" />
            </label>
            {([
              ["borderColorTop",    "color top",    "all sides if others blank"],
              ["borderColorRight",  "color right",  ""],
              ["borderColorBottom", "color bottom", ""],
              ["borderColorLeft",   "color left",   ""],
            ] as const).map(([k, label, hint]) => (
              <label key={k} className="dui-form__field">
                <span className="dui-form__label">{label}{hint ? <span style={{ fontWeight: 400, color: "var(--ink-muted)", marginLeft: 4 }}>— {hint}</span> : null}</span>
                <input className="dui-form__input" value={s[k]} onChange={(e) => set(k, e.target.value)} placeholder="hex or var(--token)" />
              </label>
            ))}
          </fieldset>

          <fieldset className="dui-form__fieldset">
            <legend className="dui-form__legend">radius</legend>
            {([
              ["radiusTop",    "top-left"],
              ["radiusRight",  "top-right"],
              ["radiusBottom", "bottom-right"],
              ["radiusLeft",   "bottom-left"],
            ] as const).map(([k, label]) => (
              <label key={k} className="dui-form__field">
                <span className="dui-form__label">{label}</span>
                <input className="dui-form__input" value={s[k]} onChange={(e) => set(k, e.target.value)} placeholder="0" />
              </label>
            ))}
          </fieldset>

          <fieldset className="dui-form__fieldset">
            <legend className="dui-form__legend">padding (T / R / B / L)</legend>
            {(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const).map((k) => (
              <label key={k} className="dui-form__field">
                <span className="dui-form__label">{k.replace("padding", "").toLowerCase()}</span>
                <input className="dui-form__input" value={s[k]} onChange={(e) => set(k, e.target.value)} placeholder="var(--space-4)" />
              </label>
            ))}
          </fieldset>

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setS(DEFAULTS)}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Props reference table ──────────────────────────────────────────── */

const PROPS = [
  { name: "name", type: "string", required: true,  default: "—",       desc: "Snake-case addressable ID (^[a-z0-9_]{1,64}$). Used by the substrate and help system. Invalid names throw synchronously." },
  { name: "title", type: "ReactNode", required: false, default: "undefined", desc: "Renders a <header> with <h2> + help icon. Omit for a title-less panel — the help icon floats in the top-right corner instead." },
  { name: "helpable", type: "boolean", required: false, default: "registry value", desc: "Override the substrate's helpable flag. Pass false to suppress the help icon entirely — useful when a parent Panel owns the help context." },
  { name: "className", type: "string", required: false, default: "undefined", desc: "Extra CSS class(es) appended to the root <section class=\"panel …\">." },
  { name: "children", type: "ReactNode", required: false, default: "undefined", desc: "Content rendered inside panel__body." },
  { name: "margin", type: "[string?, string?, string?, string?]", required: false, default: "0 all sides", desc: "Shorthand [top, right, bottom, left] margin. Each slot is a CSS string. Omitted slots default to \"0\"." },
  { name: "padding", type: "[string?, string?, string?, string?]", required: false, default: "var(--space-4) all sides", desc: "Shorthand [top, right, bottom, left] padding. Omitted slots default to var(--space-4)." },
  { name: "border", type: "{ type?, width?, color? }", required: false, default: "1px solid var(--border)", desc: "Partial object — only supplied keys override the CSS default. type accepts solid | dashed | dotted | none." },
  { name: "background", type: "string", required: false, default: "transparent", desc: "Any CSS colour string — hex, token, keyword. Defaults to transparent when omitted." },
  { name: "radius", type: "{ top?, right?, bottom?, left? }", required: false, default: "0 all corners", desc: "Per-corner border-radius. top=TL, right=TR, bottom=BR, left=BL. Omitted keys default to \"0\"." },
];

function PropsTable() {
  return (
    <div className="dui-panel" style={{ marginTop: "var(--space-4)" }}>
      <table className="dui-table">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>Required</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {PROPS.map((p) => (
            <tr key={p.name}>
              <td className="dui-table__cell--mono dui-table__cell--name">{p.name}</td>
              <td className="dui-table__cell--mono dui-table__cell--muted" style={{ whiteSpace: "nowrap" }}>{p.type}</td>
              <td style={{ textAlign: "center" }}>{p.required ? "✓" : ""}</td>
              <td className="dui-table__cell--mono dui-table__cell--muted">{p.default}</td>
              <td style={{ fontSize: 12, lineHeight: 1.5 }}>{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── QRCode playground ──────────────────────────────────────────────── */

interface QRPlaygroundState {
  value: string;
  size: string;
  render: QRCodeRender;
  level: QRCodeLevel;
  showLogo: boolean;
  logoSize: string;
  caption: string;
}

const QR_DEFAULTS: QRPlaygroundState = {
  value: "https://vector.app/redesign",
  size: "256",
  render: "svg",
  level: "Q",
  showLogo: true,
  logoSize: "0.18",
  caption: "",
};

function QRCodePlayground() {
  const [s, setS] = useState<QRPlaygroundState>(QR_DEFAULTS);
  const set = <K extends keyof QRPlaygroundState>(k: K, v: QRPlaygroundState[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const sizeNum = parseInt(s.size, 10) || 256;
  const logoSizeNum = parseFloat(s.logoSize) || 0.18;

  const jsx = [
    `<QRCode`,
    `  value="${s.value}"`,
    s.size !== "256"           ? `  size={${sizeNum}}` : null,
    s.render !== "svg"         ? `  render="${s.render}"` : null,
    s.level !== "Q"            ? `  level="${s.level}"` : null,
    !s.showLogo                ? `  logo={false}` : null,
    s.showLogo && s.logoSize !== "0.18" ? `  logoSize={${logoSizeNum}}` : null,
    s.caption                  ? `  caption="${s.caption}"` : null,
    `/>`,
  ].filter(Boolean).join("\n");

  return (
    <div className="dui-cat__section" id="qr-code-props">
      <h2 className="dui-doc__h2">Props &amp; Playground</h2>
      <p className="dui-doc__p">
        Adjust the controls to see props update the live preview in real time. The JSX snippet below reflects the current configuration.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--space-6)", alignItems: "start", marginTop: "var(--space-4)" }}>

        {/* Live preview */}
        <div>
          <div className="dui-cat__demo-label">Live preview</div>
          <div style={{ padding: "var(--space-4)", background: "var(--surface-sunken)", borderRadius: 6, display: "flex", justifyContent: "center" }}>
            {s.value ? (
              <QRCode
                value={s.value}
                size={sizeNum}
                render={s.render}
                level={s.level}
                logo={s.showLogo ? undefined : false}
                logoSize={logoSizeNum}
                caption={s.caption || undefined}
              />
            ) : (
              <p style={{ fontSize: 13, color: "var(--ink-muted)" }}>Enter a value to render a code.</p>
            )}
          </div>
          <div className="dui-cat__demo-label" style={{ marginTop: "var(--space-4)" }}>JSX</div>
          <pre className="dui-doc__code">{jsx}</pre>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div className="dui-cat__demo-label">Controls</div>

          <label className="dui-form__field">
            <span className="dui-form__label">value</span>
            <input
              className="dui-form__input"
              value={s.value}
              onChange={(e) => set("value", e.target.value)}
              placeholder="URL or any string"
            />
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">size (px)</span>
            <input
              className="dui-form__input"
              value={s.size}
              onChange={(e) => set("size", e.target.value)}
              placeholder="256"
            />
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">render</span>
            <select className="dui-form__select" value={s.render} onChange={(e) => set("render", e.target.value as QRCodeRender)}>
              <option value="svg">svg</option>
              <option value="canvas">canvas</option>
            </select>
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">level (ECC)</span>
            <select className="dui-form__select" value={s.level} onChange={(e) => set("level", e.target.value as QRCodeLevel)}>
              <option value="L">L — 7%</option>
              <option value="M">M — 15%</option>
              <option value="Q">Q — 25%</option>
              <option value="H">H — 30%</option>
            </select>
          </label>

          <label className="dui-form__field dui-form__field--inline">
            <input
              type="checkbox"
              checked={s.showLogo}
              onChange={(e) => set("showLogo", e.target.checked)}
            />
            <span className="dui-form__label">show logo overlay</span>
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">logoSize (0–0.22)</span>
            <input
              className="dui-form__input"
              value={s.logoSize}
              onChange={(e) => set("logoSize", e.target.value)}
              placeholder="0.18"
              disabled={!s.showLogo}
            />
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">caption</span>
            <input
              className="dui-form__input"
              value={s.caption}
              onChange={(e) => set("caption", e.target.value)}
              placeholder="(no caption)"
            />
          </label>

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setS(QR_DEFAULTS)}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

const QR_PROPS = [
  { name: "value",     type: "string",                  required: true,  default: "—",       desc: "What the code encodes — URL, identifier, or any string. Empty value renders nothing." },
  { name: "size",      type: "number",                  required: false, default: "256",     desc: "Pixel size of the square code. Each QR module ends up roughly size / version-modules pixels — keep size ≥ 4× the version-module count for reliable scanning." },
  { name: "render",    type: "'svg' | 'canvas'",        required: false, default: "'svg'",   desc: "SVG scales crisp, themes via CSS tokens, prints cleanly. Canvas is faster on the first paint and produces a smaller DOM but does not theme without re-render." },
  { name: "level",     type: "'L' | 'M' | 'Q' | 'H'",   required: false, default: "'Q'",     desc: "Error correction level — recovery budget against smudges or logo overlay. Q (25%) is the default to leave headroom for the centre logo." },
  { name: "logo",      type: "ReactNode | false",       required: false, default: "VectorMark", desc: "Centre overlay. Pass false to disable; pass any ReactNode to override the default inline-SVG Vector mark." },
  { name: "logoSize",  type: "number",                  required: false, default: "0.18",    desc: "Fraction of total size occupied by the logo. Clamped to [0, 0.22] so the white plate stays inside the ECC recovery budget." },
  { name: "caption",   type: "string",                  required: false, default: "undefined", desc: "Optional text rendered under the code; doubles as the aria-labelledby target for accessibility." },
  { name: "className", type: "string",                  required: false, default: "undefined", desc: "Extra CSS class(es) appended to the root container." },
];

function QRPropsTable() {
  return (
    <div className="dui-panel" style={{ marginTop: "var(--space-4)" }}>
      <table className="dui-table">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>Required</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {QR_PROPS.map((p) => (
            <tr key={p.name}>
              <td className="dui-table__cell--mono dui-table__cell--name">{p.name}</td>
              <td className="dui-table__cell--mono dui-table__cell--muted" style={{ whiteSpace: "nowrap" }}>{p.type}</td>
              <td style={{ textAlign: "center" }}>{p.required ? "✓" : ""}</td>
              <td className="dui-table__cell--mono dui-table__cell--muted">{p.default}</td>
              <td style={{ fontSize: 12, lineHeight: 1.5 }}>{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── QRCodeTrigger playground ───────────────────────────────────────── */

interface QRTriggerPlaygroundState {
  useCustomValue: boolean;
  value: string;
  label: string;
}

const QRT_DEFAULTS: QRTriggerPlaygroundState = {
  useCustomValue: false,
  value: "",
  label: "",
};

function QRCodeTriggerPlayground() {
  const [s, setS] = useState<QRTriggerPlaygroundState>(QRT_DEFAULTS);
  const set = <K extends keyof QRTriggerPlaygroundState>(k: K, v: QRTriggerPlaygroundState[K]) =>
    setS((prev) => ({ ...prev, [k]: v }));

  const jsx = [
    `<QRCodeTrigger`,
    s.useCustomValue && s.value ? `  value="${s.value}"` : null,
    s.label                     ? `  label="${s.label}"` : null,
    `/>`,
  ].filter(Boolean).join("\n");

  return (
    <div className="dui-cat__section" id="qr-code-trigger-props">
      <h2 className="dui-doc__h2">Props &amp; Playground</h2>
      <p className="dui-doc__p">
        QRCodeTrigger has a very small surface — two optional props. Click the trigger in the preview to open the full-size popover.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--space-6)", alignItems: "start", marginTop: "var(--space-4)" }}>

        {/* Live preview */}
        <div>
          <div className="dui-cat__demo-label">Live preview</div>
          <div style={{ padding: "var(--space-4)", background: "var(--surface-sunken)", borderRadius: 6, display: "flex", justifyContent: "center" }}>
            <QRCodeTrigger
              value={s.useCustomValue && s.value ? s.value : undefined}
              label={s.label || undefined}
            />
          </div>
          <div className="dui-cat__demo-label" style={{ marginTop: "var(--space-4)" }}>JSX</div>
          <pre className="dui-doc__code">{jsx}</pre>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div className="dui-cat__demo-label">Controls</div>

          <label className="dui-form__field dui-form__field--inline">
            <input
              type="checkbox"
              checked={s.useCustomValue}
              onChange={(e) => set("useCustomValue", e.target.checked)}
            />
            <span className="dui-form__label">override value (else uses origin+pathname)</span>
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">value</span>
            <input
              className="dui-form__input"
              value={s.value}
              onChange={(e) => set("value", e.target.value)}
              placeholder="URL to encode"
              disabled={!s.useCustomValue}
            />
          </label>

          <label className="dui-form__field">
            <span className="dui-form__label">aria-label</span>
            <input
              className="dui-form__input"
              value={s.label}
              onChange={(e) => set("label", e.target.value)}
              placeholder="Show QR code for this page"
            />
          </label>

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setS(QRT_DEFAULTS)}
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

const QRT_PROPS = [
  { name: "value", type: "string", required: false, default: "window.location.origin + pathname", desc: "Override the auto-resolved page URL. Useful when the trigger represents something other than the current page (e.g. a sharable artefact link)." },
  { name: "label", type: "string", required: false, default: "'Show QR code for this page'", desc: "aria-label applied to the trigger button. Override for non-default contexts so assistive tech reads the right purpose." },
];

function QRTriggerPropsTable() {
  return (
    <div className="dui-panel" style={{ marginTop: "var(--space-4)" }}>
      <table className="dui-table">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>Required</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {QRT_PROPS.map((p) => (
            <tr key={p.name}>
              <td className="dui-table__cell--mono dui-table__cell--name">{p.name}</td>
              <td className="dui-table__cell--mono dui-table__cell--muted" style={{ whiteSpace: "nowrap" }}>{p.type}</td>
              <td style={{ textAlign: "center" }}>{p.required ? "✓" : ""}</td>
              <td className="dui-table__cell--mono dui-table__cell--muted">{p.default}</td>
              <td style={{ fontSize: 12, lineHeight: 1.5 }}>{p.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────── */

export default function DevComponentsPanel() {
  const [activeId, setActiveId] = useState("panel-synopsis");
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Collect all H2 ids in document order for IntersectionObserver.
  const allIds = COMPONENTS.flatMap((c) => c.h2s.map((h) => h.id));

  useEffect(() => {
    const visible = new Set<string>();

    const pick = () => {
      for (const id of allIds) {
        if (visible.has(id)) { setActiveId(id); return; }
      }
    };

    observerRef.current?.disconnect();
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: "-120px 0px -60% 0px", threshold: 0 }
    );

    for (const id of allIds) {
      const el = document.getElementById(id);
      if (el) observerRef.current.observe(el);
    }

    return () => observerRef.current?.disconnect();
    // allIds is stable across renders — derived from a module-level constant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="dui-toc-layout">
      <ComponentsToc activeId={activeId} onNavigate={scrollTo} />

      <div className="dui-toc__body">
        {/* ══════════════════════════════════════════════════════
            PANEL
        ══════════════════════════════════════════════════════ */}
        <article>
          <h1 className="dui-doc__h1" id="panel">Panel</h1>
          <p className="dui-doc__lead">
            <code>app/components/Panel.tsx</code> — the fundamental layout and addressable-substrate primitive.
            Every section of every page is wrapped in a Panel. It owns heading semantics, the help system,
            and the Samantha SDK address context for its subtree.
          </p>

          {/* ── Synopsis ── */}
          <section id="panel-synopsis">
            <h2 className="dui-doc__h2">Synopsis</h2>
            <p className="dui-doc__p">
              Panel renders a <code>&lt;section&gt;</code> with a <code>panel</code> CSS class, registers itself
              in the DOM Registry via <code>useRegisterAddressable</code>, and wraps its children in a
              context <code>Provider</code> so nested Panels build a dotted-path address automatically
              (e.g. <code>samantha._viewport.main._kind.panel.settings._kind.panel.users</code>).
            </p>
            <p className="dui-doc__p">
              When <code>title</code> is supplied, Panel emits a <code>&lt;header&gt;</code> containing an
              <code>&lt;h2&gt;</code> and — when the substrate marks the node as helpable — a
              <code>TbHelpHexagon</code> button. Clicking the button opens an inline dialog that shows
              the Samantha address (click to copy) and a lazy-fetched <code>HelpDoc</code> from
              <code>/api/page-help/:addressable_id</code>, falling back to SDK manifest defaults.
            </p>
            <p className="dui-doc__p">
              When <code>title</code> is omitted the heading is rendered as a visually-hidden
              <code>&lt;span class="sr-only"&gt;</code> and the help icon floats in the panel&apos;s
              top-right corner.
            </p>

            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Minimal usage</div>
              <pre className="dui-doc__code">{`<Panel name="my_section" title="Users">
  {/* children */}
</Panel>`}</pre>
              <div className="dui-cat__demo-label" style={{ marginTop: "var(--space-3)" }}>Live</div>
              <Panel name="comp_doc_synopsis_demo" title="Users">
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>Children render inside panel__body.</p>
              </Panel>
            </div>
          </section>

          {/* ── Props & Playground ── */}
          <PanelPlayground />
          <section id="panel-props-table" style={{ marginTop: "var(--space-4)" }}>
            <p className="dui-doc__p">Full prop reference:</p>
            <PropsTable />
          </section>

          {/* ── Improvements ── */}
          <section id="panel-improvements">
            <h2 className="dui-doc__h2">Improvements</h2>
            <ol className="dui-doc__list dui-doc__list--ordered">
              <li>
                <strong>Inline styles for layout props.</strong> <code>margin</code>, <code>padding</code>,
                <code>border</code>, <code>background</code>, and <code>radius</code> all write inline
                <code>style={"{{}}"}</code> — violating the project&apos;s no-inline-style rule. A
                better model: a small set of CSS custom properties scoped to <code>[data-addressable-id]</code>
                that the panel CSS reads, keeping layout props declarative without bypassing the token system.
              </li>
              <li>
                <strong>No loading / error state for the help popover.</strong> The popover shows &quot;Loading…&quot;
                then &quot;No help text yet&quot; if the fetch fails. It would be cleaner to surface a retry
                button on transient errors so gadmin authors know the panel is wired and the fetch failed,
                rather than appearing as though no help exists.
              </li>
              <li>
                <strong>Help popover is absolutely positioned in the DOM.</strong> The popover renders inside
                the <code>&lt;section&gt;</code>, which means it is clipped by any ancestor with
                <code>overflow: hidden</code>. Portalling to <code>document.body</code> (or using the native
                HTML <code>popover</code> API) would eliminate this class of clipping bugs.
              </li>
              <li>
                <strong>No <code>aria-describedby</code> wiring.</strong> The help dialog is labelled via
                <code>aria-labelledby</code> but the panel body has no association with the help content.
                Screen readers don&apos;t know the dialog describes this panel. Adding
                <code>aria-describedby</code> on the <code>&lt;section&gt;</code> pointing at the
                <code>panel__popover-body</code> when open would fix this.
              </li>
              <li>
                <strong>Margin prop is rarely used but adds API surface.</strong> In practice callers use
                utility wrappers or parent gap instead. Removing <code>margin</code> from the prop surface
                and delegating to the caller&apos;s layout would simplify the component.
              </li>
            </ol>
          </section>

          {/* ── Extensions ── */}
          <section id="panel-extensions">
            <h2 className="dui-doc__h2">Extensions</h2>
            <ol className="dui-doc__list dui-doc__list--ordered">
              <li>
                <strong>Panel variants via <code>variant</code> prop.</strong> A <code>variant</code> prop
                (<code>&quot;default&quot; | &quot;raised&quot; | &quot;flush&quot; | &quot;ghost&quot;</code>)
                would replace the current inline-style workarounds for background and border. Each variant
                maps to a pre-defined CSS class (<code>panel--raised</code>, <code>panel--flush</code>, etc.)
                that uses design tokens — consistent, themeable, no inline styles.
              </li>
              <li>
                <strong>Panel actions slot.</strong> A <code>actions?: ReactNode</code> prop rendered in the
                header alongside the help icon — for a &quot;Add&quot; button, overflow menu, or count badge.
                Currently callers put actions inside <code>children</code> and float them manually.
              </li>
              <li>
                <strong>Collapsible panels.</strong> A <code>collapsible?: boolean</code> + <code>defaultOpen?: boolean</code>
                prop pair that adds a chevron toggle to the header. The body animates open/closed.
                Useful for long settings pages with many optional sections.
              </li>
              <li>
                <strong>CSS custom property layout model.</strong> Replace the five inline-style props with
                scoped CSS variables set on the root element:
                <pre className="dui-doc__code">{`style={{ "--panel-bg": background, "--panel-radius": "8px" }}`}</pre>
                The panel stylesheet reads these variables with fallbacks to defaults — zero inline style on any child element.
              </li>
            </ol>
          </section>

          {/* ── Cross-component usage ── */}
          <section id="panel-cross-component">
            <h2 className="dui-doc__h2">Cross-component usage</h2>
            <p className="dui-doc__p">
              If the improvements (§3) and extensions (§4) above were applied, here is how Panel
              would compose with other system primitives:
            </p>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Panel + actions slot + Badge (future)</div>
              <pre className="dui-doc__code">{`<Panel
  name="users_list"
  title="Users"
  variant="raised"
  actions={<Badge kind="count" value={42} />}
>
  <Table columns={cols} rows={rows} />
</Panel>`}</pre>
            </div>

            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Panel collapsible + PageDescription (today)</div>
              <pre className="dui-doc__code">{`// PageDescription wraps Panel internally — helpable={false} suppresses
// the duplicate help icon on any child Panel inside it.
<PageDescription title="Settings" />

<Panel name="security" title="Security" helpable={false}>
  {/* This panel is addressable but defers help to the page-level doc */}
</Panel>`}</pre>
            </div>

            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Panel + variant prop (extension §1)</div>
              <pre className="dui-doc__code">{`// Before (today) — inline styles, bypasses token system:
<Panel name="callout" background="var(--surface-raised)" border={{ type: "none" }}>

// After (extension applied):
<Panel name="callout" variant="raised">
  {/* panel--raised class uses design tokens; themeable, no inline style */}
</Panel>`}</pre>
            </div>
          </section>
        </article>

        {/* ══════════════════════════════════════════════════════
            NAVIGATION PIE
        ══════════════════════════════════════════════════════ */}
        <article style={{ marginTop: "var(--space-6)" }}>
          <h1 className="dui-doc__h1" id="navigation-pie">NavigationPie</h1>
          <p className="dui-doc__lead">
            <code>app/components/NavigationPie.tsx</code> — multi-select filter primitive. Options
            render as wedges of a full circle around a central chip; click a wedge to toggle
            white ↔ filled. Singleton popover: only one open at a time; rollover onto another
            chip dismisses; ESC and leave-circle commit.
          </p>

          <section id="navigation-pie-synopsis">
            <h2 className="dui-doc__h2">Synopsis</h2>
            <p className="dui-doc__p">
              Chip-driven popover. Click the chip → pie opens; click a wedge → <code>onChange</code> fires
              with the new selection (no batched commit). Pointer-leave-circle, ESC, or
              click-chip-again all dismiss. Only one navigation-pie/starburst popover open at a time.
            </p>
            <pre className="dui-doc__code">{`<NavigationPie
  label="Status"
  options={[
    { value: "open", label: "Open" },
    { value: "in_progress", label: "In progress" },
    { value: "done", label: "Done" },
  ]}
  selected={selected}
  onChange={setSelected}
/>`}</pre>
          </section>

          <section id="navigation-pie-playground">
            <h2 className="dui-doc__h2">Playground</h2>
            <NavigationPiePlayground />
          </section>
        </article>

        {/* ══════════════════════════════════════════════════════
            QR CODE
        ══════════════════════════════════════════════════════ */}
        <article style={{ marginTop: "var(--space-6)" }}>
          <h1 className="dui-doc__h1" id="qr-code">QRCode</h1>
          <p className="dui-doc__lead">
            <code>app/components/QRCode.tsx</code> — pure QR-code renderer. Wraps the <code>qrcode</code>
            npm encoder, themes via CSS tokens, and overlays an optional centre logo on a white plate.
            Zero data-fetching, zero side effects — just <code>value</code> in, code out.
          </p>

          {/* ── Synopsis ── */}
          <section id="qr-code-synopsis">
            <h2 className="dui-doc__h2">Synopsis</h2>
            <p className="dui-doc__p">
              Pass any string as <code>value</code> and a QR code is rendered. SVG by default for crisp
              scaling and CSS-theming; canvas available via the <code>render</code> prop for cases where
              a bitmap is preferable. Error correction level (ECC) defaults to <code>Q</code> (25%) so
              the centre logo overlay has headroom inside the recovery budget.
            </p>
            <p className="dui-doc__p">
              The component is presentation-only — it does not know what the QR is for, where it sits in
              the page, or how it gets shared. <code>QRCodeTrigger</code> (below) is the in-bar wrapper
              that uses it for page sharing.
            </p>

            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Minimal usage</div>
              <pre className="dui-doc__code">{`<QRCode value="https://vector.app/redesign" />`}</pre>
              <div className="dui-cat__demo-label" style={{ marginTop: "var(--space-3)" }}>Live</div>
              <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4)", background: "var(--surface-sunken)", borderRadius: 6 }}>
                <QRCode value="https://vector.app/redesign" size={200} />
              </div>
            </div>
          </section>

          {/* ── Props & Playground ── */}
          <QRCodePlayground />
          <section style={{ marginTop: "var(--space-4)" }}>
            <p className="dui-doc__p">Full prop reference:</p>
            <QRPropsTable />
          </section>

          {/* ── Improvements ── */}
          <section id="qr-code-improvements">
            <h2 className="dui-doc__h2">Improvements</h2>
            <ol className="dui-doc__list dui-doc__list--ordered">
              <li>
                <strong><code>dangerouslySetInnerHTML</code> for the SVG.</strong> The <code>qrcode</code>
                library returns SVG markup as a string and the component injects it via
                <code>dangerouslySetInnerHTML</code>. The input is trusted (literal output of an
                encoder library) but a pure-React renderer that walks the QR matrix and emits
                <code>&lt;rect&gt;</code> children would eliminate the escape-hatch.
              </li>
              <li>
                <strong>Canvas does not re-render on theme switch.</strong> The canvas path bakes
                <code>#000000</code> / <code>#ffffff</code> into the bitmap. SVG re-themes via
                <code>currentColor</code>, but canvas needs a <code>MutationObserver</code> on the
                root CSS custom properties to know it should redraw.
              </li>
              <li>
                <strong>No async loading state.</strong> The SVG fetch is async (<code>QRCodeLib.toString</code>
                is a Promise). For the first render frame, <code>svgMarkup</code> is empty and the
                container collapses to <code>0×size</code> before snapping into place. A skeleton or
                fixed placeholder would prevent the jump.
              </li>
              <li>
                <strong>Logo plate hard-coded to white.</strong> The <code>--surface</code> token works
                for light theme but may need a tone shift in dark mode to keep the QR contrast above
                4.5:1 against the surrounding modules. A <code>logoBackground</code> prop with a
                token default would make this explicit.
              </li>
              <li>
                <strong>No way to extract the rendered output.</strong> Callers cannot get at the
                generated SVG string or canvas data-URL without re-running the encoder. A
                <code>onRendered?: (markup: string) =&gt; void</code> callback (or imperative ref)
                would let parents save / copy / download without round-tripping.
              </li>
            </ol>
          </section>

          {/* ── Extensions ── */}
          <section id="qr-code-extensions">
            <h2 className="dui-doc__h2">Extensions</h2>
            <ol className="dui-doc__list dui-doc__list--ordered">
              <li>
                <strong>Module-style variants.</strong> Today modules are square solids. A
                <code>moduleStyle?: &quot;square&quot; | &quot;dots&quot; | &quot;rounded&quot;</code>
                prop would render alternative shapes (rounded corners, dot grid) for branded codes.
                Implemented by post-processing the SVG path or by walking the matrix and emitting
                custom shapes.
              </li>
              <li>
                <strong><code>onRendered</code> callback.</strong> Fires with the final SVG markup
                (or canvas <code>toDataURL()</code> for the canvas path) once the encode completes.
                Lets the parent persist the rendered output (e.g. cache to localStorage, upload to
                short-link service).
              </li>
              <li>
                <strong>Frame + caption variant.</strong> A <code>framed?: boolean</code> prop that
                applies the same 5px white frame + caption strip used by <code>QRCodeTrigger</code>,
                so the primitive can be embedded in arbitrary &quot;Share me&quot; cards without
                duplicating the wrapper logic.
              </li>
              <li>
                <strong>Lazy encoding.</strong> For lists of many QR codes (e.g. one per artefact
                in a table), an <code>encode?: &quot;eager&quot; | &quot;lazy&quot;</code> prop +
                IntersectionObserver would defer the encode until the code scrolls into view.
              </li>
            </ol>
          </section>

          {/* ── Cross-component usage ── */}
          <section id="qr-code-cross-component">
            <h2 className="dui-doc__h2">Cross-component usage</h2>
            <p className="dui-doc__p">
              How QRCode composes with the rest of the system today, and how it could evolve with the
              extensions above:
            </p>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">QRCode + QRCodeTrigger (today)</div>
              <pre className="dui-doc__code">{`// Inside QRCodeTrigger: small QR in the bar, larger QR in the popover.
<QRCode value={resolved} size={36} level="Q" logo={false} />
<QRCode value={resolved} size={256} level="Q" />`}</pre>
            </div>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">QRCode + Panel (caption + framing)</div>
              <pre className="dui-doc__code">{`<Panel name="share_artefact" title="Scan to open">
  <QRCode
    value={artefactShareUrl}
    size={300}
    caption={artefact.title}
  />
</Panel>`}</pre>
            </div>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">QRCode + short-link service (future B-SHARE)</div>
              <pre className="dui-doc__code">{`// Once B-SHARE ships, encode the short slug instead of the full URL.
const slug = await createShortLink({ kind: "url", target_url: longUrl });
<QRCode value={\`https://vector.app/s/\${slug}\`} size={256} />`}</pre>
            </div>
          </section>
        </article>

        {/* ══════════════════════════════════════════════════════
            QR CODE TRIGGER
        ══════════════════════════════════════════════════════ */}
        <article style={{ marginTop: "var(--space-6)" }}>
          <h1 className="dui-doc__h1" id="qr-code-trigger">QRCodeTrigger</h1>
          <p className="dui-doc__lead">
            <code>app/components/QRCodeTrigger.tsx</code> — the in-bar wrapper that turns the QRCode
            primitive into a sharing affordance. A small white-framed code with a &quot;Share me&quot;
            caption opens a 256px popover with copy/download/copy-link actions on click.
          </p>

          {/* ── Synopsis ── */}
          <section id="qr-code-trigger-synopsis">
            <h2 className="dui-doc__h2">Synopsis</h2>
            <p className="dui-doc__p">
              By default the trigger encodes <code>window.location.origin + pathname</code> (no query
              string, no hash — query params are usually transient UI state, not the canonical
              address). On click, a popover opens with a 256px scannable code, the resolved URL, and
              four actions: Copy image, Download PNG, Download SVG, Copy link.
            </p>
            <p className="dui-doc__p">
              Wired into <code>RedesignTopBar</code> so every page in the redesign shell gets one
              automatically. Pass an explicit <code>value</code> to override for cases where the
              trigger should encode something other than the current page (e.g. a deep-link to a
              specific artefact).
            </p>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Minimal usage (current page URL)</div>
              <pre className="dui-doc__code">{`<QRCodeTrigger />`}</pre>
              <div className="dui-cat__demo-label" style={{ marginTop: "var(--space-3)" }}>Live</div>
              <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4)", background: "var(--surface-sunken)", borderRadius: 6 }}>
                <QRCodeTrigger />
              </div>
            </div>
          </section>

          {/* ── Props & Playground ── */}
          <QRCodeTriggerPlayground />
          <section style={{ marginTop: "var(--space-4)" }}>
            <p className="dui-doc__p">Full prop reference:</p>
            <QRTriggerPropsTable />
          </section>

          {/* ── Improvements ── */}
          <section id="qr-code-trigger-improvements">
            <h2 className="dui-doc__h2">Improvements</h2>
            <ol className="dui-doc__list dui-doc__list--ordered">
              <li>
                <strong>Popover not portalled.</strong> The popover lives inside the trigger&apos;s
                <code>&lt;div&gt;</code> with <code>position: absolute</code>, which means an ancestor
                with <code>overflow: hidden</code> will clip it. Portalling to <code>document.body</code>
                — or using the native HTML <code>popover</code> attribute — would eliminate this
                class of bugs.
              </li>
              <li>
                <strong>Clipboard API silently fails on insecure contexts.</strong> Outside HTTPS
                (and outside <code>localhost</code>), <code>navigator.clipboard.write</code> throws
                and the flash message says &quot;Action failed&quot; with no hint at why. Detecting
                <code>window.isSecureContext</code> upfront and showing a clearer message would help.
              </li>
              <li>
                <strong>No keyboard navigation inside the popover.</strong> Tab order works but there
                is no <code>↑/↓</code> arrow-key navigation between the action buttons. For an
                affordance that lives in every page header, that&apos;s sub-par for keyboard-first
                users.
              </li>
              <li>
                <strong>URL re-resolves on every pathname change.</strong> The <code>useEffect</code>
                dependency on <code>pathname</code> means a Next.js navigation triggers a re-render
                even while the popover is open — the QR in the popover then shifts to the new URL,
                which can be surprising. Freezing the value on open would be more predictable.
              </li>
              <li>
                <strong>Copy/download work but produce no telemetry.</strong> No way to know if anyone
                is actually using the share trigger. A simple click counter (per-action) sent to
                Vector&apos;s analytics surface would inform whether to invest in the short-link
                service (parked theme B-SHARE).
              </li>
            </ol>
          </section>

          {/* ── Extensions ── */}
          <section id="qr-code-trigger-extensions">
            <h2 className="dui-doc__h2">Extensions</h2>
            <ol className="dui-doc__list dui-doc__list--ordered">
              <li>
                <strong>Short-link integration (B-SHARE).</strong> When the parked short-link service
                ships, the popover mints <code>/s/&lt;slug&gt;</code> on open and encodes that
                instead of the raw URL. Saved-views and filter-states then fit in a sparse QR.
              </li>
              <li>
                <strong><code>encode?: (raw: string) =&gt; Promise&lt;string&gt;</code> prop.</strong>
                Lets the caller hook in a custom encoder (URL signer, tenant-scoped tokeniser,
                short-link minter) without coupling the component to a specific service.
              </li>
              <li>
                <strong>Variants for the in-bar size.</strong> A <code>size?: &quot;sm&quot; | &quot;md&quot; | &quot;lg&quot;</code>
                prop would allow QRCodeTrigger to fit other surfaces (compact toolbars, large
                empty-state cards) without per-callsite CSS overrides.
              </li>
              <li>
                <strong>Action customisation.</strong> An <code>actions?: Array&lt;&quot;copy-image&quot; | &quot;download-png&quot; | &quot;download-svg&quot; | &quot;copy-link&quot;&gt;</code>
                prop to let callers turn off actions that don&apos;t apply (e.g. a public-share
                trigger might omit &quot;copy link&quot; if the URL is sensitive).
              </li>
              <li>
                <strong>Slot for extra popover content.</strong> A <code>popoverFooter?: ReactNode</code>
                prop for cases like &quot;expires in 24h&quot; status text, or a &quot;regenerate
                link&quot; button when integrated with short-links.
              </li>
            </ol>
          </section>

          {/* ── Cross-component usage ── */}
          <section id="qr-code-trigger-cross-component">
            <h2 className="dui-doc__h2">Cross-component usage</h2>
            <p className="dui-doc__p">
              Where QRCodeTrigger sits in the page chrome today, and how it could expand:
            </p>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">RedesignTopBar (today)</div>
              <pre className="dui-doc__code">{`// app/redesign/components/RedesignTopBar.tsx
<div className="nav-top-bar__Actions">
  {pageHeader?.actions}
  <QRCodeTrigger />
</div>`}</pre>
            </div>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Per-artefact share (future)</div>
              <pre className="dui-doc__code">{`// On an artefact detail page, override the URL to encode this
// artefact's canonical link, not the page URL.
<QRCodeTrigger
  value={\`https://vector.app/work-items/\${artefact.id}\`}
  label={\`Share \${artefact.title}\`}
/>`}</pre>
            </div>
            <div className="dui-cat__section">
              <div className="dui-cat__demo-label">Public stakeholder share (future, with B-SHARE)</div>
              <pre className="dui-doc__code">{`// Mint a short-link with expiry, encode the slug.
const { slug } = await createShortLink({
  kind: "url",
  target_url: window.location.href,
  expires_in_seconds: 60 * 60 * 24, // 24h
});
<QRCodeTrigger value={\`https://vector.app/s/\${slug}\`} />`}</pre>
            </div>
          </section>
        </article>
      </div>
    </div>
  );
}

function NavigationPiePlayground() {
  const [selected, setSelected] = useState<string[]>([]);
  const OPTS = [
    { value: "open",        label: "Open" },
    { value: "in_progress", label: "In progress" },
    { value: "in_review",   label: "In review" },
    { value: "done",        label: "Done" },
    { value: "cancelled",   label: "Cancelled" },
  ];
  return (
    <div className="dui-cat__section">
      <div className="dui-cat__demo-label">Live</div>
      <div className="dui-cat__demo">
        <NavigationPie
          label="Status"
          options={OPTS}
          selected={selected}
          onChange={setSelected}
        />
      </div>
      <div className="dui-cat__demo-label" style={{ marginTop: "var(--space-3)" }}>
        Selection: {selected.length === 0 ? "(none)" : selected.join(", ")}
      </div>
    </div>
  );
}
