"use client";

import { useEffect, useRef, useState } from "react";
import type { ScopeDoc, ScopeSection } from "@/app/api/dev/scope/route";

function ScopeContent({ sections }: { sections: ScopeSection[] }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string | null>(
    sections[0]?.id ?? null
  );

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const headings = Array.from(el.querySelectorAll<HTMLElement>("h2[id]"));
    const links = Array.from(
      el.querySelectorAll<HTMLAnchorElement>(".dui-toc__list a")
    );
    const linkById = new Map(
      links.map((a) => [a.getAttribute("href")?.slice(1) ?? "", a])
    );
    let clickLockUntil = 0;

    const setActive = (id: string | null) => {
      setActiveId(id);
      links.forEach((a) => a.classList.remove("is-active"));
      if (id) linkById.get(id)?.classList.add("is-active");
    };

    links.forEach((a) =>
      a.addEventListener("click", () => {
        const id = a.getAttribute("href")?.slice(1);
        if (!id) return;
        clickLockUntil = Date.now() + 800;
        setActive(id);
      })
    );

    if (!headings.length) return;

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
            const h = headings.find((h) => h.id === id);
            if (!h) return;
            const y = h.getBoundingClientRect().top;
            if (y < topY) {
              topY = y;
              topId = id;
            }
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

    headings.forEach((h) => io.observe(h));
    setActive(headings[0].id);

    return () => io.disconnect();
  }, [sections]);

  const tocItems = sections.map((s) => (
    <li key={s.id}>
      <a href={`#${s.id}`} className={activeId === s.id ? "is-active" : ""}>
        {s.number}. {s.title}
      </a>
    </li>
  ));

  // Stamp each section's h2 with the id so scroll-spy and TOC links work.
  // The API already returns rendered HTML but without ids on h2 tags —
  // we inject them client-side via dangerouslySetInnerHTML after replacing.
  const body = sections
    .map((s) =>
      s.html.replace(
        /^<h2>([^<]+)<\/h2>/m,
        `<h2 id="${s.id}">$1</h2>`
      )
    )
    .join("");

  return (
    <div ref={contentRef} className="dui-toc-layout">
      <nav className="dui-toc">
        <p className="dui-toc__label">Sections</p>
        <ul className="dui-toc__list">{tocItems}</ul>
      </nav>
      <div
        className="dui-doc"
        dangerouslySetInnerHTML={{ __html: body }}
      />
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
