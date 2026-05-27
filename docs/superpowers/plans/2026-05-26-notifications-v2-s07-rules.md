# S07 — Rules engine (real matchConditions) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox steps.

**Goal:** Land `v2/rules/` package — real rule-evaluation engine. CRUD over `notifications_rules_v2`. Evaluator that loads candidate rules for an event and matches conditions against the event payload (JSON-path field access, operators eq/neq/gte/lte/in/contains/exists, AND/OR logical_op).

**Story estimate:** 8

**Wave:** 2 — parallel-safe with S02, S03, S05, S08

**Branch:** `notif-v2-s07`

---

## Read first (REQUIRED)

1. **Spec sections:**
   - "Interfaces" / "Architecture" → `v2/rules/` package (service, evaluator, operators)
   - "End-to-end flow" → step 3b FILTER (rules engine is invoked during filter)
   - Locked decisions: `logical_op` AND/OR, conditions as jsonb array of `{field, op, value}`, rules can override channels/priority/template/schedule
   - "Data model" → `notifications_rules_v2` DDL (mig 128 — already applied)

2. **v1 reference (read-only, no import):** `backend/internal/notifications/rules/{service.go,evaluator.go,types.go}` — v1 has a stub evaluator that returns true. v2 must REPLACE this with real condition matching.

3. **Domain types from S02 (cross-story dep):** `v2/domain/event.go` — `Event.Data map[string]any` is what conditions evaluate against. Import this.

4. **HARD RULES:** strangler-fig, inspect-index, explicit-path.

---

## File structure

| File | Purpose |
|---|---|
| `backend/internal/notifications/v2/rules/types.go` | `Rule`, `Condition`, `LogicalOp`, `Operator` types; sentinel errors |
| `backend/internal/notifications/v2/rules/operators.go` | Eight pure functions, one per operator: `opEq`, `opNeq`, `opGte`, `opLte`, `opIn`, `opContains`, `opExists`, `opNotExists`. Each takes `(actual any, expected any) (bool, error)` |
| `backend/internal/notifications/v2/rules/operators_test.go` | Table-driven unit tests for each operator (incl. type-mismatch handling) |
| `backend/internal/notifications/v2/rules/evaluator.go` | `Evaluator` interface + impl. `MatchEvent(ctx, event) ([]Rule, error)` loads candidate rules and returns the subset that match |
| `backend/internal/notifications/v2/rules/evaluator_test.go` | Integration tests (real DB seeded with rules + synthetic events) |
| `backend/internal/notifications/v2/rules/service.go` | CRUD: Create / Get / Update / Delete / List. Used by handler in S11; not exposed to pipeline (pipeline reads via Evaluator) |
| `backend/internal/notifications/v2/rules/service_test.go` | Integration tests for CRUD |
| `backend/internal/notifications/v2/rules/jsonpath.go` | `GetField(data map[string]any, path string) (any, bool)` — dot-path lookup (e.g. "data.invoice.amount") |
| `backend/internal/notifications/v2/rules/jsonpath_test.go` | Unit tests for the path lookup |

---

## Tasks

### Task 1 — Worktree confirm

- [ ] **1.1** `git branch --show-current` → `notif-v2-s07`

### Task 2 — `types.go` + `jsonpath.go`

- [ ] **2.1** `Operator` type with 8 const values (`OpEq`, `OpNeq`, `OpGte`, `OpLte`, `OpIn`, `OpContains`, `OpExists`, `OpNotExists`). `LogicalOp` ("AND"|"OR"). `Condition struct { Field, Op, Value }`. `Rule struct` matching mig 128 columns.

- [ ] **2.2** Sentinel errors: `ErrFieldMissing`, `ErrTypeMismatch`, `ErrUnknownOperator`, `ErrInvalidValue`.

- [ ] **2.3** `jsonpath.go` `GetField(data, "data.invoice.amount") (any, bool)`:
  - Split path on `.`
  - Walk the map, treating each segment as a key
  - On final segment, return value
  - Missing key → `(nil, false)`
  - Non-map at intermediate → `(nil, false)`

- [ ] **2.4** `jsonpath_test.go` table-driven: flat keys, nested, missing, type-mismatch.

- [ ] **2.5** Commit each in own commit.

### Task 3 — `operators.go` + tests

- [ ] **3.1** Each operator is a function: `func opEq(actual any, expected any) (bool, error)`.

  - `opEq`: deep-equal via `reflect.DeepEqual` for non-numeric, special-case numeric coercion (int/float64 — both common from JSON unmarshal). Spec example `"data.amount": { "gte": 100 }` — JSON 100 unmarshals as `float64`; SQL/Go side might pass `int`. Coerce.
  - `opNeq`: !opEq.
  - `opGte`, `opLte`: numeric only. Return `ErrTypeMismatch` if either side non-numeric.
  - `opIn`: expected must be a slice/array; return true if `actual` equals any element.
  - `opContains`: string contains substring; OR slice contains element. Type-dispatch.
  - `opExists`: actual is anything non-nil → true. Bool expected value irrelevant — `Exists` is a presence check.
  - `opNotExists`: actual is nil → true.

- [ ] **3.2** Table-driven tests covering each operator: positive case, negative case, type-mismatch case, edge cases (empty string, zero number, empty slice).

- [ ] **3.3** Run, commit.

### Task 4 — `evaluator.go` + tests

- [ ] **4.1** `Evaluator` interface:
  ```go
  type Evaluator interface {
      // MatchEvent loads candidate rules for (subscription_id, event_type, enabled=true)
      // and returns the subset whose conditions match the event.
      MatchEvent(ctx context.Context, event domain.Event) ([]Rule, error)
  }
  ```

- [ ] **4.2** `pgEvaluator` impl:
  - Query candidate rules from `notifications_rules_v2` WHERE subscription_id = event.SubscriptionID AND event_type = event.Type.String() AND enabled = true
  - For each rule, parse `conditions` jsonb into `[]Condition`
  - Run match: for each Condition, `GetField(event.Data, cond.Field)` → look up actual; dispatch on `cond.Op` to the right operator; collect results
  - Combine with `rule.LogicalOp` ("AND" → all true; "OR" → any true)
  - Return rules where match=true

- [ ] **4.3** Edge cases worth testing:
  - Empty conditions array + AND → match (vacuously true)
  - Empty conditions array + OR → no-match (vacuously false; document the choice in a comment)
  - Field missing → operator handles per its semantics (`opExists` returns false → fine; `opEq` returns error → suppress the rule and log debug)
  - Suppress vs error: an evaluation error on ONE rule should NOT crash the whole MatchEvent call. Log + skip that rule, continue.

- [ ] **4.4** Integration test seeded with 3-4 rules + synthetic event; assert correct subset matched.

- [ ] **4.5** Commit.

### Task 5 — `service.go` (CRUD) + tests

- [ ] **5.1** `Service` interface: `Create(ctx, rule) (Rule, error)`, `Get(ctx, id) (Rule, error)`, `Update(ctx, id, patch) (Rule, error)`, `Delete(ctx, id) error`, `List(ctx, filter) ([]Rule, error)`.

- [ ] **5.2** Filter struct: `{ SubscriptionID, WorkspaceID, UserID, EventType, EnabledOnly bool }`. Build a parameterised SQL query against `notifications_rules_v2`.

- [ ] **5.3** Validation on Create/Update:
  - `name` 1..100 chars
  - `event_type` parses via `domain.ParseEventType`
  - `logical_op` ∈ {AND, OR}
  - `conditions` jsonb shape: array of objects with field/op/value
  - `channels` jsonb shape: array of strings, each is a known `domain.Channel`
  - `priority_override` if set must be a valid Priority
  - `schedule` ∈ {immediate, next_quiet_hours_end, digest}

- [ ] **5.4** Integration tests for CRUD + filter combinations.

- [ ] **5.5** Commit.

### Task 6 — Lint discipline

- [ ] **6.1** New lint: `lint:no-stub-evaluator` — fails if `evaluator.go` still contains the v1 stub pattern `return true, nil // stub`. Implement as a simple grep against `backend/internal/notifications/v2/rules/evaluator.go` looking for `// stub` markers + the `return true` shortcut.

- [ ] **6.2** Wire into the lint runner. Add ledger entry to `docs/c_c_lint_rules.md`.

- [ ] **6.3** Commit.

### Task 7 — Final verification

Standard.

### Task 8 — Report

```
S07 WORKER — STATUS: READY FOR VALIDATION
Branch: notif-v2-s07
Files: types.go, jsonpath.go, operators.go (+tests), evaluator.go (+tests), service.go (+tests)
Commits: ~7-8
Operators implemented: 8 (eq/neq/gte/lte/in/contains/exists/not_exists)
Logical ops: AND + OR
JSON-path: dot-path resolver for nested data
Lints landed: lint:no-stub-evaluator
v1 evaluator stub status: NOT IMPORTED, NOT TOUCHED (v1 still has its stub; v2 evaluator is independent)
```

---

## Definition of Done

1. 8 files exist under `backend/internal/notifications/v2/rules/`
2. All 8 operators implemented + tested
3. Build + vet clean; all tests PASS
4. `lint:no-stub-evaluator` PASS
5. No imports from v1 notifications package
6. Validator PASS verdict
7. Branch merged by Validator

---

## Risks

| Risk | Mitigation |
|---|---|
| JSON numeric coercion (int vs float64) | Test explicitly; standard pattern is `reflect.ValueOf(x).Convert(reflect.TypeOf(float64(0))).Float()` for any numeric. Reject non-numerics in opGte/opLte |
| Rule loading N+1 on every event | One query per event_type per subscription is fine for v1. Cache later if needed (TD entry) |
| OR vs AND with empty conditions | Document the choice (AND=vacuously true, OR=vacuously false) in a comment AND assert in tests |
| Conditions jsonb shape validation | Reject malformed shapes at Create/Update; never at evaluate time. The DB jsonb type doesn't enforce structure — validation is Go-side |
| Field path ambiguity (e.g. dots in keys) | spec hasn't called this out; punt: keys are alphanumeric+underscore. If a key has a dot, that's not supported. Document in operator-doc |
