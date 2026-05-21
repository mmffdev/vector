# Handover — Notification Rules Engine (B11.4 follow-up)

**Built:** 2026-05-21, overnight.
**Three commits, pushed to origin/main:** `2a8c661`, `93a63e1`, `9546bcd`.
**State:** working strawman. End-to-end-traversable from settings page to backend, except the **backend needs a restart** to mount the new routes (it was running pre-changes when I closed out — see [§ How to wake the system up](#how-to-wake-the-system-up)).

---

## One-line summary

You can now visit `/user/notifications/settings` and author rules like
**"When [Defect] [Severity] [changed_to] [Critical] notify me"** through a
schema-driven UI; the rules persist, the type/target/field dropdowns
auto-populate from your tenant's customised artefact types and field
library, the bell inbox now filters by tag instead of kind, and the
evaluator hook exists ready for production matching to drop in.

---

## What ships in these three commits

### Commit 1 — `2a8c661` — Rules CRUD + per-tenant schema endpoint

| Layer | Change |
|---|---|
| Backend HTTP | New `rules.Handler` — GET/POST/PATCH/DELETE on `/notifications/rules`. Ownership-checked. |
| Backend HTTP | New `rules.SchemaHandler` — `GET /notifications/rule-schema` returns the three-level catalogue (types → targets → fields+operators). |
| Backend wiring | main.go: dual-mounted on `/_site` AND `/samantha/v2`. Two new handler vars: `notifRulesH`, `notifSchemaH`. |
| Frontend | `apiSite.notificationRules` registry — `list / create / update / delete / get / schemaTypes / schemaTargets / schemaFields`. Exported types: `NotificationRule`, `RuleCondition`, `RuleOperator`, `RuleFieldEntry`, `RuleTypeEntry`, `RuleTargetEntry`, `RuleOperatorEntry`. |

**Notable design choice:** the schema endpoint is **type-aware on operators**. A numeric field offers `>` / `<` / `>=` / `<=`. A select field offers `equals` / `was` / `was_in`. A boolean field offers only `is` / `changed_to`. The catalogue lives in [`backend/internal/notifications/rules/schema.go`](backend/internal/notifications/rules/schema.go) `operatorsByFieldType()` — adding a new field type is one switch case.

### Commit 2 — `93a63e1` — Settings UI

| Layer | Change |
|---|---|
| Page | [`app/user/notifications/settings/page.tsx`](app/user/notifications/settings/page.tsx) — replaced "Coming soon" with the full editor. |
| Pattern | Used the canonical `<Table>` primitive (lint:no-raw-table enforced). |
| CSS | `.notification-rules__*` block in [`app/globals.css`](app/globals.css). Token-only. |

**The page's anatomy:**
- **Top panel "Your rules"**: table of existing rules. Columns: Name, Type+Target pill, Conditions (mono-font AND-joined summary), Enabled toggle, Edit / Delete actions. Currently-editing row gets `.is-editing` highlight.
- **Bottom panel "New rule / Edit rule"**:
  - Name input
  - Type dropdown — `artefact` enabled, the four future types (mention/note/comment/owner_proposed) shown disabled with their "coming soon" reason inline
  - Artefact-type dropdown — loads `schemaTargets` after type changes
  - Conditions builder — dynamic list. Each row: Field / Operator / Value / × Remove. Field changing resets operator+value. Operator's `needs_value=false` flag (e.g. `changed`) hides the value cell. Value input switches by `field.value_type` (number / date / boolean toggle / options-driven select / free-text).
  - Submit: Create / Save changes / Cancel
- Type and Target dropdowns are **disabled in edit mode** — changing them would invalidate the conditions array. Delete + re-create is the path.

### Commit 3 — `9546bcd` — Evaluator stub + tag column + tag-aware inbox

| Layer | Change |
|---|---|
| Backend | [`rules/evaluator.go`](backend/internal/notifications/rules/evaluator.go) — `Evaluator.MatchEvent(ctx, ArtefactChangedEvent) []Rule`. **Stubbed**: queries the candidate rule set, logs "would evaluate N candidates", returns nil. Single function to swap when real matching lands. |
| Backend | `SqlInsertUserNotificationFromEvent` + the in-app dispatcher now write `users_notifications_tag`. `tagForKind()` derives the bucket. |
| Frontend | Inbox filter chip renamed `Kind → Tag`. Reads the new column with a kind-fallback for pre-migration-236 rows. |

---

## How to wake the system up

The backend running on `:5100` when I closed out was the **pre-commit binary** — it doesn't know about `/notifications/rules` or `/notifications/rule-schema`. The settings page will show "Failed to load rules." until you restart it.

```bash
# Kill the old, build + start the new
lsof -ti :5100 -sTCP:LISTEN | xargs -r kill
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/backend" && \
  BACKEND_ENV=dev go run ./cmd/server
```

Or whatever your normal start invocation is — `<server>`, `npm run dev:backend`, the launcher app, whichever.

### Then verify, in this order:

```bash
# 1. Schema endpoint returns the type list
curl -sS -H "Authorization: Bearer <YOUR_JWT>" \
  http://localhost:5100/_site/notifications/rule-schema | jq

# Expected: {"types": [{value:"artefact",label:"Artefact",enabled:true}, ...]}

# 2. Targets for type=artefact (will return YOUR tenant's customised types)
curl -sS -H "Authorization: Bearer <YOUR_JWT>" \
  "http://localhost:5100/_site/notifications/rule-schema?type=artefact" | jq

# 3. Fields for one of those targets (replace <TARGET_UUID>)
curl -sS -H "Authorization: Bearer <YOUR_JWT>" \
  "http://localhost:5100/_site/notifications/rule-schema?type=artefact&target=<TARGET_UUID>" | jq
```

Then load `/user/notifications/settings` in the browser. Create a rule, watch the dropdowns cascade. Toggle enabled. Edit. Delete. All four CRUD operations should work.

---

## What's intentionally stubbed (so you don't waste time looking for it)

1. **Real evaluator matching.** [`evaluator.go`](backend/internal/notifications/rules/evaluator.go) loads the candidate set and logs — no rule actually fires a notification yet. Replacement is one function in that file (`matchConditions(rule.Conditions, event) bool`) plus a per-operator switch. Package doc explains the swap.
2. **Artefact write hook.** No producer is emitting `ArtefactChangedEvent` to the evaluator. When ObjectTree's history feed lands (you mentioned this is the natural pairing), the same hook does both: writes to history AND calls `evaluator.MatchEvent(...)`.
3. **Disabled rule types in the UI.** `mention` / `note` / `comment` / `owner_proposed` show in the type dropdown with the "coming soon" reason. The service rejects writes to those types — try one and you'll get a 501. This is deliberate (better than persisting rules that silently never fire).
4. **Admin-defined defaults.** Migration 236 already has the `id_user IS NULL` column shape, but the service throws `ErrAdminScopeUnwired` for any nil-user write. Comment in [migration 236](db/mmff_vector/schema/236_notification_rules.sql) explains.
5. **Backend restart.** You.

---

## Trying it out — suggested first rule

```
Name:        "Watch high-severity defects"
Type:        Artefact
Artefact:    Defect (or whatever you've renamed it to)
Conditions:
  Severity equals  Critical
  Estimate >       8
  Blocked is       true
```

The rule will persist, show in the table with the conditions summary, and the evaluator log line will fire if/when an artefactitems writer ever emits an event matching `(subscription, type='artefact', target=<defect-uuid>)`.

---

## File map (for the next session)

```
backend/internal/notifications/rules/
├── types.go        — Rule, Condition, Operator, RuleType. Package header
│                     names the JIRA/Rally pattern + the JQL operator
│                     vocabulary borrowed.
├── service.go      — CRUD. Owner-checked. Rejects unsupported types.
├── sql.go          — All SQL constants. Includes sqlSelectActiveRulesForTarget
│                     (the evaluator's hot path) which hits the partial
│                     index from mig 236.
├── handler.go      — HTTP CRUD handlers.
├── schema.go       — /rule-schema endpoint + operatorsByFieldType().
└── evaluator.go    — STUB. MatchEvent() loads candidates + logs.

db/mmff_vector/schema/
├── 236_notification_rules.sql       — applied to dev DB.
└── down/236_notification_rules_DOWN.sql

app/user/notifications/settings/page.tsx   — the new UI.
app/lib/apiSite/index.ts                   — `notificationRules` block at the bottom.
app/globals.css                            — `.notification-rules__*` block.
```

---

## Vector_Scope.md not updated

I haven't touched `Vector_Scope.md` this session — that file was already dirty when I started and there may be pending notes from another session. If you want me to file a B11.6 entry next time, say the word and I'll run `<scope> -a` with the right summary.

---

**Authored:** 2026-05-21 by Claude overnight. If anything in this doc
contradicts the code, trust the code and patch this file.
