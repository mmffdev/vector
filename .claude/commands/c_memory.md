# `<memory>` — .claude context scanner

Scans the `.claude/` directory for context health across memory, skills, commands, hooks, and agents. Writes a timestamped JSON file to `dev/reports/` which the Dev → Reports tab renders.

**Report store:** `<project-root>/dev/reports/<YYYYMMDD-HHmmss>-<scope>.json`

## Syntax

```
<memory> -A    Scan all areas (Memory + Skills + Commands + Hooks + Agents)
<memory> -M    Scan memory files only
<memory> -S    Scan skills only
<memory> -C    Scan commands only
<memory> -H    Scan hooks only
```

---

## Scan protocol

Run the relevant checks below, then write the report.

### -M — Memory

```bash
ls ~/.claude/projects/-Users-rick-Documents-MMFFDev-Projects-MMFFDev---PM/memory/
cat ~/.claude/projects/-Users-rick-Documents-MMFFDev-Projects-MMFFDev---PM/memory/MEMORY.md
```

**Checks:**
1. MEMORY.md line count — warn if ≥ 180, fail if ≥ 200
2. For each `.md` file in memory dir: is it referenced in MEMORY.md? (orphaned = warn)
3. For each link in MEMORY.md: does the target file exist? (broken = fail)
4. For each indexed file: does it have `---` frontmatter with `name`, `description`, `type`? (missing = warn)
5. Count by type (user / feedback / project / reference) — report distribution

### -S — Skills

```bash
find ~/.claude/skills -name "SKILL.md" 2>/dev/null
find "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/skills" -name "SKILL.md" 2>/dev/null
```

**Checks:**
1. For each SKILL.md: does first line start with `---`? (comment before frontmatter = fail — causes blank description in skill list)
2. For each SKILL.md: does frontmatter have `name`, `description`, `allowed-tools`? (missing field = warn)
3. Is `description` non-empty and not a comment string? (blank/comment = fail)

### -C — Commands

```bash
ls "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/commands/"
cat "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/CLAUDE.md"
```

**Checks:**
1. For each `c_*.md` file in commands dir: is it referenced in CLAUDE.md? (unreferenced = warn)
2. For each `(.claude/commands/c_*.md)` link in CLAUDE.md: does the target file exist? (broken = fail)

### -H — Hooks

```bash
cat "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/.claude/settings.json" 2>/dev/null || echo "{}"
cat ~/.claude/settings.json 2>/dev/null || echo "{}"
```

**Checks:**
1. List all registered hooks with matcher and command
2. For each hook command that references a file path: does the file exist? (missing = fail)
3. For each hook command that is a shell command: is it non-empty? (empty = warn)

### -A — All

Run all four scans above in sequence. Report has one entry per scope, all bundled into a single `scope: "A"` report.

---

## Report format

Build a JSON object:

```json
{
  "id": "<YYYYMMDD-HHmmss>-<scope>",
  "scope": "A" | "M" | "S" | "C" | "H",
  "scopeName": "All" | "Memory" | "Skills" | "Commands" | "Hooks",
  "flag": "-A" | "-M" | "-S" | "-C" | "-H",
  "timestamp": "<ISO 8601>",
  "checks": [
    {
      "status": "pass" | "warn" | "fail",
      "label": "<short check name>",
      "detail": "<one sentence finding>"
    }
  ],
  "summary": { "pass": N, "warn": N, "fail": N }
}
```

## Write the report

1. Build the report object (id = `<YYYYMMDD-HHmmss>-<scope>`).
2. Write it as a single JSON object to `dev/reports/<id>.json` (create `dev/reports/` dir if needed).
3. Do NOT append to any shared file — one file per scan run.

## Report to user

```
<memory> -<flag> complete — <pass> passed, <warn> warnings, <fail> failures. Report saved to dev/reports/<id>.json — view in Dev → Reports tab.
```

List any `fail` items inline so the user sees them immediately without opening the browser.

---

## Auto-fix (safe issues only)

After writing the report, apply fixes for these two warn classes without asking:

### Orphaned memory files (M scope)

A `.md` file exists in the memory dir but has no MEMORY.md entry. Fix: append a pointer line.

1. Read the orphaned file to get its `name` field from frontmatter (fallback: filename stem).
2. Append to MEMORY.md: `- [<name>](<filename>) — <one-line description from frontmatter or "session snapshot">.`
3. Record fix in the report as a synthetic `"status": "fixed"` check.

### Unreferenced command files (C scope)

A `c_*.md` file exists in commands/ but has no CLAUDE.md entry. Fix: append a pointer line.

1. Read the first non-blank line of the command file to extract a short hook (strip leading `#`).
2. Append to CLAUDE.md in the Working practices section: `- **`<filename stem>` (`<shortcut if obvious>`)** → [`.claude/commands/<filename>`](commands/<filename>) — <hook>.`
3. Record fix as `"status": "fixed"` in report.

**Do NOT auto-fix:** broken MEMORY.md links (target missing — needs human decision), broken CLAUDE.md links (same), skill frontmatter issues (may affect behavior), or hook config issues.

After fixes, re-run the affected checks and update the summary counts before writing the final report.

---

## Rules

- Run bash commands with Read tool where possible; use Bash only when needed.
- Read-only during scan; write only MEMORY.md and CLAUDE.md during auto-fix, and only for the two safe classes above.
- Keep check labels short (≤ 40 chars) — they appear in the accordion header area.
- `detail` must be one sentence — it renders in a fixed-height row.
