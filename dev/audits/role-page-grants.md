# Role × Page-Grant Audit

_Generated: 2026-05-19 23:58:06_

Snapshot of every `users_roles_pages` row, grouped by role and tag bucket.
Useful for sanity-checking what each role can actually reach via the nav rail
(PLA-0053 / B5.15 — single-gate validation).

## Grants by role × bucket

| Role | Tag bucket | # pages | Pages |
|---|---|---:|---|
| Global Admin | `avatar_menu` | 3 | account-settings, preferences-navigation, theme |
| Global Admin | `dev_tools` | 16 | dev-api-audit, dev-api-changelog, dev-api-v2-tests, dev-components, dev-icons, dev-operations, dev-page-help, dev-plans, dev-reports, dev-research, dev-retros, dev-scope, dev-security-audits, dev-setup, dev-shortcuts, dev-ui-catalog |
| Global Admin | `notifications` | 1 | notifications-manager |
| Global Admin | `personal` | 3 | dashboard, favourites, my-vista |
| Global Admin | `planning` | 9 | backlog, planning, portfolio, portfolio-items, releases, risk, scope, sprints, work-items |
| Global Admin | `user_management` | 2 | um-permissions, um-users |
| Global Admin | `vector_admin` | 3 | library-releases, va-api-manager, va-tenant-settings |
| Global Admin | `workspace_admin` | 12 | portfolio-settings, va-topology, va-topology-map, ws-artefacts, ws-artefact-types, ws-cost-centres, ws-flow-states, ws-flow-states-v2, ws-portfolio-model, ws-transition-rules, ws-workspace-details, ws-workspaces |
| Portfolio Manager | `avatar_menu` | 3 | account-settings, preferences-navigation, theme |
| Portfolio Manager | `dev_tools` | 16 | dev-api-audit, dev-api-changelog, dev-api-v2-tests, dev-components, dev-icons, dev-operations, dev-page-help, dev-plans, dev-reports, dev-research, dev-retros, dev-scope, dev-security-audits, dev-setup, dev-shortcuts, dev-ui-catalog |
| Portfolio Manager | `notifications` | 1 | notifications-manager |
| Portfolio Manager | `personal` | 3 | dashboard, favourites, my-vista |
| Portfolio Manager | `planning` | 9 | backlog, planning, portfolio, portfolio-items, releases, risk, scope, sprints, work-items |
| Portfolio Manager | `user_management` | 2 | um-permissions, um-users |
| Portfolio Manager | `vector_admin` | 5 | library-releases, va-api-manager, va-api-manager-asset-register, va-api-manager-webhooks, va-tenant-settings |
| Portfolio Manager | `workspace_admin` | 11 | portfolio-settings, va-topology, va-topology-map, ws-artefacts, ws-artefact-types, ws-flow-states, ws-flow-states-v2, ws-portfolio-model, ws-transition-rules, ws-workspace-details, ws-workspaces |
| Product Owner | `dev_tools` | 16 | dev-api-audit, dev-api-changelog, dev-api-v2-tests, dev-components, dev-icons, dev-operations, dev-page-help, dev-plans, dev-reports, dev-research, dev-retros, dev-scope, dev-security-audits, dev-setup, dev-shortcuts, dev-ui-catalog |
| Product Owner | `notifications` | 1 | notifications-manager |
| Product Owner | `personal` | 3 | dashboard, favourites, my-vista |
| Product Owner | `planning` | 9 | backlog, planning, portfolio, portfolio-items, releases, risk, scope, sprints, work-items |
| Product Owner | `user_management` | 2 | um-permissions, um-users |
| Product Owner | `vector_admin` | 5 | library-releases, va-api-manager, va-api-manager-asset-register, va-api-manager-webhooks, va-tenant-settings |
| Product Owner | `workspace_admin` | 11 | portfolio-settings, va-topology, va-topology-map, ws-artefacts, ws-artefact-types, ws-flow-states, ws-flow-states-v2, ws-portfolio-model, ws-transition-rules, ws-workspace-details, ws-workspaces |
| Stakeholder | `dev_tools` | 16 | dev-api-audit, dev-api-changelog, dev-api-v2-tests, dev-components, dev-icons, dev-operations, dev-page-help, dev-plans, dev-reports, dev-research, dev-retros, dev-scope, dev-security-audits, dev-setup, dev-shortcuts, dev-ui-catalog |
| Stakeholder | `notifications` | 1 | notifications-manager |
| Stakeholder | `personal` | 3 | dashboard, favourites, my-vista |
| Team Lead | `dev_tools` | 16 | dev-api-audit, dev-api-changelog, dev-api-v2-tests, dev-components, dev-icons, dev-operations, dev-page-help, dev-plans, dev-reports, dev-research, dev-retros, dev-scope, dev-security-audits, dev-setup, dev-shortcuts, dev-ui-catalog |
| Team Lead | `notifications` | 1 | notifications-manager |
| Team Lead | `personal` | 3 | dashboard, favourites, my-vista |
| Team Lead | `planning` | 9 | backlog, planning, portfolio, portfolio-items, releases, risk, scope, sprints, work-items |
| Team Member | `avatar_menu` | 3 | account-settings, preferences-navigation, theme |
| Team Member | `dev_tools` | 16 | dev-api-audit, dev-api-changelog, dev-api-v2-tests, dev-components, dev-icons, dev-operations, dev-page-help, dev-plans, dev-reports, dev-research, dev-retros, dev-scope, dev-security-audits, dev-setup, dev-shortcuts, dev-ui-catalog |
| Team Member | `notifications` | 1 | notifications-manager |
| Team Member | `personal` | 3 | dashboard, favourites, my-vista |
| Team Member | `planning` | 9 | backlog, planning, portfolio, portfolio-items, releases, risk, scope, sprints, work-items |

## Possible drift — non-admin roles with admin-tag grants

If you see a Team-Member-tier role listed under `vector_admin`, `user_management`,
`workspace_admin`, or `dev_tools` and that wasn't an explicit grant from the
permissions matrix at `/user-management/permissions`, treat it as a seed-drift bug.
After PLA-0053 there is no tier filter hiding it — what the table says is what users see.

| Role | Admin bucket | # pages |
|---|---|---:|
| Product Owner | `dev_tools` | 16 |
| Product Owner | `user_management` | 2 |
| Product Owner | `vector_admin` | 5 |
| Product Owner | `workspace_admin` | 11 |
| Stakeholder | `dev_tools` | 16 |
| Team Lead | `dev_tools` | 16 |
| Team Member | `dev_tools` | 16 |
