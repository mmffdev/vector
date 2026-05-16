#!/usr/bin/env bash
# migrate-plans-to-feature-sop.sh
#
# One-shot backfill for plans authored before the Red-Green Feature-Driven
# Testing SOP was encoded into .claude/skills/stories/SKILL.md.
#
# Target plans: PLA-0053, PLA-0054, PLA-0055 (and any other plan whose
# description text already contains a `**Feature membership: F<N>**` marker
# and an `implementation_plan[1]` "Tracker under group `<group>`" line).
#
# What it does (idempotent):
#   1. Sets top-level `tracker_group` from the existing implementation_plan[1]
#      text (the "TRACKER REGRESSION LIBRARY" line authored by hand).
#   2. For each work_item_backlog entry whose description carries
#      "**Feature membership:** Part of feature group F<N> — <name>",
#      sets `kind: "implementation"`, `feature_id: "F<N>"`, and appends
#      `FEAT-N` to the tags array (if not already present).
#   3. For each work_item_backlog entry whose title begins
#      "NNNNN — TEST(F<N>):", sets `kind: "feature_test"`,
#      `feature_id: "F<N>"`, `feature_name` (extracted from title),
#      `tracker_group` (matches plan-level), and parses `covers` from
#      the description's "**Covers stories:** <id>, <id>, ..." line.
#
# Idempotency: re-runs are no-ops. Existing fields are preserved if already
# correct; only missing fields are written.
#
# Usage:
#   dev/scripts/migrate-plans-to-feature-sop.sh                # all PLA-NNNN.json in dev/plans/
#   dev/scripts/migrate-plans-to-feature-sop.sh PLA-0053       # specific plan(s)
#
# Requires: node (any modern version). Does NOT need npm/pnpm.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLANS_DIR="$REPO_ROOT/dev/plans"

if [ ! -d "$PLANS_DIR" ]; then
  echo "fatal: $PLANS_DIR not found" >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  TARGETS=()
  for arg in "$@"; do
    case "$arg" in
      PLA-*) TARGETS+=("$PLANS_DIR/${arg}.json") ;;
      *.json) TARGETS+=("$arg") ;;
      *) echo "skip: $arg (not a PLA id or .json path)" >&2 ;;
    esac
  done
else
  mapfile -t TARGETS < <(find "$PLANS_DIR" -maxdepth 1 -type f -name 'PLA-*.json' | sort)
fi

if [ "${#TARGETS[@]}" -eq 0 ]; then
  echo "no plan files to migrate"
  exit 0
fi

node - "${TARGETS[@]}" <<'NODE'
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(1);
let totalChanged = 0;
let totalSkipped = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    console.log(`miss : ${path.basename(file)} (not found)`);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf8');
  let plan;
  try {
    plan = JSON.parse(raw);
  } catch (e) {
    console.log(`error: ${path.basename(file)} — invalid JSON (${e.message})`);
    continue;
  }

  let changed = false;
  const notes = [];

  // 1. Derive tracker_group from implementation_plan[1] if missing.
  if (!plan.tracker_group && Array.isArray(plan.implementation_plan)) {
    for (const line of plan.implementation_plan) {
      const m = line && line.match(/Tracker under group `([a-z0-9-]+)`/i);
      if (m) {
        plan.tracker_group = m[1];
        notes.push(`tracker_group=${m[1]}`);
        changed = true;
        break;
      }
    }
  }

  // 2. Walk work_item_backlog and patch each entry.
  if (Array.isArray(plan.work_item_backlog)) {
    for (const wi of plan.work_item_backlog) {
      const desc = typeof wi.description === 'string' ? wi.description : '';
      const title = typeof wi.title === 'string' ? wi.title : '';

      // Feature_test detection: title starts "NNNNN — TEST(F<N>):"
      const testMatch = title.match(/^\d+\s+[—-]\s+TEST\(F(\d+)\):\s*(.+)$/);
      if (testMatch) {
        const fnum = testMatch[1];
        const fname = testMatch[2].trim();
        if (wi.kind !== 'feature_test') { wi.kind = 'feature_test'; changed = true; }
        if (wi.feature_id !== `F${fnum}`) { wi.feature_id = `F${fnum}`; changed = true; }
        if (!wi.feature_name) {
          // Extract the human-readable feature_name from description if present
          const fnMatch = desc.match(/feature\s+F\d+\s+\(([^)]+)\)/);
          wi.feature_name = fnMatch ? fnMatch[1].trim() : fname;
          changed = true;
        }
        if (!wi.tracker_group && plan.tracker_group) {
          wi.tracker_group = plan.tracker_group;
          changed = true;
        }
        // Parse covers from "**Covers stories:** <id>, <id>, ..."
        if (!Array.isArray(wi.covers) || wi.covers.length === 0) {
          const cMatch = desc.match(/\*\*Covers stories:\*\*\s*([0-9,\s]+)/);
          if (cMatch) {
            const ids = cMatch[1].split(',').map(s => s.trim()).filter(Boolean);
            if (ids.length > 0) {
              wi.covers = ids;
              changed = true;
            }
          }
        }
        notes.push(`${wi.story_id || '?????'}=feature_test(F${fnum})`);
        continue;
      }

      // Implementation: description carries **Feature membership:** Part of feature group F<N>
      const featMatch = desc.match(/\*\*Feature membership:\*\*\s*Part of feature group F(\d+)/);
      if (featMatch) {
        const fnum = featMatch[1];
        if (wi.kind !== 'implementation') { wi.kind = 'implementation'; changed = true; }
        if (wi.feature_id !== `F${fnum}`) { wi.feature_id = `F${fnum}`; changed = true; }
        if (!Array.isArray(wi.tags)) wi.tags = [];
        const featTag = `FEAT-${fnum}`;
        if (!wi.tags.includes(featTag)) {
          wi.tags.push(featTag);
          changed = true;
        }
        notes.push(`${wi.story_id || '?????'}=impl(F${fnum})`);
      }
    }
  }

  if (changed) {
    // Always update date_last_updated on a real change.
    const today = new Date().toISOString().slice(0, 10);
    plan.date_last_updated = today;
    fs.writeFileSync(file, JSON.stringify(plan, null, 2) + '\n', 'utf8');
    console.log(`patch: ${path.basename(file)} — ${notes.join(', ')}`);
    totalChanged++;
  } else {
    console.log(`ok   : ${path.basename(file)} (no changes needed)`);
    totalSkipped++;
  }
}

console.log(`\nchanged: ${totalChanged} | unchanged: ${totalSkipped}`);
NODE
