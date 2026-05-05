"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Panel from "@/app/components/Panel";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";
import type { RetroDoc, RetroMeta, Ledger } from "@/app/api/dev/retros/route";

type SubTab = "ledger" | "retrospectives";
const SUBTAB_STORAGE_KEY = "dev-retros-subtab";

function trendArrow(trend: string): string {
  // "3→4→5" → "↑"; "5→4→3" → "↓"; "4→4→4" → "→"; mixed → "↔"
  const parts = trend.split(/→|->/).map(s => parseInt(s, 10)).filter(n => !isNaN(n));
  if (parts.length < 2) return "·";
  const diffs = parts.slice(1).map((n, i) => n - parts[i]);
  if (diffs.every(d => d > 0)) return "↑";
  if (diffs.every(d => d < 0)) return "↓";
  if (diffs.every(d => d === 0)) return "→";
  return "↔";
}

// Severity → catalog pill variant. Heatmap (h) uses the full pass/warn/fail
// ramp; what-went-well (w) is always pass-green.
function severityPillClass(s: number, kind: "h" | "w"): string {
  const clamped = Math.max(1, Math.min(5, Math.round(s)));
  if (kind === "w") return "dui-pill dui-pill--pass";
  if (clamped <= 2) return "dui-pill dui-pill--pass";
  if (clamped === 3) return "dui-pill dui-pill--warn";
  return "dui-pill dui-pill--fail";
}

function statusPillClass(status: string): string {
  if (status === "resolved")    return "dui-pill dui-pill--pass";
  if (status === "in-progress") return "dui-pill dui-pill--warn";
  if (status === "open")        return "dui-pill dui-pill--fail";
  return "dui-pill dui-pill--neutral";
}

function LedgerSubTab() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/retros?view=ledger");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setLedger(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load ledger.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function toggleEntry(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const entries = ledger?.entries ?? [];

  return (
    <div>
      <div className="dui-toolbar">
        <p>
          Recurring issues across all retros. Auto-promotes to S1 tech debt after 3+ unresolved hits.
        </p>
        <div className="dui-toolbar__spacer" />
        <button onClick={load} disabled={loading} className="dui-pager__btn" aria-label="Refresh ledger">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="dui-empty">{error}</div>}

      {!loading && entries.length === 0 && !error && (
        <div className="dui-empty">
          No ledger entries yet. Run <code>&lt;r&gt;</code> in the CLI after a work segment to start tracking.
        </div>
      )}

      {entries.length > 0 && (
        <table className="dui-table">
          <thead>
            <tr>
              <th>Updates</th>
              <th>ID</th>
              <th>Area of concern</th>
              <th>Hits</th>
              <th>First seen</th>
              <th>Last seen</th>
              <th>Trend</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const open = expanded.has(e.id);
              return (
                <Fragment key={e.id}>
                  <tr
                    className={`is-clickable${open ? " is-open" : ""}`}
                    onClick={() => toggleEntry(e.id)}
                  >
                    <td className="dui-table__cell--shrink">{open ? "▾" : "▸"}</td>
                    <td className="dui-table__cell--mono">{e.id}</td>
                    <td>{e.area_of_concern}</td>
                    <td className="dui-table__cell--numeric">{e.hit_count}</td>
                    <td className="dui-table__cell--nowrap">{e.first_seen}</td>
                    <td className="dui-table__cell--nowrap">{e.last_seen}</td>
                    <td className="dui-table__cell--nowrap">
                      <span>{trendArrow(e.severity_trend)}</span>{" "}
                      <span className="dui-table__cell--mono">{e.severity_trend || "·"}</span>
                    </td>
                    <td>
                      <span className={statusPillClass(e.status)}>{e.status}</span>
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={8}>
                        <table className="dui-table">
                          <thead>
                            <tr>
                              <th>Hit</th>
                              <th>Severity</th>
                              <th>Prompt excerpt</th>
                              <th>Chain of events</th>
                              <th>Retro</th>
                              <th>Resolved by</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.hits.map((h, i) => (
                              <tr key={`${e.id}-${i}`}>
                                <td className="dui-table__cell--shrink">{i + 1}</td>
                                <td className="dui-table__cell--shrink"><span className={severityPillClass(h.severity, "h")}>{h.severity}</span></td>
                                <td>{h.prompt_excerpt}</td>
                                <td>{h.chain_of_events}</td>
                                <td><a href="#" onClick={ev => { ev.preventDefault(); }}>{h.retro_id}</a></td>
                                <td>{e.resolved_by ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div>
                          fingerprint: <code>{e.fingerprint}</code>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RetroItem({ meta }: { meta: RetroMeta }) {
  const [doc, setDoc] = useState<RetroDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  async function loadContent() {
    if (doc !== null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/retros?id=${encodeURIComponent(meta.id)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      setDoc(await res.json());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load retro.");
    } finally {
      setLoading(false);
    }
  }

  // TOC scroll-spy + click highlight (mirrors DevResearchPanel exactly).
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || doc === null) return;

    const headings = Array.from(el.querySelectorAll<HTMLElement>("h2[id]"));
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>(".dui-toc__list a"));
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
      io?.disconnect();
      links.forEach(a => a.removeEventListener("click", onLinkClick));
    };
  }, [doc]);

  const header = (
    <span className="dui-meta">
      <span className="dui-meta__id">{meta.id}</span>
      <span className="dui-meta__title">{meta.title}</span>
      <span className="dui-meta__sub">
        <span>{meta.date}</span>
        <span>{meta.triggered_by}</span>
      </span>
      <span className="dui-meta__sub">
        <span className={severityPillClass(meta.max_severity || 1, "h")}>S{meta.max_severity || 0}</span>
        <span>{meta.finding_count} root cause{meta.finding_count === 1 ? "" : "s"}</span>
        <span>{meta.win_count} win{meta.win_count === 1 ? "" : "s"}</span>
      </span>
    </span>
  );

  return (
    <DevAccordionItem
      header={header}
      open={open}
      onOpenChange={(next) => { if (next) loadContent(); setOpen(next); }}
    >
      <div ref={bodyRef}>
        {loading && (
          <div className="dui-loading">
            <span className="dui-loading__spinner" aria-hidden="true" />
            Loading…
          </div>
        )}
        {error && <div className="dui-empty">{error}</div>}
        {doc !== null && !loading && (
          <div className="dui-toc-layout">
            <aside className="dui-toc">
              <div className="dui-toc__label">Contents</div>
              <ol className="dui-toc__list">
                <li><a href="#honest-assessment">1. Honest assessment</a></li>
                <li><a href="#root-causes">2. Root cause analysis</a></li>
                <li><a href="#what-went-well">3. What went well</a></li>
                <li><a href="#signals">4. Signals</a></li>
              </ol>
            </aside>
            <div className="dui-toc__body">
              <section>
                <div className="dui-doc">
                  <h2 id="honest-assessment">1. Honest assessment</h2>
                  <div dangerouslySetInnerHTML={{ __html: doc.honest_assessment ?? "" }} />
                </div>
              </section>

              <section>
                <div className="dui-doc">
                  <h2 id="root-causes">2. Root cause analysis</h2>
                </div>
                <table className="dui-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>REF</th>
                      <th>Category</th>
                      <th>Issue</th>
                      <th>5 Whys + reversal</th>
                      <th>Resolution</th>
                      <th>Heatmap</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(doc.table_1_root_causes ?? []).map(f => (
                      <tr key={f.ref}>
                        <td className="dui-table__cell--shrink">{f.order}</td>
                        <td className="dui-table__cell--mono"><code>{f.ref}</code></td>
                        <td>{f.category}</td>
                        <td>{f.issue}</td>
                        <td>
                          <ol>
                            {(f.whys ?? []).map(w => (
                              <li key={w.depth}>{w.statement}</li>
                            ))}
                          </ol>
                          {f.chain_broken_at != null && (
                            <div className="dui-callout dui-callout--warn">
                              ⚠ chain broken at why-{f.chain_broken_at}
                            </div>
                          )}
                          {(f.reversal ?? []).length > 0 && (
                            <details className="dui-disclosure">
                              <summary>Reversal chain</summary>
                              <ul>
                                {(f.reversal ?? []).map((r, i) => (
                                  <li key={i}>
                                    why-{r.from} <em>{r.verb}</em> why-{r.to}: {r.chain}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </td>
                        <td>
                          <ol>
                            {(f.resolution_steps ?? []).map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                        </td>
                        <td className="dui-table__cell--shrink"><span className={severityPillClass(f.severity, "h")}>{f.severity}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <div className="dui-doc">
                  <h2 id="what-went-well">3. What went well</h2>
                </div>
                <table className="dui-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>REF</th>
                      <th>Category</th>
                      <th>Win</th>
                      <th>Why it worked</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(doc.table_2_what_went_well ?? []).map(w => (
                      <tr key={w.ref}>
                        <td className="dui-table__cell--shrink">{w.order}</td>
                        <td className="dui-table__cell--mono"><code>{w.ref}</code></td>
                        <td>{w.category}</td>
                        <td>{w.win}</td>
                        <td>{w.why_it_worked}</td>
                        <td className="dui-table__cell--shrink"><span className={severityPillClass(w.score, "w")}>{w.score}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <div className="dui-doc">
                  <h2 id="signals">4. Signals</h2>
                  <ul>
                    <li>Wallclock: {doc.signals?.wallclock_minutes} min</li>
                    <li>Tool calls: {doc.signals?.tool_call_count}</li>
                    <li>Errors: {doc.signals?.error_count}</li>
                    <li>Files read / re-read / written: {doc.signals?.files_read} / {doc.signals?.files_re_read} / {doc.signals?.files_written}</li>
                    <li>Max tool repeat: {doc.signals?.tool_repeats_max}</li>
                    {doc.linked_plan && <li>Linked plan: {doc.linked_plan}</li>}
                  </ul>
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </DevAccordionItem>
  );
}

function RetrospectivesSubTab() {
  const [retros, setRetros] = useState<RetroMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/retros");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setRetros(data.retros ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load retros.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="dui-toolbar">
        <p>
          One retro per work segment. Two tables: root causes (heatmap red→green) and what went well (all green).
        </p>
        <div className="dui-toolbar__spacer" />
        <button onClick={load} disabled={loading} className="dui-pager__btn" aria-label="Refresh retros">
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="dui-empty">{error}</div>}

      {!loading && retros.length === 0 && !error && (
        <div className="dui-empty">
          No retros yet. Run <code>&lt;r&gt;</code> in the Claude Code CLI to generate one.
        </div>
      )}

      {retros.length > 0 && (
        <DevAccordion>
          {retros.map(r => <RetroItem key={r.id} meta={r} />)}
        </DevAccordion>
      )}
    </div>
  );
}

export default function DevRetrosPanel() {
  const [subtab, setSubtab] = useState<SubTab>("ledger");

  useEffect(() => {
    const saved = localStorage.getItem(SUBTAB_STORAGE_KEY);
    if (saved === "ledger" || saved === "retrospectives") setSubtab(saved);
  }, []);

  function setAndPersist(t: SubTab) {
    setSubtab(t);
    localStorage.setItem(SUBTAB_STORAGE_KEY, t);
  }

  return (
    <Panel name="dev_retros" title="Retros">
      <div className="dui-page">
        <nav className="dui-subtabs">
          <button
            className={`dui-subtab${subtab === "ledger" ? " is-active" : ""}`}
            onClick={() => setAndPersist("ledger")}
          >
            Recurring ledger
          </button>
          <button
            className={`dui-subtab${subtab === "retrospectives" ? " is-active" : ""}`}
            onClick={() => setAndPersist("retrospectives")}
          >
            Retrospectives
          </button>
        </nav>

        {subtab === "ledger" && <LedgerSubTab />}
        {subtab === "retrospectives" && <RetrospectivesSubTab />}
      </div>
    </Panel>
  );
}
