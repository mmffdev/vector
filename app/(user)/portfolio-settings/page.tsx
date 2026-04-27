"use client";

// /portfolio-settings — placeholder settings surface (padmin/gadmin).
// Story 00092 restyle: page header (28px title + ink-muted subtitle
// + flex-end actions) comes from PageShell + .page__head. The body
// previews the future settings form using the Vector kit primitives:
// section headings as .eyebrow micro-labels (11px uppercase /
// --ink-subtle), .form__input controls at 40px / --radius-md /
// --border-strong, and a sticky-ish action footer with a single
// .btn--primary save plus a destructive .btn--danger archive option.
// All controls are disabled until the real backend wiring lands —
// keeps the surface visible to the design audit while preventing
// data writes.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import { useAuth } from "@/app/contexts/AuthContext";

export default function PortfolioSettingsPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user && user.role === "user") router.replace("/dashboard");
  }, [user, router]);

  if (!user || user.role === "user") return null;

  return (
    <PageShell
      title="Portfolio Settings"
      subtitle="Manage portfolios, products, and stakeholders"
      actions={
        <>
          <button type="button" className="btn btn--secondary" disabled>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled>
            Save changes
          </button>
        </>
      }
    >
      <form className="form" onSubmit={(e) => e.preventDefault()}>
        <section>
          <h3 className="eyebrow">Identity</h3>
          <div className="form__row">
            <label className="form__label" htmlFor="ps-name">Display name</label>
            <input
              id="ps-name"
              className="form__input"
              type="text"
              placeholder="MMFF Standard portfolio"
              disabled
              defaultValue=""
            />
          </div>
          <div className="form__row" style={{ marginTop: "var(--space-3)" }}>
            <label className="form__label" htmlFor="ps-key">Key</label>
            <input
              id="ps-key"
              className="form__input"
              type="text"
              placeholder="mmff-standard"
              disabled
              defaultValue=""
            />
          </div>
        </section>

        <section style={{ marginTop: "var(--space-6)" }}>
          <h3 className="eyebrow">Stakeholders</h3>
          <div className="form__row">
            <label className="form__label" htmlFor="ps-owner">Default owner</label>
            <select id="ps-owner" className="form__select" disabled defaultValue="">
              <option value="">Select a user…</option>
            </select>
          </div>
          <div className="form__row" style={{ marginTop: "var(--space-3)" }}>
            <label className="form__label" htmlFor="ps-notes">Stakeholder notes</label>
            <textarea
              id="ps-notes"
              className="form__textarea"
              placeholder="Optional context for portfolio owners and contributors."
              disabled
              defaultValue=""
            />
          </div>
        </section>

        <section style={{ marginTop: "var(--space-6)" }}>
          <h3 className="eyebrow">Danger zone</h3>
          <p className="form__hint" style={{ marginBottom: "var(--space-3)" }}>
            Archive removes the portfolio from active selection. Existing data
            is preserved and can be restored by a gadmin.
          </p>
          <button type="button" className="btn btn--danger" disabled>
            Archive portfolio
          </button>
        </section>
      </form>
    </PageShell>
  );
}
