"use client";

import { useEffect, useRef, useState } from "react";
import type { ScopeDoc, ScopeSection } from "@/app/api/dev/scope/route";

// Strip the leading <h2>…</h2> from each section's html — the summary
// renders the title, so we don't want a duplicate heading in the body.
function stripLeadingH2(html: string): string {
  return html.replace(/^\s*<h2>[^<]*<\/h2>\s*/, "");
}

function ScopeContent({ sections }: { sections: ScopeSection[] }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null
  );

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const detailsEls = Array.from(
      el.querySelectorAll<HTMLDetailsElement>("details.dui-scope-section")
    );
    const links = Array.from(
      el.querySelectorAll<HTMLAnchorElement>(".dui-toc__list a")
    );
    const linkById = new Map(
      links.map((a) => [a.getAttribute("href")?.slice(1) ?? "", a])
    );
    const detailsById = new Map(detailsEls.map((d) => [d.id, d]));
    let clickLockUntil = 0;

    const setActive = (id: string | null) => {
      setActiveId(id);
      links.forEach((a) => a.classList.remove("is-active"));
      if (id) linkById.get(id)?.classList.add("is-active");
    };

    const tocClickHandlers: Array<() => void> = [];
    links.forEach((a) => {
      const handler = (ev: Event) => {
        const id = a.getAttribute("href")?.slice(1);
        if (!id) return;
        clickLockUntil = Date.now() + 800;
        setActive(id);
        const target = detailsById.get(id);
        if (target) {
          ev.preventDefault();
          target.open = true;
          // Wait a tick for the details to expand before scrolling.
          requestAnimationFrame(() => {
            target.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
      };
      a.addEventListener("click", handler);
      tocClickHandlers.push(() => a.removeEventListener("click", handler));
    });

    if (!detailsEls.length) return;

    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
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
            const d = detailsEls.find((d) => d.id === id);
            if (!d) return;
            const y = d.getBoundingClientRect().top;
            if (y < topY) {
              topY = y;
              topId = id;
            }
          });
          setActive(topId);
        } else {
          const above = detailsEls
            .filter((d) => d.getBoundingClientRect().top < 80)
            .pop();
          if (above) setActive(above.id);
        }
      },
      { rootMargin: "-72px 0px -65% 0px", threshold: [0, 0.1, 0.5, 1] }
    );

    detailsEls.forEach((d) => io.observe(d));
    setActive(detailsEls[0].id);

    return () => {
      io.disconnect();
      tocClickHandlers.forEach((off) => off());
    };
  }, [sections]);

  const tocItems = sections.map((s) => (
    <li key={s.id}>
      <a href={`#${s.id}`} className={activeId === s.id ? "is-active" : ""}>
        {s.number}. {s.title}
      </a>
    </li>
  ));

  return (
    <div ref={contentRef} className="dui-toc-layout">
      <nav className="dui-toc">
        <p className="dui-toc__label">Sections</p>
        <ul className="dui-toc__list">{tocItems}</ul>
      </nav>
      <div className="dui-doc">
        {sections.map((s) => (
          <details key={s.id} id={s.id} className="dui-scope-section">
            <summary className="dui-scope-section__summary">
              <span className="dui-scope-section__chevron" aria-hidden="true" />
              <span className="dui-scope-section__title">
                {s.number}. {s.title}
              </span>
            </summary>
            <div
              className="dui-scope-section__body"
              dangerouslySetInnerHTML={{ __html: stripLeadingH2(s.html) }}
            />
          </details>
        ))}
      </div>
    </div>
  );
}

type DevScopePanelProps = {
  onTick?: (at: Date) => void;
};

export default function DevScopePanel({ onTick }: DevScopePanelProps) {
  const [doc, setDoc] = useState<ScopeDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    let cancelled = false;

    const load = () =>
      fetch("/api/dev/scope", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return r.json() as Promise<ScopeDoc>;
        })
        .then((d) => {
          if (!cancelled) setDoc(d);
        })
        .catch((e) => {
          if (!cancelled) setError(e?.message ?? "Failed to load scope.");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

    load();

    let es: EventSource | null = null;

    const onChange = () => {
      load();
      if (cancelled) return;
      onTickRef.current?.(new Date());
    };

    const connect = () => {
      if (cancelled) return;
      es = new EventSource("/api/dev/scope/stream");
      es.addEventListener("ready", () => {
        // eslint-disable-next-line no-console
        console.log("[scope] SSE ready");
      });
      es.addEventListener("change", () => {
        // eslint-disable-next-line no-console
        console.log("[scope] SSE change");
        onChange();
      });
      // Fallback: if the server ever sends an unnamed event (default
      // "message"), still treat it as a change.
      es.onmessage = () => {
        // eslint-disable-next-line no-console
        console.log("[scope] SSE message (default)");
        onChange();
      };
      es.onerror = () => {
        // EventSource auto-reconnects on transport errors, but if the
        // server actively closed the stream the readyState ends up
        // CLOSED — re-establish manually after a short delay.
        if (es && es.readyState === EventSource.CLOSED && !cancelled) {
          es.close();
          setTimeout(connect, 500);
        }
      };
    };

    connect();

    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  if (loading) {
    return (
      <div className="dui-loading">
        <span className="dui-loading__spinner" aria-hidden="true" />
        Loading scope…
      </div>
    );
  }

  if (error || !doc) {
    return <div className="dui-empty">{error ?? "Scope document not found."}</div>;
  }

  // No .dui-panel wrapper: its overflow:hidden creates a scroll container
  // that breaks the TOC's position:sticky. The scope content is a doc,
  // not a card surface, so render it inline against the page background.
  return <ScopeContent sections={doc.sections} />;
}
