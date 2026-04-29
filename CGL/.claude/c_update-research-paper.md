# c_update-research-paper — Update Research Paper (Version Bump + Revised Stamp)

**Loaded on demand — read this file when the user writes `<updatepaper>`.**

Bumps the `version` field of an existing research paper and stamps `revised` with the current timestamp. Filesystem-only — no DB writes.

---

## Syntax

```
<updatepaper> RXXX --patch "reason"
<updatepaper> RXXX --minor "reason"
<updatepaper> RXXX --major "reason"
```

| Field | Required | Example |
|---|---|---|
| `RXXX` | yes | `R017` — the paper ID to update |
| `--patch` / `--minor` / `--major` | **yes** (exactly one) | bump flag — no default |
| `"reason"` | yes | short note on why it was bumped (logged, not stored) |

**A bump flag is required.** If the user omits it, ask which level to bump — do not guess.

---

## Bump math (semver)

Current version parsed from meta, e.g. `v1.2.3` → `MAJOR=1 MINOR=2 PATCH=3`.

| Flag | Bump | Example |
|---|---|---|
| `--patch` | `PATCH + 1` | `v1.2.3` → `v1.2.4` |
| `--minor` | `MINOR + 1`, `PATCH = 0` | `v1.2.3` → `v1.3.0` |
| `--major` | `MAJOR + 1`, `MINOR = 0`, `PATCH = 0` | `v1.2.3` → `v2.0.0` |

---

## Steps

### 1. Locate the file

```bash
FILE=/Users/rick/Documents/MMFFDev-Projects/mmff-Ops/web/src/components-dev/research/Research{RXXX}.tsx
```

Abort if the file does not exist.

### 2. Read current version

```bash
CURRENT=$(grep -oE "version:\s*'v[0-9]+\.[0-9]+\.[0-9]+'" "$FILE" | grep -oE "v[0-9]+\.[0-9]+\.[0-9]+")
```

If no match, abort and ask user to check the file.

### 3. Compute next version

Parse `vX.Y.Z`, apply the bump flag as per the table above. Example (patch):

```bash
read MAJOR MINOR PATCH <<< $(echo "${CURRENT#v}" | tr '.' ' ')
NEW="v${MAJOR}.${MINOR}.$((PATCH + 1))"
```

(For `--minor`: `v${MAJOR}.$((MINOR + 1)).0`. For `--major`: `v$((MAJOR + 1)).0.0`.)

### 4. Stamp revised timestamp

```bash
TS=$(date "+%Y-%m-%d %H:%M")
```

### 5. Apply edits to the TSX meta

Use the Edit tool (not sed) to replace the two meta fields inside `export const meta = { ... }`:

- `version: 'v{CURRENT}'` → `version: 'v{NEW}'`
- `revised: null` → `revised: '{TS}'` *(or replace existing `revised: 'prev-ts'` with new TS)*

The meta block may be single-line or multi-line — both patterns must be handled.

### 6. Confirm to user

Print:

> **RXXX updated**: `{CURRENT}` → `{NEW}`
> Revised: `{TS}`
> Reason: `{reason}`

### 7. (Optional) Body edits

`<updatepaper>` bumps the version + timestamp only. If the user's reason implies content changes ("clarified section 3", "added new finding"), ask whether they want to apply body edits in the same turn. Body edits happen after the version bump, using the Edit tool directly.

---

## Rules

- **Filesystem-only.** No DB calls. The frontend reads meta via `import.meta.glob` and picks up changes on next reload.
- **Bump flag required.** Never guess. If omitted, ask.
- **Do not touch `date`.** `date` is the creation timestamp — immutable. Only `revised` changes on update.
- **Do not touch `id`, `title`, `category`** unless the user explicitly asks — `<updatepaper>` is for version/revision bookkeeping, not full rewrites.
- Template/meta/version-badge rules are owned by `c_research-paper-format.md` — read it if the file structure looks unfamiliar.

---

## Build Verification

After the edit, run:

```bash
cd /Users/rick/Documents/MMFFDev-Projects/mmff-Ops/web && npx tsc --noEmit && npx vite build
```

If tsc or build fails, report and ask user to review.
