"use client";

/**
 * DevUiCatalogPanel — live preview of every primitive in dev/styles/dev-ui.css
 * Story 00402 (PLA-0013).
 *
 * If you add a new primitive family to dev-ui.css, add a section here so
 * authors can see what they're allowed to use without grepping the stylesheet.
 */

import { useState } from "react";

const PILLS: Array<{ mod: string; label: string }> = [
  { mod: "neutral", label: "Neutral" },
  { mod: "pass", label: "Pass" },
  { mod: "warn", label: "Warn" },
  { mod: "fail", label: "Fail" },
  { mod: "info", label: "Info" },
];

const HEATS: Array<{ mod: string; label: string }> = [
  { mod: "", label: "Idle" },
  { mod: "s1", label: "S1" },
  { mod: "s2", label: "S2" },
  { mod: "s3", label: "S3" },
  { mod: "s4", label: "S4" },
  { mod: "s5", label: "S5" },
];

export default function DevUiCatalogPanel() {
  const [openAcc, setOpenAcc] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const ready = confirmText === "RESET";

  return (
    <div className="dui-page">
      <div className="dui-page__header">
        <div>
          <h2 className="dui-page__title">UI Catalog</h2>
          <div className="dui-page__subtitle">
            Every primitive in <code>dev/styles/dev-ui.css</code>. New dev panels MUST compose
            from these classes — no bespoke per-page selectors.
          </div>
        </div>
      </div>

      {/* 1. Page shell */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          1. Page shell <span className="dui-cat__class">.dui-page · .dui-page__header · .dui-page__title</span>
        </h3>
        <p className="dui-cat__section-desc">Top-level frame for every Dev Setup tab.</p>
      </section>

      {/* 2. Panel */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          2. Panel <span className="dui-cat__class">.dui-panel · .dui-panel__header · .dui-panel__body</span>
        </h3>
        <div className="dui-panel">
          <div className="dui-panel__header">
            <h4 className="dui-panel__title">Sample panel</h4>
            <span className="dui-pill dui-pill--neutral">42 items</span>
          </div>
          <div className="dui-panel__body">
            <p className="dui-page__subtitle" style={{ margin: 0 }}>
              Panel body content. Use <code>.dui-panel__body--flush</code> when wrapping a table.
            </p>
          </div>
          <div className="dui-panel__footer">Footer line — token-driven.</div>
        </div>
      </section>

      {/* 3. Toolbar + 4. Search + 5. Pager */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          3+4+5. Toolbar / Search / Pager <span className="dui-cat__class">.dui-toolbar · .dui-search · .dui-pager</span>
        </h3>
        <div className="dui-toolbar">
          <input className="dui-search" placeholder="Search…" />
          <div className="dui-pager__sizes">
            <button className="dui-pager__size">10</button>
            <button className="dui-pager__size is-active">25</button>
            <button className="dui-pager__size">50</button>
          </div>
        </div>
        <div className="dui-toolbar">
          <div className="dui-toolbar__filters">
            <button className="dui-toolbar__filter is-active">
              All <span className="dui-toolbar__filter-count">42</span>
            </button>
            <button className="dui-toolbar__filter">
              Open <span className="dui-toolbar__filter-count">7</span>
            </button>
            <button className="dui-toolbar__filter">
              Closed <span className="dui-toolbar__filter-count">35</span>
            </button>
          </div>
          <div className="dui-toolbar__spacer" />
          <div className="dui-pager">
            <button className="dui-pager__btn" disabled>‹</button>
            <span className="dui-pager__info">1 / 4</span>
            <button className="dui-pager__btn">›</button>
          </div>
        </div>
      </section>

      {/* 6. Table */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          6. Table <span className="dui-cat__class">.dui-table · .dui-table__cell--*</span>
        </h3>
        <div className="dui-panel">
          <table className="dui-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Path</th>
                <th className="dui-table__cell--numeric">Size</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              <tr className="is-clickable">
                <td className="dui-table__cell--name">CLAUDE.md</td>
                <td className="dui-table__cell--mono dui-table__cell--muted">.claude/CLAUDE.md</td>
                <td className="dui-table__cell--numeric">12.4 kB</td>
                <td className="dui-table__cell--muted dui-table__cell--nowrap">2026-05-05</td>
              </tr>
              <tr className="dui-table__group">
                <td colSpan={4}>Group: docs</td>
              </tr>
              <tr className="is-clickable">
                <td className="dui-table__cell--name">c_security.md</td>
                <td className="dui-table__cell--mono dui-table__cell--muted">docs/c_security.md</td>
                <td className="dui-table__cell--numeric">8.1 kB</td>
                <td className="dui-table__cell--muted dui-table__cell--nowrap">2026-05-04</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 7. Accordion */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          7. Accordion <span className="dui-cat__class">.dui-accordion · .dui-accordion__toggle · .dui-accordion__body</span>
        </h3>
        <div className="dui-accordion">
          <div className="dui-accordion__item">
            <button
              type="button"
              className={`dui-accordion__toggle dui-accordion__toggle--pass`}
              onClick={() => setOpenAcc((v) => !v)}
            >
              <span className={`dui-accordion__chevron${openAcc ? "" : " dui-accordion__chevron--closed"}`} />
              <span className="dui-meta__id">R001</span>
              <span className="dui-accordion__name">Sample paper — passing report row</span>
              <span className="dui-pill dui-pill--pass">Pass</span>
            </button>
            {openAcc && (
              <div className="dui-accordion__body">
                Body content. Use <code>.dui-accordion__body--flush</code> for table-only bodies.
              </div>
            )}
          </div>
          <div className="dui-accordion__item">
            <button type="button" className="dui-accordion__toggle dui-accordion__toggle--warn">
              <span className="dui-accordion__chevron dui-accordion__chevron--closed" />
              <span className="dui-meta__id">R002</span>
              <span className="dui-accordion__name">Warn-bordered toggle</span>
              <span className="dui-pill dui-pill--warn">Warn</span>
            </button>
          </div>
          <div className="dui-accordion__item">
            <button type="button" className="dui-accordion__toggle dui-accordion__toggle--fail">
              <span className="dui-accordion__chevron dui-accordion__chevron--closed" />
              <span className="dui-meta__id">R003</span>
              <span className="dui-accordion__name">Fail-bordered toggle</span>
              <span className="dui-pill dui-pill--fail">Fail</span>
            </button>
          </div>
        </div>
      </section>

      {/* 8. TOC */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          8. TOC <span className="dui-cat__class">.dui-toc-layout · .dui-toc · .dui-toc__list</span>
        </h3>
        <div className="dui-toc-layout">
          <nav className="dui-toc">
            <div className="dui-toc__label">On this page</div>
            <ul className="dui-toc__list">
              <li><a href="#a" className="is-active">Active section</a></li>
              <li><a href="#b">Idle section</a></li>
              <li><a href="#c">Another section</a></li>
            </ul>
          </nav>
          <div className="dui-toc__body">
            <div className="dui-doc">
              <h2>9. Doc body</h2>
              <p>
                The <code>.dui-doc</code> primitive renders long-form HTML with token-driven
                typography, lists, code blocks, and tables. Use it inside the right column of
                <code>.dui-toc-layout</code> or as a standalone reading frame.
              </p>
              <ul>
                <li>Bullet one</li>
                <li>Bullet two</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 10. Meta strip */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          10. Meta strip <span className="dui-cat__class">.dui-meta · .dui-meta__id · .dui-meta__title · .dui-meta__sub</span>
        </h3>
        <div className="dui-cat__demo">
          <div className="dui-meta">
            <span className="dui-meta__id">PLA-0013</span>
            <span className="dui-meta__title">Dev-UI Primitives & Migration</span>
            <span className="dui-meta__sub">2026-05-05</span>
            <span className="dui-meta__summary">Standardize dev-setup CSS into a single catalog.</span>
          </div>
        </div>
      </section>

      {/* 11. Pills */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          11. Pills <span className="dui-cat__class">.dui-pill · .dui-pill--*</span>
        </h3>
        <div className="dui-cat__demo" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {PILLS.map((p) => (
            <span key={p.mod} className={`dui-pill dui-pill--${p.mod}`}>
              {p.label}
            </span>
          ))}
        </div>
      </section>

      {/* 12. Heat dots */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          12. Heat dots <span className="dui-cat__class">.dui-heat · .dui-heat--s1..s5</span>
        </h3>
        <div className="dui-cat__demo" style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          {HEATS.map((h) => (
            <span key={h.mod || "idle"} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span className={`dui-heat${h.mod ? ` dui-heat--${h.mod}` : ""}`} />
              {h.label}
            </span>
          ))}
        </div>
      </section>

      {/* 13. Form */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          13. Form fields <span className="dui-cat__class">.dui-form__switch · .dui-form__confirm · .dui-form__hint</span>
        </h3>
        <div className="dui-cat__demo" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <label className="dui-form__switch">
            <input type="checkbox" defaultChecked /> Sample switch
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              className={`dui-form__confirm${ready ? " is-ready" : ""}`}
              placeholder="Type RESET"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            <span className="dui-form__hint">
              Type <strong>RESET</strong> to confirm. Idle = danger; matched = success.
            </span>
          </div>
        </div>
      </section>

      {/* 14. Empty / loading */}
      <section className="dui-cat__section">
        <h3 className="dui-cat__section-title">
          14. Empty / Loading <span className="dui-cat__class">.dui-empty · .dui-loading</span>
        </h3>
        <div className="dui-empty">
          No items yet. Try running <code>&lt;memory&gt; -A</code>.
        </div>
        <div className="dui-loading" style={{ marginTop: 12 }}>
          <span className="dui-loading__spinner" />
          Loading…
        </div>
      </section>
    </div>
  );
}
