"use client";

import { useEffect, useRef, useState } from "react";
import { useDevTab } from "@/app/contexts/DevTabContext";
import type { OperationMeta } from "@/app/api/dev/operations/route";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";
import Panel from "@/app/components/Panel";

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

const PAGE_SIZES = [5, 10, 25, 50, 0];
const DEFAULT_PAGE_SIZE = 25;

function pageSizeLabel(n: number) {
  return n === 0 ? "All" : String(n);
}

function OperationItem({ meta }: { meta: OperationMeta }) {
  const { openOperations, toggleOperation } = useDevTab();
  const isOpen = openOperations.has(meta.id);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  async function loadContent() {
    if (content !== null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/operations?id=${encodeURIComponent(meta.id)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setContent(data.content ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load operation.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (isOpen && content === null && !loading) {
      loadContent();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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

    const headings = Array.from(el.querySelectorAll<HTMLElement>("h2[id]"));
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>(".dui-toc__list a, .r-toc__list a"));
    const linkById = new Map(links.map(a => [a.getAttribute("href")?.slice(1) ?? "", a]));
    let clickLockUntil = 0;

    const setActive = (id: string | null) => {
      links.forEach(a => a.classList.remove("is-active"));
      if (id) linkById.get(id)?.classList.add("is-active");
    };

    const onLinkClick = (e: Event) => {
      const a = e.currentTarget as HTMLAnchorElement;
      const id = a.getAttribute("href")?.slice(1);
      if (!id) return;
      clickLockUntil = Date.now() + 800;
      setActive(id);
    };
    links.forEach(a => a.addEventListener("click", onLinkClick));

    let io: IntersectionObserver | null = null;
    if (headings.length) {
      const visible = new Map<string, number>();
      io = new IntersectionObserver(
        entries => {
          if (Date.now() < clickLockUntil) return;
          entries.forEach(en => {
            const id = (en.target as HTMLElement).id;
            if (en.isIntersecting) visible.set(id, en.intersectionRatio);
            else visible.delete(id);
          });
          if (visible.size) {
            let topId: string | null = null;
            let topY = Infinity;
            visible.forEach((_, id) => {
              const h = headings.find(h => h.id === id);
              if (!h) return;
              const y = h.getBoundingClientRect().top;
              if (y < topY) { topY = y; topId = id; }
            });
            setActive(topId);
          } else {
            const above = headings
              .filter(h => h.getBoundingClientRect().top < 80)
              .pop();
            if (above) setActive(above.id);
          }
        },
        { rootMargin: "-72px 0px -65% 0px", threshold: [0, 0.1, 0.5, 1] }
      );
      headings.forEach(h => io!.observe(h));
      setActive(headings[0].id);
    }

    return () => {
      docObs.disconnect();
      headObs.disconnect();
      io?.disconnect();
      links.forEach(a => a.removeEventListener("click", onLinkClick));
    };
  }, [content]);

  const header = (
    <span className="dui-meta">
      <span className="dui-meta__id">{meta.id}</span>
      <span className="dui-meta__title">{meta.title}</span>
      <span className="dui-meta__sub">
        <span>{meta.category}</span>
        <span>{meta.date}</span>
      </span>
      <span className="dui-meta__summary">{meta.summary}</span>
    </span>
  );

  return (
    <DevAccordionItem
      header={header}
      open={isOpen}
      onOpenChange={(next) => {
        if (next) loadContent();
        toggleOperation(meta.id, next);
      }}
    >
      {loading && (
        <div className="dui-loading">
          <span className="dui-loading__spinner" aria-hidden="true" />
          Loading…
        </div>
      )}
      {error && <div className="dui-empty">{error}</div>}
      {content !== null && !loading && (
        <div
          ref={contentRef}
          className="dui-doc"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      )}
    </DevAccordionItem>
  );
}

export default function DevOperationsPanel() {
  const [reports, setReports] = useState<OperationMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/operations");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setReports(data.reports ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load operations.");
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
        r.summary.toLowerCase().includes(q) ||
        r.content_text.toLowerCase().includes(q)
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
    <Panel name="dev_operations" title="Operations">
      <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Operations</h1>
            <p className="dui-page__subtitle">
              Operational runbooks and procedures. Each entry is a JSON file in <code>dev/operations/</code>.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="dui-pager__btn"
            aria-label="Refresh operations list"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        <div className="dui-toolbar">
          <input
            type="search"
            className="dui-search"
            placeholder="Search by title, category, or topic…"
            value={search}
            onChange={e => setSearchAndReset(e.target.value)}
          />
          <div className="dui-toolbar__spacer" />
          <div className="dui-pager__sizes" role="group" aria-label="Page size">
            {PAGE_SIZES.map(n => (
              <button
                key={n}
                className={`dui-pager__size${pageSize === n ? " is-active" : ""}`}
                onClick={() => setPageSizeAndReset(n)}
                aria-pressed={pageSize === n}
              >
                {pageSizeLabel(n)}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="dui-empty">{error}</div>}

        {!loading && reports.length === 0 && !error && (
          <div className="dui-empty">
            No operations yet. Add a JSON file to <code>dev/operations/</code> following the <code>O###.json</code> naming pattern.
          </div>
        )}

        {filtered.length > 0 && (
          <>
            <DevAccordion>
              {visible.map(r => <OperationItem key={r.id} meta={r} />)}
            </DevAccordion>

            {pageSize !== 0 && totalPages > 1 && (
              <div className="dui-pager">
                <button
                  className="dui-pager__btn"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                >‹</button>
                <span className="dui-pager__info">{page} / {totalPages}</span>
                <button
                  className="dui-pager__btn"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                >›</button>
              </div>
            )}
          </>
        )}

        {!loading && filtered.length === 0 && reports.length > 0 && (
          <div className="dui-empty">
            No operations match &ldquo;<em>{search}</em>&rdquo;.
          </div>
        )}
      </div>
    </Panel>
  );
}
