"use client";

// /risk — risk register.
// Story 00097 restyle: header (28px / --ink-muted) from PageShell.
// Body is a Vector .table-wrap + .table — surface-sunken thead with
// eyebrow column heads, 48px rows from --row-height, hover lifts to
// --surface-sunken (rules in the base table block of globals.css).
// Severity uses .pill variants: HIGH=danger, MEDIUM=warning,
// LOW=neutral. No legacy .tag classes; no lime-green.

import PageShell from "@/app/components/PageShell";

interface Risk {
  id: string;
  title: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  likelihood: "HIGH" | "MEDIUM" | "LOW";
  owner: string;
  status: string;
  statusClass: string;
}

const SEVERITY_CLASS: Record<Risk["severity"], string> = {
  HIGH: "pill--danger",
  MEDIUM: "pill--warning",
  LOW: "pill--neutral",
};

const RISKS: Risk[] = [
  {
    id: "RSK-0001",
    title: "Vector rebrand may slip past Q3 deadline",
    severity: "HIGH",
    likelihood: "MEDIUM",
    owner: "R. Cook",
    status: "Mitigating",
    statusClass: "pill--info",
  },
  {
    id: "RSK-0002",
    title: "Backend SSE timeouts under heavy load",
    severity: "MEDIUM",
    likelihood: "LOW",
    owner: "M. Patel",
    status: "Monitoring",
    statusClass: "pill--neutral",
  },
  {
    id: "RSK-0003",
    title: "Lime-green leaks back into chart legends",
    severity: "LOW",
    likelihood: "LOW",
    owner: "Design",
    status: "Resolved",
    statusClass: "pill--success",
  },
];

export default function Risk() {
  return (
    <PageShell
      title="Risk"
      subtitle="Risk identification, analysis, and mitigation"
      actions={
        <button type="button" className="btn btn--primary">New risk</button>
      }
    >
      <h3 className="eyebrow">Active risks</h3>
      <div className="table-wrap">
        <table className="table">
          <thead className="table__head">
            <tr className="table__row">
              <th className="table__cell">ID</th>
              <th className="table__cell">Risk</th>
              <th className="table__cell">Severity</th>
              <th className="table__cell">Likelihood</th>
              <th className="table__cell">Owner</th>
              <th className="table__cell">Status</th>
            </tr>
          </thead>
          <tbody>
            {RISKS.map((r) => (
              <tr key={r.id} className="table__row">
                <td className="table__cell t-mono">{r.id}</td>
                <td className="table__cell">{r.title}</td>
                <td className="table__cell">
                  <span className={`pill ${SEVERITY_CLASS[r.severity]}`}>{r.severity}</span>
                </td>
                <td className="table__cell">
                  <span className={`pill ${SEVERITY_CLASS[r.likelihood]}`}>{r.likelihood}</span>
                </td>
                <td className="table__cell table__cell--muted">{r.owner}</td>
                <td className="table__cell">
                  <span className={`pill ${r.statusClass}`}>{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </PageShell>
  );
}
