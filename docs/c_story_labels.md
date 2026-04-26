# Story Labels Registry

All story cards MUST carry labels from these registries before exiting plan mode.

---

## Creation Source

| Label | Planka ID | Color | Purpose |
|---|---|---|---|
| `AIGEN` | `1761454228267599083` | lagoon-blue | AI-generated stories |

**Note:** Previously called `storify`; renamed to `AIGEN` (2026-04-26).

---

## Estimation (Fibonacci Sequence)

Every card carries exactly ONE of these. Sequence: 0, 1, 2, 3, 5, 8, 13, 21, ...

Hard rule: **No cards >= EST-F21.** If a story estimates F21 or higher, it is split before creation.

| Label | Planka ID | Color | Meaning | Time Reference |
|---|---|---|---|---|
| `EST-F0` | `1761454230876456173` | fresh-salad | Spike / investigation (no impl) | 0 hours |
| `EST-F1` | `1761454233325929711` | fresh-salad | Minimal scope | 1–2 hours |
| `EST-F2` | `1761454235641185521` | fresh-salad | Small story | 1–2 hours |
| `EST-F3` | `1761454237830612211` | fresh-salad | Moderate scope | 2–4 hours |
| `EST-F5` | `1761454239961318645` | fresh-salad | Medium story | 4–8 hours (half-day) |
| `EST-F8` | `1761454242100413687` | fresh-salad | Large story | 1–2 days |
| `EST-F13` | `1761454244239508729` | fresh-salad | Very large story | 2–3 days (HARD LIMIT) |

---

## Risk Level

Every card carries exactly ONE of these.

| Label | Planka ID | Color | Meaning |
|---|---|---|---|
| `RISK-LOW` | `1761454246445712635` | tank-green | Isolated, proven patterns, minimal dependencies |
| `RISK-MED` | `1761454248593196285` | egg-yellow | Some unknowns, moderate dependencies, integration |
| `RISK-HIGH` | `1761454250866509055` | berry-red | Novel approach, major dependencies, schema changes, breakage potential |

---

## Feature Areas (18 areas)

Every card carries exactly ONE of these. See `c_feature_areas.md` for full scope and allocation rules.

| Area | Label Format | Planka ID | Status |
|---|---|---|---|
| Portfolio | `FE-POR####` | TBD | Ready |
| Library | `FE-LIB####` | TBD | Ready |
| Items | `FE-ITM####` | TBD | Ready |
| Data/Graphs | `FE-DAT####` | TBD | Ready |
| UI | `FE-UI####` | TBD | Ready |
| UX | `FE-UX####` | TBD | Ready |
| Security | `FE-SEC####` | `1760810747115341214` | Active |
| Governance | `FE-GOV####` | TBD | Ready |
| Audit | `FE-AUD####` | TBD | Ready |
| Redundancy | `FE-RED####` | TBD | Ready |
| Rules & Logic | `FE-RUL####` | TBD | Ready |
| API | `FE-API####` | TBD | Ready |
| Database | `FE-SQL####` | TBD | Ready |
| Docker | `FE-DCR####` | TBD | Ready |
| Algorithm | `FE-ALG####` | TBD | Ready |
| Developer | `FE-DEV####` | `1761301483015374767` | Active (FE-DEV0002) |
| Developer | `FE-DEV####` | `1760909905369237242` | Active (FE-DEV0001) |

---

## Phase Labels

Every card carries exactly ONE of these. See `c_story_index.md` for active phase.

| Phase | Label | Planka ID | Status |
|---|---|---|---|
| Phase 5 | `PH-0005` | `1761354660716741817` | Active (CSS responsive design) |

---

## Special Labels (Optional)

| Label | Planka ID | Color | When Applied | Meaning |
|---|---|---|---|---|
| `MULTI AGENT` | `1760728388919624826` | berry-red | During planning (Step 2b) | Story is parallel-safe and can be claimed by another agent |

---

## Summary

**Every card MUST carry (hard gate):**
1. `AIGEN` (creation source)
2. `PH-####` (phase)
3. `FE-<AREA>####` (feature area)
4. `EST-F#` (Fibonacci: F0–F13)
5. `RISK-LOW/MED/HIGH` (risk level)

**Optional:**
- `MULTI AGENT` (only if story qualifies in Step 2b of `<stories>` skill)
