"use client";

import { useEffect, useRef, useState } from "react";
import type { SecurityAuditMeta } from "@/app/api/dev/security-audits/route";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";
import Panel from "@/app/components/Panel";

const PAGE_SIZES = [5, 10, 25, 0];
const DEFAULT_PAGE_SIZE = 10;

function pageSizeLabel(n: number) {
  return n === 0 ? "All" : String(n);
}

const SEV_CLASSES: Record<string, string> = {
  critical: "dui-sev--critical",
  high:     "dui-sev--high",
  medium:   "dui-sev--medium",
  low:      "dui-sev--low",
};

function AuditItem({ meta }: { meta: SecurityAuditMeta }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  async function loadContent() {
    if (content !== null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/security-audits?id=${encodeURIComponent(meta.id)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setContent(data.content ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Failed to load audit report.");
    } finally {
      setLoading(false);
    }
  }

  // TOC scroll-spy after content loads
  useEffect(() => {
    const el = contentRef.current;
    if (!el || content === null) return;

    const headings = Array.from(el.querySelectorAll<HTMLElement>("h2[id]"));
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>(".r-toc__list a"));
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
          }
        },
        { rootMargin: "-72px 0px -65% 0px", threshold: [0, 0.1, 0.5, 1] },
      );
      headings.forEach(h => io!.observe(h));
      if (headings[0]) setActive(headings[0].id);
    }

    return () => {
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
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) loadContent();
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

export default function DevSecurityAuditsListPanel() {
  const [audits, setAudits] = useState<SecurityAuditMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/security-audits");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setAudits(data.audits ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load audit reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const q = search.toLowerCase();
  const filtered = q
    ? audits.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.content_text.toLowerCase().includes(q)
      )
    : audits;

  const effective = pageSize === 0 ? filtered.length : pageSize;
  const totalPages = Math.max(1, Math.ceil(filtered.length / (effective || 1)));
  const visible = pageSize === 0
    ? filtered
    : filtered.slice((page - 1) * pageSize, page * pageSize);

  function setPageSizeAndReset(n: number) { setPageSize(n); setPage(1); }
  function setSearchAndReset(s: string) { setSearch(s); setPage(1); }

  return (
    <Panel name="dev_sec_audits_list" title="Audit Reports">
      <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Audit Reports</h1>
            <p className="dui-page__subtitle">
              Reports generated by <code>&lt;sec&gt;</code> in the CLI. Each run saves a JSON file in <code>dev/security-audits/</code>.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="dui-pager__btn"
            aria-label="Refresh audit list"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        <div className="dui-toolbar">
          <input
            type="search"
            className="dui-search"
            placeholder="Search by title, summary, or finding…"
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

        {!loading && audits.length === 0 && !error && (
          <div className="dui-empty">
            No audit reports yet. Run <code>&lt;sec&gt;</code> in the Claude Code CLI to generate one.
          </div>
        )}

        {filtered.length > 0 && (
          <>
            <DevAccordion>
              {visible.map(a => <AuditItem key={a.id} meta={a} />)}
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

        {!loading && filtered.length === 0 && audits.length > 0 && (
          <div className="dui-empty">
            No reports match &ldquo;<em>{search}</em>&rdquo;.
          </div>
        )}
      </div>
    </Panel>
  );
}
