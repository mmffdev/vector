# c_write-research-paper — Write Research Paper (Shared Convergence)

**Loaded on demand — read this file when `c_addpaper-protocol.md` or `c_addpaper_research-protocol.md` needs to create a new research paper.**

This protocol is the **shared CREATE step** for both `<addpaper>` and `<research> --page`. It receives compiled content + metadata, allocates the next ID from the filesystem, and creates the TSX file.

Filesystem-only — no DB writes. The frontend auto-discovers papers via `import.meta.glob`.

---

## Input

Expects the calling protocol to provide:

| Field | Type | Example |
|---|---|---|
| `content` | string (markdown or key findings) | "## Key Finding\n\nDocker Swarm enables..." |
| `title` | string | "Docker Swarm Networking" |
| `category` | string | "DevOps" |

**Date:** the writer stamps the current timestamp itself. Callers do not supply a date. Run `date "+%Y-%m-%d %H:%M"` once at Step 2 and reuse the same string in the TSX `meta`.

---

## Steps

### 1. Allocate next ID (filesystem)

```bash
cd /Users/rick/Documents/MMFFDev-Projects/mmff-Ops/web/src/components-dev/research
LAST=$(ls ResearchR*.tsx 2>/dev/null | sort | tail -1 | sed -E 's/ResearchR0*([0-9]+)\.tsx/\1/')
NEXT=$(printf "R%03d" $((${LAST:-0} + 1)))
echo "Next ID: $NEXT"
```

### 2. Read the format skeleton

**Read `~/.claude/c_research-paper-format.md`** for the canonical TSX skeleton, meta shape, and version-badge JSX. All template rules live there — this file only handles the CREATE flow.

### 3. Stamp timestamp and create TSX file

```bash
TS=$(date "+%Y-%m-%d %H:%M")
```

Create `web/src/components-dev/research/Research{NEXT}.tsx` following the skeleton from `c_research-paper-format.md`. Substitute:

- `RXXX` → the allocated ID (e.g. `R037`)
- `TITLE` → the paper title
- `CATEGORY` → the category
- `YYYY-MM-DD HH:MM` → `$TS`
- `version: 'v1.0.0'` (always — starter version on create)
- `revised: null` (always — no revisions yet)
- Executive Summary — insert 3–5 sentence synthesis into first `<p>`
- Detailed Findings — insert compiled content into section 3

### 4. Ask: Accept stories?

Print:

> **Proposed Stories**
> Would you like to propose user stories for this research?
> (yes/no — only relevant if this paper describes a feature change or technical upgrade)

**If no:** Done. Story placeholder stays in the Action Plan.

**If yes:** Read `~/.claude/c_addpaper-stories.md` and follow it. That protocol will:
- Synthesise story candidates
- Present a proposal table
- After user acceptance, update this TSX file's `actionPlanData` array
- Inject h1 badges for accepted area prefixes
- Call `<mstories>` conventions for DB insert

---

## Build Verification

After file creation, run:

```bash
cd /Users/rick/Documents/MMFFDev-Projects/mmff-Ops/web && npx tsc --noEmit && npx vite build
```

If any type errors or build failures, abort and ask user to review.

---

## Notes

- This is the **shared CREATE sink** — both `<addpaper> topic` and `<research> url --page` converge here.
- For updates (bumping version, stamping `revised`), use `<updatepaper>` → `c_update-research-paper.md`.
- Template/meta/version-badge rules are owned by `c_research-paper-format.md` — do not duplicate them here.
- Story integration is **optional** — if the user declines stories, the paper is complete.
- The frontend reads meta via `import.meta.glob` from the TSX files directly — no DB writes are needed or performed.
