"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanDoc, PlanMeta } from "@/app/api/dev/plans/route";
import { DevAccordion, DevAccordionItem } from "@dev/components/DevAccordion";
import Panel from "@/app/components/Panel";

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return iso;
}

const PLAN_TOC: Array<{ id: string; label: string }> = [
  { id: "scope", label: "1.0.1 Scope" },
  { id: "value", label: "2.0.1 Value" },
  { id: "implementation-plan", label: "3.0.1 Implementation Plan" },
  { id: "areas-impacted", label: "5.0.1 Areas Impacted" },
  { id: "feature-list", label: "6.0.1 Feature List" },
  { id: "work-item-backlog", label: "7.0.1 Work Item Backlog" },
  { id: "acceptance-criteria", label: "8.0.1 Acceptance Criteria" },
  { id: "risks", label: "9.0.1 Risks" },
  { id: "references", label: "10.0.1 References" },
];

function statusPillVariant(status: string): string {
  switch (status) {
    case "completed": return "dui-pill--pass";
    case "doing":     return "dui-pill--warn";
    case "blocked":   return "dui-pill--fail";
    default:          return "dui-pill--neutral";
  }
}

function PlanBody({ plan }: { plan: PlanDoc }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const headings = Array.from(el.querySelectorAll<HTMLElement>("h3[id]"));
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
  }, []);

  return (
    <div className="dui-doc dui-doc--wide" ref={bodyRef}>
      <div className="dui-meta-strip">
        <div className="dui-meta-strip__cell">
          <span className="dui-meta-strip__label">Date Created</span>
          <span className="dui-meta-strip__value">{fmtDate(plan.date_created)}</span>
        </div>
        <div className="dui-meta-strip__cell">
          <span className="dui-meta-strip__label">Date Started</span>
          <span className="dui-meta-strip__value">{fmtDate(plan.date_started)}</span>
        </div>
        <div className="dui-meta-strip__cell">
          <span className="dui-meta-strip__label">Last Updated</span>
          <span className="dui-meta-strip__value">{fmtDate(plan.date_last_updated)}</span>
        </div>
        <div className="dui-meta-strip__cell">
          <span className="dui-meta-strip__label">Date Finished</span>
          <span className="dui-meta-strip__value">{fmtDate(plan.date_finished)}</span>
        </div>
      </div>

      <div className="dui-toc-layout">
        <aside className="dui-toc">
          <div className="dui-toc__label">Contents</div>
          <ol className="dui-toc__list">
            {PLAN_TOC.map(t => (
              <li key={t.id}><a href={`#${t.id}`}>{t.label}</a></li>
            ))}
          </ol>
        </aside>
        <div className="dui-toc__body">

      <section>
        <h3 id="scope">1.0.1 Scope</h3>
        <div dangerouslySetInnerHTML={{ __html: plan.scope }} />
      </section>

      <section>
        <h3 id="value">2.0.1 Value</h3>
        <div dangerouslySetInnerHTML={{ __html: plan.value }} />
      </section>

      <section>
        <h3 id="implementation-plan">3.0.1 Implementation Plan</h3>
        <ol>
          {plan.implementation_plan.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </section>

      <section>
        <h3 id="areas-impacted">5.0.1 Areas Impacted</h3>
        <ul>
          {plan.areas_impacted.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </section>

      <section>
        <h3 id="feature-list">6.0.1 Feature List</h3>
        {plan.feature_list.length === 0 ? <p>—</p> : (
          <ul>{plan.feature_list.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}

        <h3>6.1.1 Features: Extended</h3>
        {plan.features_extended.length === 0 ? <p>—</p> : (
          <ul>{plan.features_extended.map((f, i) => <li key={i} dangerouslySetInnerHTML={{ __html: f }} />)}</ul>
        )}

        <h3>6.2.1 Features: Removed</h3>
        {plan.features_removed.length === 0 ? <p>—</p> : (
          <ul>{plan.features_removed.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
      </section>

      <section>
        <h3 id="work-item-backlog">7.0.1 Work Item Backlog</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Title</th>
              <th>Story</th>
              <th>Status</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {plan.work_item_backlog.map(item => (
              <tr key={item.order}>
                <td>{item.order}</td>
                <td>{item.title}</td>
                <td>
                  {item.story_id
                    ? (item.card_url
                        ? <a href={item.card_url} target="_blank" rel="noreferrer">{item.story_id}</a>
                        : item.story_id)
                    : "—"}
                </td>
                <td><span className={`dui-pill ${statusPillVariant(item.status)}`}>{item.status}</span></td>
                <td>{item.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 id="acceptance-criteria">8.0.1 Acceptance Criteria</h3>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Done</th>
              <th>Criterion</th>
              <th>As Proven by</th>
              <th>Story</th>
            </tr>
          </thead>
          <tbody>
            {plan.acceptance_criteria.map(ac => (
              <tr key={ac.order}>
                <td>{ac.order}</td>
                <td>{ac.done ? "[X]" : "[ ]"}</td>
                <td>{ac.criterion}</td>
                <td>{ac.proven_by}</td>
                <td>
                  {ac.story_id
                    ? (ac.card_url
                        ? <a href={ac.card_url} target="_blank" rel="noreferrer">{ac.story_id}</a>
                        : ac.story_id)
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 id="risks">9.0.1 Risks</h3>
        <table>
          <thead>
            <tr>
              <th>Impact</th>
              <th>Risk</th>
              <th>Mitigation</th>
            </tr>
          </thead>
          <tbody>
            {[...plan.risks].sort((a, b) => b.impact - a.impact).map((r, i) => (
              <tr key={i}>
                <td>{r.impact}</td>
                <td>{r.risk}</td>
                <td>{r.mitigation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 id="references">10.0.1 References</h3>
        <ul>
          {plan.references.map((r, i) => (
            <li key={i}>
              <span>{r.kind === "external" ? "↗" : "→"}</span>{" "}
              <a href={r.href} target={r.kind === "external" ? "_blank" : undefined} rel="noreferrer">{r.label}</a>
            </li>
          ))}
        </ul>
      </section>
        </div>
      </div>
    </div>
  );
}

function PlanItem({ meta }: { meta: PlanMeta }) {
  const [plan, setPlan] = useState<PlanDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadPlan() {
    if (plan !== null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dev/plans?sync=${encodeURIComponent(meta.id)}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setPlan(data as PlanDoc);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load plan.");
    } finally {
      setLoading(false);
    }
  }

  const acTotal = meta.acceptance_total;
  const acDone = meta.acceptance_done;
  const wiTotal = meta.work_item_total;
  const wiDone = meta.work_item_completed;

  const header = (
    <span className="dui-meta">
      <span className="dui-meta__id">{meta.id}</span>
      <span className="dui-meta__title">{meta.title}</span>
      <span className="dui-meta__sub">
        <span>created {fmtDate(meta.date_created)}</span>
        {meta.date_started && <span>{" · "}started {fmtDate(meta.date_started)}</span>}
        {meta.date_finished && <span>{" · "}finished {fmtDate(meta.date_finished)}</span>}
      </span>
      <span className="dui-meta__sub">
        <span className="dui-pill dui-pill--neutral">AC {acDone}/{acTotal}</span>
        {" "}
        <span className="dui-pill dui-pill--neutral">WI {wiDone}/{wiTotal}</span>
      </span>
    </span>
  );

  return (
    <DevAccordionItem header={header} onFirstOpen={loadPlan}>
      {loading && (
        <div className="dui-loading">
          <span className="dui-loading__spinner" aria-hidden="true" />
          Loading…
        </div>
      )}
      {error && <div className="dui-empty">{error}</div>}
      {plan && !loading && <PlanBody plan={plan} />}
    </DevAccordionItem>
  );
}

export default function DevPlansPanel() {
  const [plans, setPlans] = useState<PlanMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/plans");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      setPlans(data.plans ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load plans.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const q = search.toLowerCase();
  const filtered = q
    ? plans.filter(p => p.id.toLowerCase().includes(q) || p.title.toLowerCase().includes(q))
    : plans;

  return (
    <Panel name="dev_plans" title="Plans">
      <div className="dui-page">
        <header className="dui-page__header">
          <div>
            <h1 className="dui-page__title">Plans</h1>
            <p className="dui-page__subtitle">
              Plans uploaded by the <code>&lt;stories&gt;</code> skill. Each plan groups the stories created in one shot of the skill and tracks their progress.
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="dui-pager__btn"
            aria-label="Refresh plans list"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </header>

        <div className="dui-toolbar">
          <input
            type="search"
            className="dui-search"
            placeholder="Search by PLA-NNNN or title…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        {error && <div className="dui-empty">{error}</div>}

        {!loading && plans.length === 0 && !error && (
          <div className="dui-empty">
            No plans yet. Run <code>&lt;stories&gt;</code> in the Claude Code CLI to create one.
          </div>
        )}

        {filtered.length > 0 && (
          <DevAccordion>
            {filtered.map(p => <PlanItem key={p.id} meta={p} />)}
          </DevAccordion>
        )}

        {!loading && filtered.length === 0 && plans.length > 0 && (
          <div className="dui-empty">
            No plans match &ldquo;<em>{search}</em>&rdquo;.
          </div>
        )}
      </div>
    </Panel>
  );
}
