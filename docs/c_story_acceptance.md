# Story Acceptance Criteria — Hard Gates & Replanning Logic

Every story card MUST carry these exact attributes before it can be marked "ready for review." Failure on any gate triggers replanning.

---

## Required Attributes (Hard Gate)

Every card MUST have ALL of these before exiting `<stories>` skill:

### 1. Story ID + Title
- **Format:** `NNNNN — <title>` (5-digit zero-padded, em dash, then title)
- **Example:** `00050 — Backend: archive old portfolio layers before adopting new model`
- **Gate:** Must match regex `^\d{5} — .{10,}$` (title min 10 chars)

### 2. Label: AIGEN (creation source)
- **Name:** `AIGEN` (AI-generated stories)
- **Color:** (assign a distinct color — suggest: sky-blue or similar)
- **Planka ID:** TBD (will be created and retrofitted to all existing storify cards)
- **Gate:** Card MUST carry this label; no exceptions

### 3. Label: Phase (e.g., `PH-0005`)
- **Format:** `PH-NNNN` (4-digit zero-padded phase counter)
- **Example:** `PH-0005` (CSS responsive design)
- **Gate:** Card MUST carry exactly one phase label; no exceptions

### 4. Label: Feature Area (e.g., `FE-DEV0001`)
- **Format:** `FE-<AREA>NNNN` (3-letter area code + 4-digit counter)
- **Example:** `FE-DEV0001`, `FE-POR0002`, `FE-API0003`
- **Valid areas:** POR, LIB, ITM, DAT, UI, UX, SEC, GOV, AUD, RED, RUL, API, SQL, DCR, ALG, DEV
- **Gate:** Card MUST carry exactly one feature area label; no exceptions

### 5. Label: Estimation (Fibonacci Sequence)
- **Sequence:** 0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, ...
- **Format:** `EST-F<N>` (e.g., `EST-F0`, `EST-F1`, `EST-F2`, ... `EST-F13`)
- **Mapping to story points/time (reference):**
  - F0 = 0 points (spike, investigation, no implementation)
  - F1 = 1 point (~30 min - 1 hour)
  - F2 = 2 points (~1-2 hours)
  - F3 = 3 points (~2-4 hours)
  - F5 = 5 points (~4-8 hours / half-day)
  - F8 = 8 points (~1-2 days)
  - F13 = 13 points (~2-3 days) **← HARD LIMIT**
  - F21+ = **SPLIT REQUIRED** (exceeds complexity threshold; must break into smaller stories)

- **Hard rule:** If a story scores **EST-F21 or higher**, `<stories>` MUST split it before creating. No cards >= F21 exist.
- **Gate:** Card MUST carry exactly one EST label (F0–F13 only); no exceptions

### 6. Label: Risk Level (Scaled)
- **Options:** `RISK-LOW`, `RISK-MED`, `RISK-HIGH`
- **Colors:** 
  - `RISK-LOW` = green (low risk, isolated, proven patterns)
  - `RISK-MED` = yellow (some unknowns, moderate dependencies)
  - `RISK-HIGH` = red (novel approach, major dependencies, breakage potential)
- **Gate:** Card MUST carry exactly one risk label; no exceptions

### 7. Description (Business Language)
- **Format:** User story template
  ```
  ## As a <role>, I wish <action>, so that <benefit>
  
  <one-paragraph context explaining the "why">
  
  ## Acceptance Criteria
  
  - **As Proven by X:** <specific, verifiable outcome>
  - **As Proven by Y:** <specific, verifiable outcome>
  - **As Proven by Z:** <specific, verifiable outcome>
  ```
- **Gate:** Description MUST follow this format exactly; no tech jargon in "As a" clause

---

## Description Format (Hard Rule)

**User Story Template:**

```
## As a <role>, I wish <action>, so that <benefit>

<one paragraph explaining context and why this matters>

## Acceptance Criteria

- **As Proven by X:** <specific, measurable outcome>
- **As Proven by Y:** <specific, measurable outcome>
- **As Proven by Z:** <specific, measurable outcome>
```

**Requirements for each section:**

- **Role:** A real persona (e.g., "dev gadmin", "portfolio owner", "system operator", "backend dev") — NOT "system", "backend", "user"
- **Action:** Concrete task (e.g., "reset a portfolio model", "see a dashboard graph") — NOT "support", "enable", "handle"
- **Benefit:** Observable outcome (e.g., "so that I can start over") — NOT "so that the code is better"
- **Context paragraph:** One paragraph explaining why this story matters (not vague)
- **Each "As Proven by":** 
  - Starts with a verb: "API returns", "database shows", "page renders", "user sees", "endpoint accepts"
  - Is verifiable (pass/fail test, not a goal)
  - Is testable (a dev can write a test for it)
  - Is observable (user or operator can see it)
  - Does NOT contain "and" (split into separate criteria)

**Example:**

```
## As a portfolio owner, I wish to reset a portfolio model, so that I can start a different adoption flow

A portfolio owner sometimes changes their mind mid-adoption. They need to clear the current model state and begin again without deleting the portfolio itself. This is a dev gadmin operation that requires clearing adoption state safely.

## Acceptance Criteria

- **As Proven by X:** API endpoint `DELETE /api/portfolios/:id/model` accepts gadmin bearer token and returns 200 with `{ model: null }`
- **As Proven by Y:** Calling the endpoint clears all adoption state (layers, workflows, transitions, artifacts, terminology) from the database
- **As Proven by Z:** The portfolio-model page reloads and shows "No model adopted" with the adoption wizard available again
```

---

## Estimation & Risk Decision Matrix

**Use this to assign EST (Fibonacci) and RISK labels:**

### EST Assignment (Fibonacci: F0–F13)

- **F0** (spike/investigation): No actual implementation; research task only
  - Example: "Investigate GraphQL performance on large datasets"

- **F1** (1–2 hours): Single file, single layer, simple CRUD
  - Example: "Add a new debug toggle to dev-mode UI"

- **F2** (1–2 hours): Two files, single layer, minor logic
  - Example: "Add a CSS variable to theme system"

- **F3** (2–4 hours): 3–4 files, single or dual layer, moderate logic
  - Example: "Add validation to a form"

- **F5** (4–8 hours): Multiple files, 2–3 layers, clear pattern
  - Example: "New API endpoint + database migration + test"

- **F8** (1–2 days): 5+ files, 3+ layers, refactor or integration
  - Example: "Implement role-based page gating across 10 pages"

- **F13** (2–3 days): Full feature across backend + frontend + DB
  - Example: "Portfolio model adoption saga (wizard + orchestration + state)"

- **F21+ (SPLIT REQUIRED):** Exceeds complexity threshold
  - Example: "Build entire library release channel" → split into:
    - `F8 — LIB0001: Create release severity enum + gating logic`
    - `F5 — LIB0002: Build release reconciler`
    - `F5 — LIB0003: Add audience targeting to gates`

### RISK Assignment

- **RISK-LOW** (green): Isolated file(s), proven pattern, minimal dependencies, well-tested approach
  - Example: "Add new CSS breakpoint to responsive grid"
  - Example: "Add a new enum value to existing type"

- **RISK-MED** (yellow): Some unknowns, moderate dependencies, integration with existing code, new pattern in isolation
  - Example: "New API endpoint that touches existing DB tables"
  - Example: "Implement state machine for item transitions"

- **RISK-HIGH** (red): Novel architecture, major dependencies, schema changes, cross-system impact, potential for breakage
  - Example: "Redesign portfolio adoption orchestration"
  - Example: "Add migration for new polymorphic FK pattern"
  - Example: "Refactor backend secrets handling"

---

## Confidence Gate (85%+ rule)

**Before a story exits plan mode and goes to the backlog, `<stories>` MUST assert 85%+ confidence on:**

1. **Clarity:** The user story description is unambiguous. A dev reading it knows exactly what to build. (85%+ confidence)
2. **Completeness:** All acceptance criteria are present, verifiable, and sufficient to define "done". (85%+ confidence)
3. **Estimation:** The Fibonacci estimate (F0–F13) is realistic given scope and available information. (85%+ confidence)
4. **Risk:** The risk level (LOW/MED/HIGH) is appropriate for the work. (85%+ confidence)
5. **Dependencies:** No blocking dependencies on other cards in the batch. (85%+ confidence)

**Confidence assessment checklist (for `<stories>` to apply):**

- [ ] Title is specific, not generic ("refactor", "improve", "fix" are red flags)
- [ ] Role in "As a" is a real persona (not "system", "backend", "user")
- [ ] Action in "I wish" is concrete (not "support", "enable", "handle")
- [ ] Benefit in "so that" is observable (not "better", "cleaner", "easier")
- [ ] Context paragraph explains why (not just what)
- [ ] Each "As Proven by" uses observable verb: "returns", "shows", "renders", "accepts", "displays"
- [ ] No "and" in acceptance criteria (each criterion is atomic)
- [ ] Minimum 3 acceptance criteria present and unambiguous
- [ ] EST assigned (F0–F13; if F21+, story is split automatically)
- [ ] RISK assigned (LOW, MED, or HIGH; justified in brief comment if needed)
- [ ] Feature area assigned (one of: POR, LIB, ITM, DAT, UI, UX, SEC, GOV, AUD, RED, RUL, API, SQL, DCR, ALG, DEV)
- [ ] Phase assigned (PH-NNNN)
- [ ] No blocking dependencies on sibling stories in this batch

**If confidence < 85% on ANY criterion:**
- `<stories>` DOES NOT create the card.
- Skill outputs: `⚠ Story N: [REPLAN REQUIRED]` + specific reason.
- User is asked to clarify, revise, or split the story.
- Revised story (or split stories) are re-submitted to `<stories>` for reassessment.

---

## Replanning Trigger (Split Logic)

### During Planning (EST >= F21)

If `<stories>` calculates an estimate of **F21 or higher**, the skill MUST:
1. **Stop** and refuse to create the card.
2. **Analyze** the story to identify natural split points.
3. **Propose** a breakdown into smaller stories (each F13 or lower).
4. **Show the proposed story list** to the user for approval.
5. **Do NOT report** the split process — just present the final list.

**Example split (no intermediate reporting):**

User submits: "Implement entire portfolio model adoption system"
Estimated: F21 (exceeds limit)

`<stories>` output:
```
Story exceeds F13 complexity limit. Proposed breakdown:

1. Backend: archive old portfolio layers before adopting new model
   EST: F3, RISK: MED, Area: SQL
   AC: <acceptance criteria>

2. Backend: unadopt portfolio model from dev setup
   EST: F5, RISK: MED, Area: API
   AC: <acceptance criteria>

3. Frontend: portfolio adoption wizard (7-step flow)
   EST: F8, RISK: HIGH, Area: UI
   AC: <acceptance criteria>

4. Dev doc: portfolio model adoption action paths
   EST: F2, RISK: LOW, Area: DEV
   AC: <acceptance criteria>

Approve all 4, or revise? [y/n]
```

### During Development (Confidence Drops Below 90%)

If at ANY POINT during work the team discovers:
- Acceptance criteria are unachievable or ambiguous
- EST was significantly underestimated (e.g., F5 → looks like F8)
- A blocking dependency was hidden (can't land without story N)
- The story should have been split differently
- RISK was underestimated (e.g., RISK-LOW → actually RISK-HIGH)

**Action:**
1. `<stories>` STOPS and re-assesses the story.
2. If the fix is minor (rewording AC, clarifying description): update description, card returns to same state.
3. If the issue requires scope change or split:
   - Skill proposes a revised story list (like planning split above)
   - User approves the revision
   - Original card is updated OR new cards are created for split work
   - Cards return to Backlog for re-evaluation

**No automatic moves.** The skill stops, reassesses, and asks the user to confirm the replan before proceeding.

---

## Hard Rules (No Exceptions)

1. **All 7 attributes required:** ID + Title, AIGEN label, Phase label, Feature label, EST label (F0–F13), RISK label (LOW/MED/HIGH), Description (user story + AC format)
2. **EST must be Fibonacci (F0–F13).** If calculated as F21+, split automatically (show proposed breakdown, don't report the process).
3. **85%+ clarity before backlog.** If any gate < 85%, story is not created; user revises and resubmits.
4. **RISK is a gate.** Every card carries RISK-LOW, RISK-MED, or RISK-HIGH; missing RISK = card doesn't exit plan mode.
5. **User story format is mandatory.** "As a <role>, I wish <action>, so that <benefit>" — no tech jargon, no system-level roles.
6. **Acceptance criteria must be verifiable.** Each "As Proven by" is a pass/fail test, not a vague goal.
7. **No cards >= F21.** If a story scores that high, it is split before creation (user sees proposed breakdown only).
8. **Replanning stops work.** If confidence drops < 90% during development, card halts; replan is reassessed and user approves revision.
9. **No silent splits.** During planning, if a split is needed, propose it clearly. During development, if a replan is needed, pause and ask.
