"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDevTab } from "@/app/contexts/DevTabContext";
import { devReporting, type DevReportMeta, type DevReportType } from "@/app/lib/apiSite";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";
import Panel from "@/app/components/Panel";

type ReportMeta = DevReportMeta;
type ReportType = DevReportType;

const PAGE_SIZES = [5, 10, 25, 50, 0]; // 0 = All
const DEFAULT_PAGE_SIZE = 25;

type TypeTab = { value: ReportType | "all"; label: string };
const TYPE_TABS: TypeTab[] = [
  { value: "all", label: "All" },
  { value: "research", label: "Research" },
  { value: "plan", label: "Plan" },
  { value: "code", label: "Codebase" },
  { value: "security", label: "Security" },
  { value: "api", label: "API" },
  { value: "retro", label: "Retrospectives" },
];

function pageSizeLabel(n: number) {
  return n === 0 ? "All" : String(n);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";
}

// Build a nested <ol> TOC element from the headings currently in the
// body. H1 = top-level (main element); H2 / H3 nested beneath the nearest
// preceding H1 (or root if none). Also assigns missing id attributes so
// every TOC link has an anchor to jump to.
function buildToc(body: HTMLElement): HTMLElement | null {
  const headings = Array.from(
    body.querySelectorAll<HTMLElement>("h1, h2, h3")
  );
  if (headings.length === 0) return null;

  const usedIds = new Set<string>();
  headings.forEach((h) => {
    if (!h.id) {
      let base = slugify(h.textContent ?? "");
      let id = base, i = 2;
      while (usedIds.has(id) || body.querySelector("#" + CSS.escape(id))) {
        id = `${base}-${i++}`;
      }
      h.id = id;
    }
    usedIds.add(h.id);
  });

  // Build a tree keyed by heading level.
  type Node = { level: number; text: string; id: string; children: Node[] };
  const root: Node = { level: 0, text: "", id: "", children: [] };
  const stack: Node[] = [root];
  for (const h of headings) {
    const level = parseInt(h.tagName.substring(1), 10);
    const node: Node = { level, text: h.textContent ?? "", id: h.id, children: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    (stack[stack.length - 1] ?? root).children.push(node);
    stack.push(node);
  }

  const ol = document.createElement("ol");
  ol.className = "r-toc__list";
  const render = (nodes: Node[], parent: HTMLElement) => {
    for (const n of nodes) {
      const li = document.createElement("li");
      li.className = `r-toc__item r-toc__item--h${n.level}`;
      const a = document.createElement("a");
      a.href = "#" + n.id;
      a.textContent = n.text;
      li.appendChild(a);
      if (n.children.length) {
        const sub = document.createElement("ol");
        sub.className = "r-toc__list r-toc__list--nested";
        render(n.children, sub);
        li.appendChild(sub);
      }
      parent.appendChild(li);
    }
  };
  render(root.children, ol);
  return ol;
}

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
  swatches.forEach((el) => {
    const token = el.dataset.colorToken;
    if (!token) return;
    const value = cs.getPropertyValue(token).trim();
    if (!value) { el.textContent = token + " (unbound)"; return; }
    el.style.background = value;
    el.style.color = pickContrastFor(value);
    el.textContent = value;
  });
}

function ReportItem({ meta }: { meta: ReportMeta }) {
  const { openReports, toggleReport } = useDevTab();
  const isOpen = openReports.has(meta.id);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  async function loadContent() {
    if (content !== null) return;
    setLoading(true);
    setError(null);
    try {
      const data = await devReporting.get(meta.id);
      setContent(data.content ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load report.");
    } finally {
      setLoading(false);
    }
  }

  // Restore open state across reloads — fetch if persisted as open.
  useEffect(() => {
    if (isOpen && content === null && !loading) loadContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || content === null) return;
    resolveSwatches(el);

    // Stored reports use one of two TOC class families: the older
    // .r-toc-* (research-paper bundles) or the newer .dui-toc-* (dev-UI
    // primitives). Treat both as the same shape so the TOC replacement
    // logic covers every report.
    const body =
      el.querySelector<HTMLElement>(".r-toc-body, .dui-toc-body") ?? el;
    const tocHost =
      el.querySelector<HTMLElement>(".r-toc, .dui-toc") ?? null;
    const tocLayout =
      el.querySelector<HTMLElement>(".r-toc-layout, .dui-toc-layout") ?? null;
    const existingList =
      tocHost?.querySelector<HTMLElement>(".r-toc__list, .dui-toc__list") ?? null;

    // Strip the "Contents" label — the sidebar speaks for itself.
    el.querySelectorAll<HTMLElement>(".r-toc__label, .dui-toc__label")
      .forEach((n) => n.remove());

    // Count headings up front. A one-heading TOC is noise (every plan
    // would render a sidebar with just "Scope" in it), so we collapse to
    // a body-only layout when that's the case.
    const headingCount = body.querySelectorAll("h1, h2, h3").length;
    const generatedToc = headingCount > 1 ? buildToc(body) : null;

    if (!generatedToc) {
      // Drop the TOC sidebar entirely. Promote the body to fill the
      // accordion's content width.
      if (tocHost) tocHost.remove();
      if (tocLayout) tocLayout.classList.add("is-no-toc");
    } else if (existingList) {
      // Replace the baked-in list (which may be flat / partial) with our
      // heading-driven nested version.
      existingList.replaceWith(generatedToc);
    } else if (tocHost) {
      tocHost.appendChild(generatedToc);
    } else {
      // No host at all — synthesise one. Used when the stored HTML is
      // plain content with no TOC scaffolding.
      const wrapper = document.createElement("div");
      wrapper.className = "r-toc-layout r-toc-layout--synthetic";
      const aside = document.createElement("aside");
      aside.className = "r-toc";
      aside.appendChild(generatedToc);
      const bodyWrap = document.createElement("div");
      bodyWrap.className = "r-toc-body";
      while (el.firstChild) bodyWrap.appendChild(el.firstChild);
      wrapper.appendChild(aside);
      wrapper.appendChild(bodyWrap);
      el.appendChild(wrapper);
    }

    const reapply = () => resolveSwatches(el);
    const rafReapply = () => requestAnimationFrame(() => requestAnimationFrame(reapply));

    const docObs = new MutationObserver(rafReapply);
    docObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const headObs = new MutationObserver(rafReapply);
    headObs.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

    // TOC scroll-spy + click highlight — observes h1/h2/h3 with ids.
    const headings = Array.from(el.querySelectorAll<HTMLElement>("h1[id], h2[id], h3[id]"));
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>(".dui-toc__list a, .r-toc__list a"));
    const linkById = new Map(links.map((a) => [a.getAttribute("href")?.slice(1) ?? "", a]));
    let clickLockUntil = 0;

    const setActive = (id: string | null) => {
      links.forEach((a) => a.classList.remove("is-active"));
      if (id) linkById.get(id)?.classList.add("is-active");
    };

    const onLinkClick = (e: Event) => {
      const a = e.currentTarget as HTMLAnchorElement;
      const id = a.getAttribute("href")?.slice(1);
      if (!id) return;
      clickLockUntil = Date.now() + 800;
      setActive(id);
    };
    links.forEach((a) => a.addEventListener("click", onLinkClick));

    let io: IntersectionObserver | null = null;
    if (headings.length) {
      const visible = new Map<string, number>();
      io = new IntersectionObserver(
        (entries) => {
          if (Date.now() < clickLockUntil) return;
          entries.forEach((en) => {
            const id = (en.target as HTMLElement).id;
            if (en.isIntersecting) visible.set(id, en.intersectionRatio);
            else visible.delete(id);
          });
          if (visible.size) {
            let topId: string | null = null;
            let topY = Infinity;
            visible.forEach((_, id) => {
              const h = headings.find((h) => h.id === id);
              if (!h) return;
              const y = h.getBoundingClientRect().top;
              if (y < topY) { topY = y; topId = id; }
            });
            setActive(topId);
          } else {
            const above = headings
              .filter((h) => h.getBoundingClientRect().top < 80)
              .pop();
            if (above) setActive(above.id);
          }
        },
        { rootMargin: "-72px 0px -65% 0px", threshold: [0, 0.1, 0.5, 1] }
      );
      headings.forEach((h) => io!.observe(h));
      setActive(headings[0].id);
    }

    return () => {
      docObs.disconnect();
      headObs.disconnect();
      io?.disconnect();
      links.forEach((a) => a.removeEventListener("click", onLinkClick));
    };
  }, [content]);

  const header = (
    <span className="dui-meta">
      <span className="dui-meta__id">{meta.id}</span>
      <span className="dui-meta__title">{meta.title}</span>
      <span className="dui-meta__sub">
        <span>{meta.type}</span>
        {meta.category && <span>{meta.category}</span>}
        <span>{meta.report_date}</span>
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
        toggleReport(meta.id, next);
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

export default function DevReportingPanel() {
  const [reports, setReports] = useState<ReportMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<ReportType | "all">("all");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await devReporting.list();
      setReports(data.reports ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: reports.length };
    for (const r of reports) c[r.type] = (c[r.type] ?? 0) + 1;
    return c;
  }, [reports]);

  const q = search.toLowerCase();
  const filtered = useMemo(() => {
    return reports
      .filter((r) => activeType === "all" || r.type === activeType)
      .filter((r) =>
        !q ||
        r.title.toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q) ||
        (r.topic ?? "").toLowerCase().includes(q) ||
        (r.summary ?? "").toLowerCase().includes(q) ||
        (r.content_text ?? "").toLowerCase().includes(q)
      );
  }, [reports, activeType, q]);

  const effective = pageSize === 0 ? filtered.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / (effective || 1)));
  const visible = pageSize === 0
    ? filtered
    : filtered.slice((page - 1) * pageSize, page * pageSize);

  function setPageSizeAndReset(n: number) { setPageSize(n); setPage(1); }
  function setSearchAndReset(s: string) { setSearch(s); setPage(1); }
  function setTypeAndReset(t: ReportType | "all") { setActiveType(t); setPage(1); }

  return (
    <Panel name="dev_reporting" title="Reporting">
      <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Reporting</h1>
            <p className="dui-page__subtitle">
              Reports stored in <code>mmff_dev.dev_reports</code>. Filter by type to narrow the list;
              click a row to load the report body.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="dui-pager__btn"
            aria-label="Refresh report list"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        <nav className="dui-typetabs" role="tablist" aria-label="Report type filter">
          {TYPE_TABS.map((tab) => {
            const count = counts[tab.value] ?? 0;
            const isActive = activeType === tab.value;
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={isActive}
                className={`dui-typetabs__tab${isActive ? " is-active" : ""}`}
                onClick={() => setTypeAndReset(tab.value)}
              >
                <span className="dui-typetabs__label">{tab.label}</span>
                <span className="dui-typetabs__count">{count}</span>
              </button>
            );
          })}
        </nav>

        <div className="dui-toolbar">
          <input
            type="search"
            className="dui-search"
            placeholder="Search by title, category, topic, or body…"
            value={search}
            onChange={(e) => setSearchAndReset(e.target.value)}
          />
          <div className="dui-toolbar__spacer" />
          <div className="dui-pager__sizes" role="group" aria-label="Page size">
            {PAGE_SIZES.map((n) => (
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
            No reports in <code>dev_reports</code> yet. New reports are written by the
            skill family (<code>/research</code>, <code>/sec</code>, <code>/codebase</code>,
            <code>/retro</code>, <code>/code</code>) via the backend handler.
          </div>
        )}

        {filtered.length > 0 && (
          <>
            <DevAccordion>
              {visible.map((r) => <ReportItem key={r.id} meta={r} />)}
            </DevAccordion>

            {pageSize !== 0 && totalPages > 1 && (
              <div className="dui-pager">
                <button
                  className="dui-pager__btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  aria-label="Previous page"
                >‹</button>
                <span className="dui-pager__info">{page} / {totalPages}</span>
                <button
                  className="dui-pager__btn"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  aria-label="Next page"
                >›</button>
              </div>
            )}
          </>
        )}

        {!loading && filtered.length === 0 && reports.length > 0 && (
          <div className="dui-empty">
            No reports match the current filter.
          </div>
        )}
      </div>
    </Panel>
  );
}
