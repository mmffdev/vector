"use client";

import { useEffect, useRef, useState } from "react";
import type { ResearchMeta } from "@/app/api/dev/research/route";

function pickContrastFor(color: string): string {
  if (typeof document === "undefined") return "#000";
  const ctx = (pickContrastFor as any)._ctx as CanvasRenderingContext2D | undefined
    ?? ((pickContrastFor as any)._ctx = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      return c.getContext("2d", { willReadFrequently: true })!;
    })());
  ctx.clearRect(0, 0, 1, 1);
  try { ctx.fillStyle = color; } catch { return "#000"; }
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  // For low alpha, fall back to ink text
  if (a < 64) return "currentColor";
  return lum > 0.55 ? "#000" : "#fff";
}

function resolveSwatches(root: HTMLElement) {
  const swatches = root.querySelectorAll<HTMLElement>("[data-color-token]");
  const cs = getComputedStyle(document.documentElement);
  swatches.forEach(el => {
    const token = el.dataset.colorToken;
    if (!token) return;
    const value = cs.getPropertyValue(token).trim();
    if (!value) {
      el.textContent = token + " (unbound)";
      return;
    }
    el.style.background = value;
    el.style.color = pickContrastFor(value);
    el.textContent = value;
  });
}

const PAGE_SIZES = [5, 10, 25, 50, 0]; // 0 = All
const DEFAULT_PAGE_SIZE = 25;

function pageSizeLabel(n: number) {
  return n === 0 ? "All" : String(n);
}

function ResearchItem({ meta }: { meta: ResearchMeta }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || content === null) return;
    resolveSwatches(el);

    const reapply = () => resolveSwatches(el);
    const rafReapply = () => requestAnimationFrame(() => requestAnimationFrame(reapply));

    const docObs = new MutationObserver(rafReapply);
    docObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const headObs = new MutationObserver(rafReapply);
    headObs.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

    return () => {
      docObs.disconnect();
      headObs.disconnect();
    };
  }, [content]);

  async function loadContent() {
    if (content !== null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/research?id=${encodeURIComponent(meta.id)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setContent(data.content ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!open) loadContent();
    setOpen(o => !o);
  }

  return (
    <div className="accordion__item">
      <button className="accordion__toggle" onClick={toggle}>
        <span className="dev-research-id">{meta.id}</span>
        <span className="dev-research-meta">
          <span className="dev-research-title">{meta.title}</span>
          <span className="dev-research-category">{meta.category}</span>
          <span className="dev-research-date">{meta.date}</span>
        </span>
        <span className="dev-research-summary">{meta.summary}</span>
        <span className={`accordion__chevron${open ? "" : " accordion__chevron--closed"}`} />
      </button>
      {open && (
        <div className="accordion__body dev-research-body">
          {loading && <div className="dev-research-loading">Loading…</div>}
          {error && <div className="dev-alert dev-alert--error">{error}</div>}
          {content !== null && !loading && (
            <div
              ref={contentRef}
              className="dev-research-content"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default function DevResearchPanel() {
  const [reports, setReports] = useState<ResearchMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/research");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load research reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const q = search.toLowerCase();
  const filtered = q
    ? reports.filter(r =>
        r.title.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        r.topic.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q)
      )
    : reports;

  const effective = pageSize === 0 ? filtered.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / (effective || 1)));
  const visible = pageSize === 0
    ? filtered
    : filtered.slice((page - 1) * pageSize, page * pageSize);

  function setPageSizeAndReset(n: number) {
    setPageSize(n);
    setPage(1);
  }

  function setSearchAndReset(s: string) {
    setSearch(s);
    setPage(1);
  }

  return (
    <div className="dev-research-panel">
      <div className="dev-research-header">
        <div>
          <p className="dev-p" style={{ marginBottom: 0 }}>
            Reports generated by <code>/research</code> in the CLI. Each run saves a JSON file in <code>dev/research/</code>.
          </p>
        </div>
        <button onClick={load} disabled={loading} className="dev-btn dev-btn--sm">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="dev-research-toolbar">
        <input
          type="search"
          className="dev-research-search"
          placeholder="Search by title, category, or topic…"
          value={search}
          onChange={e => setSearchAndReset(e.target.value)}
        />
        <div className="dev-research-pagesizes">
          {PAGE_SIZES.map(n => (
            <button
              key={n}
              className={`dev-research-pagesize${pageSize === n ? " dev-research-pagesize--active" : ""}`}
              onClick={() => setPageSizeAndReset(n)}
            >
              {pageSizeLabel(n)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="dev-alert dev-alert--error">{error}</div>}

      {!loading && reports.length === 0 && !error && (
        <div className="dev-research-empty">
          No research reports yet. Run <code>/research</code> in the Claude Code CLI to generate one.
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <div className="accordion">
            {visible.map(r => <ResearchItem key={r.id} meta={r} />)}
          </div>

          {pageSize !== 0 && totalPages > 1 && (
            <div className="dev-research-pagination">
              <button
                className="dev-accordion-toolbar__page-btn"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                aria-label="Previous page"
              >‹</button>
              <span className="dev-accordion-toolbar__page-info">{page} / {totalPages}</span>
              <button
                className="dev-accordion-toolbar__page-btn"
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                aria-label="Next page"
              >›</button>
            </div>
          )}
        </>
      )}

      {!loading && filtered.length === 0 && reports.length > 0 && (
        <div className="dev-research-empty">
          No reports match &ldquo;<em>{search}</em>&rdquo;.
        </div>
      )}
    </div>
  );
}
