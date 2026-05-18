"use client";

import Panel from "@/app/components/Panel";
import DevSecurityAuditsListPanel from "./DevSecurityAuditsListPanel";

const CHECKS = [
  { id: "env-secrets",       label: "Env secrets audit",          href: "/docs/c_c_secrets_audit.md",        description: "os.Getenv sensitive-key inventory — verify no secrets leak into client bundles or logs." },
  { id: "backend-validation", label: "Backend-driven validation",  href: "/docs/c_c_backend_validation.md",   description: "All auth, scope, and ownership checks must be server-side. Frontend filtering is UX convenience, not security." },
  { id: "rbac",              label: "RBAC roles & permissions",    href: "/docs/c_c_roles_permissions.md",    description: "users_roles / users_permissions / users_roles_permissions — useHasPermission gates and lint trio." },
  { id: "transport-seg",     label: "Transport segregation",       href: "/docs/c_c_transport_segregation.md", description: "/_site + /samantha/v2 boundary; DTO convention; lint trio." },
  { id: "sql-injection",     label: "SQL injection surface",       href: "/docs/c_sql_cookbook.md",           description: "All queries must use parameterised args ($1, $2 …). No string interpolation into SQL." },
  { id: "polymorphic-fk",   label: "Polymorphic FK writes",       href: "/docs/c_polymorphic_writes.md",     description: "Writer rules + cleanup registry + canary. Sole-writer invariant must be maintained." },
  { id: "addressables",      label: "Addressable element lint",    href: "/docs/c_c_addressables.md",         description: "samantha._viewport.<slot>._kind.name — sole-writer + lint enforced." },
  { id: "access-version",   label: "Page access version",         href: null,                                description: "pages.access_version gating — verify all new pages declare the correct access gate (migration 198)." },
];

export default function DevSecurityAuditsPanel() {
  return (
    <div className="dev-doc">
      <Panel name="dev_sec_header" title="Security Audits">
        <p className="dev-p">
          Pre-launch security checklist — cross-cutting concerns mapped to their canonical docs.
          Each item links to the relevant guide; verify before any external-user or launch milestone.
        </p>
      </Panel>

      <Panel name="dev_sec_checklist" title="Checklist">
        <table className="dui-table">
          <thead>
            <tr>
              <th className="dui-th">Area</th>
              <th className="dui-th">What to verify</th>
              <th className="dui-th">Guide</th>
            </tr>
          </thead>
          <tbody>
            {CHECKS.map((c) => (
              <tr key={c.id}>
                <td className="dui-td dui-td--mono">{c.label}</td>
                <td className="dui-td">{c.description}</td>
                <td className="dui-td">
                  {c.href ? (
                    <a className="dui-link" href={c.href} target="_blank" rel="noreferrer">
                      docs
                    </a>
                  ) : (
                    <span className="dui-meta">inline</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel name="dev_sec_notes" title="Notes">
        <ul className="dev-list">
          <li>This checklist supplements, not replaces, the full <strong>WCAG 2.2 AA</strong> accessibility pre-launch checklist (<code>docs/c_accessibility.md</code>).</li>
          <li>Procurement audit readiness requires every backend route to re-verify tenant/user/scope server-side — no client-supplied values are trusted.</li>
          <li>Run <code>npm run lint</code> to verify the lint trio (transport, RBAC, addressable sole-writer) before shipping any auth-adjacent change.</li>
        </ul>
      </Panel>

      <DevSecurityAuditsListPanel />
    </div>
  );
}
