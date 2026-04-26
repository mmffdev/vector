# Story Labels — Creation & Retrofit Plan

## Labels to Create on Planka

These labels MUST be created before `<stories>` skill goes live:

### Creation Source

| Label | Color | Purpose | Old Name |
|---|---|---|---|
| `AIGEN` | sky-blue | AI-generated stories | `storify` (to be renamed) |

### Estimation (Fibonacci)

| Label | Color | Purpose |
|---|---|---|
| `EST-F0` | silver | Spike / investigation (no implementation) |
| `EST-F1` | silver | 1–2 hours |
| `EST-F2` | silver | 1–2 hours |
| `EST-F3` | silver | 2–4 hours |
| `EST-F5` | silver | 4–8 hours (half-day) |
| `EST-F8` | silver | 1–2 days |
| `EST-F13` | silver | 2–3 days (HARD LIMIT) |

### Risk Level

| Label | Color | Purpose |
|---|---|---|
| `RISK-LOW` | green | Low risk: isolated, proven patterns, minimal dependencies |
| `RISK-MED` | yellow | Medium risk: some unknowns, moderate dependencies, integration |
| `RISK-HIGH` | red | High risk: novel approach, major dependencies, schema changes, breakage potential |

---

## Retrofit Plan (Existing Cards)

All existing cards carrying the `storify` label MUST be updated:

1. **Rename label:** `storify` → `AIGEN` (same ID `1760724305328473193`, just rename)
2. **Backfill EST labels:** Review existing cards and assign EST-F0 through EST-F13 based on scope
3. **Backfill RISK labels:** Assign RISK-LOW/MED/HIGH based on story scope and complexity

**Affected cards (currently live on Planka):**
- Cards 00001–00049 (all existing stories)

**Retrofit priority:**
- High priority: In-flight cards (Doing, To Do)
- Lower priority: Completed/Accepted cards (historical; can be backfilled over time)

---

## Label Creation Script (via .claude/bin/planka)

```bash
# Creation source
./.claude/bin/planka create-label 1760699595475649556 "AIGEN" "sky-blue" 65536

# Estimation
./.claude/bin/planka create-label 1760699595475649556 "EST-F0" "silver" 65536
./.claude/bin/planka create-label 1760699595475649556 "EST-F1" "silver" 66000
./.claude/bin/planka create-label 1760699595475649556 "EST-F2" "silver" 66500
./.claude/bin/planka create-label 1760699595475649556 "EST-F3" "silver" 67000
./.claude/bin/planka create-label 1760699595475649556 "EST-F5" "silver" 67500
./.claude/bin/planka create-label 1760699595475649556 "EST-F8" "silver" 68000
./.claude/bin/planka create-label 1760699595475649556 "EST-F13" "silver" 68500

# Risk
./.claude/bin/planka create-label 1760699595475649556 "RISK-LOW" "green" 69000
./.claude/bin/planka create-label 1760699595475649556 "RISK-MED" "yellow" 69500
./.claude/bin/planka create-label 1760699595475649556 "RISK-HIGH" "red" 70000
```

---

## Registry Update (c_story_labels.md)

After label creation, update the registry with Planka label IDs:

| Label | Planka ID | Color | Status |
|---|---|---|---|
| AIGEN | TBD | sky-blue | To create |
| EST-F0 | TBD | silver | To create |
| EST-F1 | TBD | silver | To create |
| EST-F2 | TBD | silver | To create |
| EST-F3 | TBD | silver | To create |
| EST-F5 | TBD | silver | To create |
| EST-F8 | TBD | silver | To create |
| EST-F13 | TBD | silver | To create |
| RISK-LOW | TBD | green | To create |
| RISK-MED | TBD | yellow | To create |
| RISK-HIGH | TBD | red | To create |

---

## Next Steps

1. Create all 11 labels on Planka (run label creation script)
2. Rename existing `storify` label to `AIGEN` (Planka UI)
3. Backfill EST + RISK labels on existing cards (automated script or manual)
4. Update registry with new Planka IDs
5. Update `<stories>` skill to apply all 7 gates before card creation
6. Update CLAUDE.md to reference story acceptance system
