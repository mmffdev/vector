---
name: Operations manual → Admin page
description: Port R020 operations manual content to AdminDashboardPage as live data-driven section, replacing static research paper
type: project
originSessionId: bd7f0e8b-6ef2-40b1-90a8-f58c319cd912
---
R020 (Platform Operations Manual) is a static-in-time research paper documenting commands, data flows, sources of truth, gaps, and remediation. It won't port to the next project.

**Why:** R020 content needs to be a living document that stays current, not a frozen snapshot. The Admin page already has system health, checklists, and audit logs — operations data fits there naturally.

**How to apply:** Future story — add operations sections (command registry, data flows, gap tracker, remediation status) to AdminDashboardPage as data-driven components that query the DB and read config instead of hardcoded JSX arrays.
