---
name: Project-level .claude/c_*.md files override ~/.claude/ globals
description: mmff-Ops uses localised protocol files — project triggers target .claude/c_*.md, not ~/.claude/. Globals stay as fallbacks for other projects (e.g. WPPC uses wppc.db).
type: project
originSessionId: 2ae83362-dabc-4472-8a8f-7b89c9458d58
---
The project CLAUDE.md triggers for `<AGENTS>`, `<ATS>`, `<mstories>`, `<ustories>`, `<defect>`, `<idea>`, and **Code Rules** point at `.claude/c_*.md` (project overrides), not `~/.claude/c_*.md` (globals).

**Why:** The globals originated in the WPPC project and hardcode `backend/data/wppc.db` in SQL examples. mmff-Ops uses `ops.db`. The project overrides at `.claude/c_*.md` contain the mmff-Ops-correct paths and feature lists. Before the retarget, triggers silently loaded the wrong file — agents only got the right behaviour by referencing the "Current Project State" section of CLAUDE.md which does say `ops.db`.

**How to apply:**
- If you edit a protocol file, edit the **project** copy at `.claude/c_*.md`.
- If you need a new project override, copy the global and localise (primarily: `wppc.db` → `ops.db`, feature block names, scaffold examples).
- Keep `~/.claude/c_*.md` untouched — those serve other projects.
- Build verification commands are inlined into CLAUDE.md itself (always-needed micro-content) — don't read `c_code-standards.md` just for tsc/vite steps.
- `debugtable` is the skill `/debugtable`, not a section of `c_code-standards.md`. The section has been removed from the project override.
- `c_sprint-git-protocol.md` is project-only (branch naming is mmff-Ops convention); referenced directly by the sprint-start/close skills, loaded only on STOP.
