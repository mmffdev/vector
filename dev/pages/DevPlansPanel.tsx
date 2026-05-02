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

function PlanBody({ plan }: { plan: PlanDoc }) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const headings = Array.from(el.querySelectorAll<HTMLElement>("h3[id]"));
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
    <div className="dev-plan-body" ref={bodyRef}>
      <div className="dev-plan-dates">
        <div><span className="dev-plan-dates__label">Date Created</span><span>{fmtDate(plan.date_created)}</span></div>
        <div><span className="dev-plan-dates__label">Date Started</span><span>{fmtDate(plan.date_started)}</span></div>
        <div><span className="dev-plan-dates__label">Last Updated</span><span>{fmtDate(plan.date_last_updated)}</span></div>
        <div><span className="dev-plan-dates__label">Date Finished</span><span>{fmtDate(plan.date_finished)}</span></div>
      </div>

      <div className="r-toc-layout">
        <aside className="r-toc">
          <div className="r-toc__label">Contents</div>
          <ol className="r-toc__list">
            {PLAN_TOC.map(t => (
              <li key={t.id}><a href={`#${t.id}`}>{t.label}</a></li>
            ))}
          </ol>
        </aside>
        <div className="r-toc-body">

      <section className="dev-plan-section">
        <h3 id="scope" className="dev-plan-h">1.0.1 Scope</h3>
        <div className="dev-plan-rich" dangerouslySetInnerHTML={{ __html: plan.scope }} />
      </section>

      <section className="dev-plan-section">
        <h3 id="value" className="dev-plan-h">2.0.1 Value</h3>
        <div className="dev-plan-rich" dangerouslySetInnerHTML={{ __html: plan.value }} />
      </section>

      <section className="dev-plan-section">
        <h3 id="implementation-plan" className="dev-plan-h">3.0.1 Implementation Plan</h3>
        <ol className="dev-plan-ol">
          {plan.implementation_plan.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </section>

      <section className="dev-plan-section">
        <h3 id="areas-impacted" className="dev-plan-h">5.0.1 Areas Impacted</h3>
        <ul className="dev-plan-ul">
          {plan.areas_impacted.map((a, i) => <li key={i}>{a}</li>)}
        </ul>
      </section>

      <section className="dev-plan-section">
        <h3 id="feature-list" className="dev-plan-h">6.0.1 Feature List</h3>
        {plan.feature_list.length === 0 ? <p className="dev-p">—</p> : (
          <ul className="dev-plan-ul">{plan.feature_list.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}

        <h4 className="dev-plan-h dev-plan-h--sub">6.1.1 Features: Extended</h4>
        {plan.features_extended.length === 0 ? <p className="dev-p">—</p> : (
          <ul className="dev-plan-ul">{plan.features_extended.map((f, i) => <li key={i} dangerouslySetInnerHTML={{ __html: f }} />)}</ul>
        )}

        <h4 className="dev-plan-h dev-plan-h--sub">6.2.1 Features: Removed</h4>
        {plan.features_removed.length === 0 ? <p className="dev-p">—</p> : (
          <ul className="dev-plan-ul">{plan.features_removed.map((f, i) => <li key={i}>{f}</li>)}</ul>
        )}
      </section>

      <section className="dev-plan-section">
        <h3 id="work-item-backlog" className="dev-plan-h">7.0.1 Work Item Backlog</h3>
        <table className="table">
          <thead>
            <tr className="table__head">
              <th className="table__cell">#</th>
              <th className="table__cell">Title</th>
              <th className="table__cell">Story</th>
              <th className="table__cell">Status</th>
              <th className="table__cell">Notes</th>
            </tr>
          </thead>
          <tbody>
            {plan.work_item_backlog.map(item => (
              <tr key={item.order} className="table__row">
                <td className="table__cell">{item.order}</td>
                <td className="table__cell">{item.title}</td>
                <td className="table__cell">
                  {item.story_id
                    ? (item.card_url
                        ? <a href={item.card_url} target="_blank" rel="noreferrer">{item.story_id}</a>
                        : item.story_id)
                    : "—"}
                </td>
                <td className="table__cell"><span className={`badge badge-${item.status === "completed" ? "pass" : item.status === "doing" ? "medium" : item.status === "blocked" ? "high" : "fixed"}`}>{item.status}</span></td>
                <td className="table__cell">{item.notes ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="dev-plan-section">
        <h3 id="acceptance-criteria" className="dev-plan-h">8.0.1 Acceptance Criteria</h3>
        <table className="table">
          <thead>
            <tr className="table__head">
              <th className="table__cell">#</th>
              <th className="table__cell">Done</th>
              <th className="table__cell">Criterion</th>
              <th className="table__cell">As Proven by</th>
              <th className="table__cell">Story</th>
            </tr>
          </thead>
          <tbody>
            {plan.acceptance_criteria.map(ac => (
              <tr key={ac.order} className="table__row">
                <td className="table__cell">{ac.order}</td>
                <td className="table__cell">{ac.done ? "[X]" : "[ ]"}</td>
                <td className="table__cell">{ac.criterion}</td>
                <td className="table__cell">{ac.proven_by}</td>
                <td className="table__cell">
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

      <section className="dev-plan-section">
        <h3 id="risks" className="dev-plan-h">9.0.1 Risks</h3>
        <table className="table">
          <thead>
            <tr className="table__head">
              <th className="table__cell">Impact</th>
              <th className="table__cell">Risk</th>
              <th className="table__cell">Mitigation</th>
            </tr>
          </thead>
          <tbody>
            {[...plan.risks].sort((a, b) => b.impact - a.impact).map((r, i) => (
              <tr key={i} className="table__row">
                <td className="table__cell">{r.impact}</td>
                <td className="table__cell">{r.risk}</td>
                <td className="table__cell">{r.mitigation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="dev-plan-section">
        <h3 id="references" className="dev-plan-h">10.0.1 References</h3>
        <ul className="dev-plan-ul">
          {plan.references.map((r, i) => (
            <li key={i}>
              <span className="dev-plan-ref-kind">{r.kind === "external" ? "↗" : "→"}</span>{" "}
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
    <>
      <span className="dev-plan-id">{meta.id}</span>
      <span className="dev-plan-meta">
        <span className="dev-plan-title">{meta.title}</span>
        <span className="dev-plan-dates-strip">
          <span>created {fmtDate(meta.date_created)}</span>
          {meta.date_started && <span>started {fmtDate(meta.date_started)}</span>}
          {meta.date_finished && <span>finished {fmtDate(meta.date_finished)}</span>}
        </span>
      </span>
      <span className="dev-plan-progress">
        <span className="dev-plan-progress__pill">AC {acDone}/{acTotal}</span>
        <span className="dev-plan-progress__pill">WI {wiDone}/{wiTotal}</span>
      </span>
    </>
  );

  return (
    <DevAccordionItem header={header} onFirstOpen={loadPlan}>
      {loading && <div className="dev-research-loading">Loading…</div>}
      {error && <div className="dev-alert dev-alert--error">{error}</div>}
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
    <div className="dev-plans-panel">
      <div className="dev-research-header">
        <div>
          <p className="dev-p" style={{ marginBottom: 0 }}>
            Plans uploaded by the <code>&lt;stories&gt;</code> skill. Each plan groups the stories created in one shot of the skill and tracks their progress on the Planka board.
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
          placeholder="Search by PLA-NNNN or title…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="dev-alert dev-alert--error">{error}</div>}

      {!loading && plans.length === 0 && !error && (
        <div className="dev-research-empty">
          No plans yet. Run <code>&lt;stories&gt;</code> in the Claude Code CLI to create one.
        </div>
      )}

      {filtered.length > 0 && (
        <DevAccordion>
          {filtered.map(p => <PlanItem key={p.id} meta={p} />)}
        </DevAccordion>
      )}

      {!loading && filtered.length === 0 && plans.length > 0 && (
        <div className="dev-research-empty">
          No plans match &ldquo;<em>{search}</em>&rdquo;.
        </div>
      )}
    </div>
    </Panel>
  );
}
