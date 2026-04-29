# Config Change Log — CCFG-001

**Date:** 2026-04-15  
**Backup file:** `CLAUDE-CCFG-001.md`  
**Sprint:** sprint013

## Changes Made

### 1. `research` shortcut → replaced with `<addpaper>`
- **Old:** Manual 3-step process — create file, add to ARTICLES array, add to ARTICLE_COMPONENTS map
- **New:** Zero-registration — create ONE file with `export const meta` + default component. `import.meta.glob` auto-discovers it. No edits to ResearchPage.tsx ever again.
- **Why:** Eliminated 2 of 3 manual steps and the risk of ID drift or forgotten registrations.

### 2. `<mstories>` — DB query before ID assignment
- **Old:** IDs assigned from memory, risk of collision with existing stories
- **New:** Query `SELECT id FROM backlog_items WHERE id LIKE '{AREA}-%' ORDER BY id DESC LIMIT 1` per area prefix before drafting. IDs guaranteed correct.
- **Why:** Caught sprint ID numbering errors in practice (BSI stories assigned wrong sprint).

### 3. `<mstories>` — changelog entry drafting added
- **New:** After story insertion, draft changelog entries (type + feature + description) and POST to `/api/dev/changelog`
- **Why:** Auto-populates the ChangeLogPage as a byproduct of normal story workflow.

### 4. `<ustories>` — DB query before status update
- **Old:** Status updated based on recalled session state
- **New:** Query actual DB state first — shows "Was → Now" comparison from real data
- **Why:** Prevents updating already-done stories or missing status changes from other sessions.

### 5. `<closesprint> sprintXXX` — NEW shortcut
- Queries all changelog entries for the sprint
- Presents for review / confirmation
- Updates CLAUDE.md Current State to next sprint
- Handles fast-forward merge + tag (sprint lifecycle)

### 6. `<changelog> type "feature" "description"` — NEW shortcut
- Quick one-shot changelog entry without going through `<mstories>`
- POSTs to `/api/dev/changelog`, returns generated ref_id

## Files Changed
- `~/.claude/CLAUDE.md` — primary
- `.claude/CLAUDE.md` — synced copy
