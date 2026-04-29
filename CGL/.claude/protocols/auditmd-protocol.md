---
name: auditmd-protocol
description: Skills & commands system audit protocol — inventories lazy-load compliance, command weight, check script health, and generates AuditADXX.tsx report.
type: protocol
---

# auditmd — Skills & Commands Audit Protocol

## Role
You are a systems auditor focused on the skills, commands, and lazy-load infrastructure. Your job is to scan, verify compliance, identify issues, and compile findings into a structured audit report.

## Constraints
- **Read the filesystem thoroughly** — use Glob, Grep, Read to understand before judging
- **The ONLY file you create** is the audit report: `web/src/components-dev/audits/AuditADXX.tsx`
- **Never modify existing files** — report issues, don't fix them
- **Be precise** — include file paths and line numbers for every finding

## Severity Levels

Use these exact string values in the `severity` field — they are passed to `renderCriticality` which maps them to coloured badges:

| severity value | Meaning |
|----------------|---------|
| `'CRITICAL'` | Blocking issue (missing file, broken lazy-load, skill not invocable) |
| `'HIGH'` | Compliance violation, stale reference, missing validation |
| `'LOW'` | Cleanup opportunity, naming inconsistency, documentation gap |

---

## Reporting Pattern: Findings vs Health Confirmations

The audit output differs based on whether issues exist:

**If audit finds CRITICAL/HIGH/actionable LOW items:**
- Title: **"Findings & Recommendations"** (or "Issues Found")
- Content: Table with `severity | location | finding | recommendation` columns
- Rows: Only actionable defects — things that need fixing
- Meta counts: Report actual severity distribution (e.g., "0 CRITICAL, 3 HIGH, 2 LOW")
- Examples: AD04 (8 HIGH findings), AD05 (3 HIGH findings pre-fix)

**If audit finds zero actionable issues (all passes):**
- Title: **"System Health — Zero Issues"** (or "Health Confirmations")
- Content: Table with `area | confirmation | status` columns (replace "finding" + "recommendation" with ✓ OK)
- Rows: Subsystem areas verified as healthy (lazy-load compliance, checks pass, parity confirmed, etc.)
- Meta counts: Report as "**0 CRITICAL, 0 HIGH, 0 actionable LOW**" + note confirmations
- Examples: AD06 (zero issues, 7 confirmations)

**Why the distinction?**
- "Findings" tables report *problems*. Reading "0 CRITICAL, 7 HIGH" would falsely imply issues exist.
- "Health" tables report *passing checks*. Reading "0 CRITICAL, 0 HIGH" + confirmations signals system health.
- Semantic clarity prevents alarm fatigue and confused prioritization.

---

## Phase A — Skill Inventory

### A.1 — Glob all .claude/skills/*/SKILL.md files

For each file:
- Extract `name`, `description`, `model` (if present), `allowed-tools`, `protocol-file` (if present)
- Count lines with `wc -l`
- Check if `protocol-file` field is present (lazy-load compliance: YES/NO)
- If `protocol-file` is present, verify the file exists on disk (status: EXISTS or MISSING)
- If `protocol-file` missing, mark status as "INLINE (not lazy-loaded)"

Build **SkillRow** table: name | type | lines | lazy-load | status

### A.2 — Glob ~/.claude/protocols/*.md files

For each protocol file:
- Count lines with `wc -l`
- Verify at least one SKILL.md or command file references it

Build **ProtocolRow** table: file | lines | referenced-by

### A.3 — Glob .claude/commands/*.md files

For each command file:
- Count lines with `wc -l`
- Check for `# DEPRECATED` header (deprecated: YES/NO)
- Check for `model:` override (has-model-override: YES/NO)
- Check for `--dry-run` flag in Flags section (has-dry-run: YES/NO)
- Extract `description` field

Build **CommandRow** table: name | lines | deprecated | model-override | dry-run | description

### A.4 — Summary counts

- Total skills found
- Total protocols found
- Total commands found
- Skills with protocol-file refs (lazy-loaded)
- Skills with missing protocol files (broken refs)
- Commands > 150 lines (weight concern)
- Deprecated commands

---

## Phase B — Check Scripts Execution

For each `.claude/checks/check-*.sh` script:

1. Run the script: `bash .claude/checks/check-*.sh`
2. Parse output line by line:
   - Lines starting with `[P0]` → CRITICAL severity
   - Lines starting with `[P1]` → HIGH severity
   - Lines starting with `[P2]` → LOW severity
   - Lines starting with `✓` → pass (no row)
   - Lines starting with `✗` or containing errors → HIGH severity
3. Extract finding text (everything after severity prefix)
4. Verify script execution (exit code 0 = OK, non-zero = script error)

Build **CheckRow** table per script: script | severity | finding | exit-code

---

## Phase C — Lazy Load Compliance Audit

For each Agent-class skill (identified by `model: opus` or `model: sonnet` in SKILL.md):

- **Header size check:** Count lines in SKILL.md up to and including the `protocol-file:` line. Flag if > 15 lines (bloated header).
- **Protocol existence:** Verify `protocol-file` field is present AND file exists. If missing → CRITICAL.
- **Combined size:** Count lines in SKILL.md + lines in protocol file. Flag if > 200 lines total (overhead concern).
- **Usage pattern:** Verify at least one `.claude/CLAUDE.md` or `.claude/commands/*.md` references this skill as an invocable shortcut.

Build **ComplianceRow** table: skill | header-lines | protocol-size | combined-size | compliance-status

---

## Phase D — Command Weight Analysis

For each `.claude/commands/*.md` file:

- **Line count threshold:** Flag if > 150 lines AND no `--dry-run` flag (concern: heavyweight command without safety net).
- **Model override:** Check for explicit `model:` field (indicates computational heaviness).
- **Deprecation check:** If `# DEPRECATED` present, verify deprecation message points to a replacement skill/command.
- **Argument hints:** Verify `argument-hint:` field is present (helps users understand flags).

Build **WeightRow** table: command | lines | model | dry-run | deprecated-replacement

---

## Phase E — Recommendations & Pros/Cons

Aggregate findings across all phases:

**Blocking Issues (must fix):**
- Protocol-file refs with missing files (CRITICAL)
- Skills with no lazy-load (INLINE) if they should be lazy-loaded (HIGH)
- Check scripts with exit errors (CRITICAL)

**Quality Issues (should fix):**
- Commands > 150 lines without --dry-run (HIGH)
- SKILL.md headers > 15 lines (HIGH)
- Deprecated commands with no replacement pointer (HIGH)
- Stale file path references in commands (HIGH — validate-api was one)

**Cleanup (nice-to-have):**
- Protocol files not referenced by any skill (LOW)
- Unused allowed-tools in SKILL.md headers (LOW)
- Missing `argument-hint:` in commands (LOW)

**Strengths:**
- List lazily-loaded skills that meet compliance (< 15 lines, protocol exists, < 200 combined)
- Commands with --dry-run present (safety-first design)
- Well-documented check scripts

---

## Output — Research Paper

After completing all phases, create an audit report.

### Step 1: Find next audit ID
```bash
ls web/src/components-dev/audits/AuditAD*.tsx 2>/dev/null | sort | tail -1 | grep -oP 'AuditAD\K\d+' | awk '{print $1 + 1}'
```
Fallback ID: AD04 (if no audits exist).

### Step 2: Create AuditADXX.tsx

**Title convention:** Always prefix with the entry point shortcut:
- If invoked via `<auditmd>` → title starts with `<auditmd> System Audit...`
- If invoked via `/audit` → title starts with `<audit> System Audit...`

Structure:
```tsx
import React from 'react';
import { FeatureTable, type Column } from '../../features/tables/feature_table_index';
import { renderCriticality } from '../../features/criticality/feature_criticality_index';

export const meta = { id: 'ADXX', title: '<auditmd> System Audit — Skills & Commands', category: 'DevOps', scope: 'Claude', date: 'YYYY-MM-DD', critical: N, warning: N, info: N };

const h2Style: React.CSSProperties = { color: 'var(--color-primary)' };

// Define interfaces for each phase's rows
interface SkillRow { name: string; type: string; lines: string; lazyLoad: string; status: string; }
interface ProtocolRow { file: string; lines: string; referencedBy: string; }
interface CommandRow { name: string; lines: string; deprecated: string; modelOverride: string; dryRun: string; }
interface CheckRow { script: string; severity: string; finding: string; exitCode: string; }
interface ComplianceRow { skill: string; headerLines: string; protocolSize: string; combinedSize: string; status: string; }
interface WeightRow { command: string; lines: string; model: string; dryRun: string; deprecatedReplacement: string; }

// Define column definitions for each table
const skillCols: Column<SkillRow>[] = [
  { key: 'name', label: 'Skill Name', width: '20%' },
  { key: 'type', label: 'Type', width: '10%' },
  { key: 'lines', label: 'Lines', width: '10%' },
  { key: 'lazyLoad', label: 'Lazy-Load', width: '15%' },
  { key: 'status', label: 'Status', width: '45%' },
];

// ... repeat for other phases ...

const AuditADXX: React.FC = () => (
  <article className="doc-page">
    <h1 className="ui-page-heading prefix-dev">&lt;auditmd&gt; ADXX — System Audit: Skills & Commands</h1>

    <h2 style={h2Style}>Executive Summary</h2>
    <p>
      [Brief summary of audit scope, total findings count, critical issues, and action items]
    </p>

    <h2 style={h2Style}>Phase A: Skill Inventory</h2>
    <p>[Context sentence]</p>
    <FeatureTable data={skillData} columns={skillCols} rowKey="name" initialPageSize={0} hideFilterBar />

    <h2 style={h2Style}>Phase B: Check Scripts Health</h2>
    <p>[Context sentence]</p>
    <FeatureTable data={checkData} columns={checkCols} rowKey="script" initialPageSize={0} hideFilterBar />

    <h2 style={h2Style}>Phase C: Lazy-Load Compliance</h2>
    <p>[Context sentence]</p>
    <FeatureTable data={complianceData} columns={complianceCols} rowKey="skill" initialPageSize={0} hideFilterBar />

    <h2 style={h2Style}>Phase D: Command Weight Analysis</h2>
    <p>[Context sentence]</p>
    <FeatureTable data={weightData} columns={weightCols} rowKey="command" initialPageSize={0} hideFilterBar />

    {/* CHOOSE ONE SECTION BASED ON AUDIT FINDINGS */}

    {/* OPTION A: If audit found CRITICAL/HIGH/actionable LOW issues */}
    <h2 style={h2Style}>Findings & Recommendations</h2>
    <p>[Summary of blocking, quality, and cleanup findings with structured recommendations]</p>
    <FeatureTable data={findingsData} columns={findingsCols} rowKey="id" initialPageSize={0} hideFilterBar />

    {/* OPTION B: If audit found zero actionable issues (all confirmations) */}
    <h2 style={h2Style}>System Health — Zero Issues</h2>
    <p><strong>0 CRITICAL, 0 HIGH, 0 actionable LOW.</strong> The confirmations below are healthy subsystem areas verified during this audit.</p>
    <FeatureTable data={healthData} columns={healthCols} rowKey="id" initialPageSize={0} hideFilterBar />

    <h2 style={h2Style}>Strengths</h2>
    <p>[List 3-5 patterns or designs that are working well]</p>

    <p className="doc-subtitle">
      System audit completed YYYY-MM-DD — X total findings across Y files. Critical: Z, High: A, Low: B.
    </p>
  </article>
);

export default AuditADXX;
```

### Step 3: Build verification
```bash
cd web && npx tsc --noEmit && npx vite build
```

### Step 4: Chat output
Report only: audit paper ID + total findings count. Do NOT dump raw findings to chat — the paper is the deliverable.

---

## Handling --dry-run Flag

If invoked with `--dry-run`:
1. Execute all phases A–E (read-only, no mutations)
2. Print planned audit output to stdout (not written to disk)
3. Exit without creating AuditADXX.tsx file
4. User can review and confirm before running without flag

---

## Final Notes

- Group related findings — don't report the same issue 50 times, summarize with a count
- If a phase finds zero issues, still include the section with a "No issues found" note and move on
- Be thorough but efficient — use Grep for pattern matching instead of reading entire large files
- The audit report is the deliverable — don't summarize in chat, just confirm the paper ID and count
