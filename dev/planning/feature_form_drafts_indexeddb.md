# Feature — Form drafts via IndexedDB

Status: **proposal / not started.** Captures the design from the 2026-04-23 session.

Auto-save the contents of every non-trivial form to the user's browser as they type, so a tab crash, accidental navigation, session expiry, or laptop sleep doesn't lose what they were writing. Restoration is opt-in via a small banner — never silently overwrites a fresh form.

## Why we're considering it

- **Disappearing UX win.** The user never thinks about it until it saves them — and then they remember the product as one that "just works."
- **Zero server cost.** Drafts live on the user's device; no API calls, no DB writes, no schema, no quota for us.
- **Cheap to build.** A single `useDraft(formKey)` hook + a small `idb-keyval`-style wrapper. ~50 lines of real code.
- **Aligns with the storage-tier discipline.** Per the [Jira-style three-tier model](feature_event_audit_log.md#aws-build-checklist-reference-implementation), this is a textbook tier-3 (local browser, non-sensitive UX state) use case.

## What gets drafted

Forms that meet **all three** criteria:

1. The user is likely to spend >10 seconds filling it in.
2. Losing what they typed is annoying or worse.
3. The content is **not sensitive** (no passwords, no PII the user wouldn't want lingering on a shared device).

Concretely in Vector today:
- Create page (page name + initial body).
- Create work item (title + description + any structured fields).
- Edit work item description.
- Comments and replies on items / pages.
- Page body editor.
- Workspace / portfolio / product creation forms.
- Nav-prefs free-text fields (custom labels if/when we add them).

## What does NOT get drafted

| Field signature | Reason |
|---|---|
| `<input type="password">` | Credentials never go to local storage. |
| `<input autocomplete="cc-number" \| "cc-csc" \| "cc-exp">` | Payment fields. |
| `<input autocomplete="one-time-code">` | 2FA / OTP — by definition single-use, sensitive. |
| Any field with `data-no-draft` | Explicit opt-out for custom components. |
| Login / signup / password-reset forms entirely | Defence in depth — opt the whole route out, not just per-field. |
| Search inputs | Different lifecycle (recent-searches feature, not a draft). |

The hook walks the form once on mount, classifies each field, and skips the disqualified ones. Disqualification is per-field, not per-form, so a "comment with optional payment link" form would draft the comment but not the link.

## Design sketch

### Storage

- One IndexedDB database per origin: `vector-drafts`.
- One object store: `forms`, keyed by `formKey`.
- Value shape:
  ```json
  {
    "formKey": "page.create",
    "scopeKey": "workspace:abc-123",
    "values": { "name": "Q3 roadmap…", "body": "…" },
    "savedAt": "2026-04-23T14:31:02Z",
    "userId": "u-789",
    "schemaVersion": 1
  }
  ```
- `formKey` is a stable string the form declares (e.g. `page.create`, `item.edit`, `comment.reply`).
- `scopeKey` disambiguates multiple instances of the same form on different parents (e.g. one comment-reply draft per item).
- `userId` is recorded so a draft saved by user A is **not** restored if user B is later signed in on the same browser. (Belt-and-braces for shared devices.)

### Hook

```ts
const { values, save, clear, restored } = useDraft<MyForm>({
  formKey: 'page.create',
  scopeKey: workspaceId,
  initial: { name: '', body: '' },
});
```

- `save(partialValues)` — debounced 500ms.
- `clear()` — call on successful submit.
- `restored: { savedAt, dismiss, apply } | null` — if a draft exists, exposed to the form so it can render the restoration banner.

### UX

- **Saving is silent.** No toast, no spinner — it just happens.
- **Restoration is explicit.** When the form opens with a matching draft, render a small banner above the form:
  > Restored draft from 14 minutes ago. _[Discard]_
- Banner dismissal (or successful submission) clears the draft.
- If the user navigates away again without submitting, the new state overwrites the old draft — most-recent-wins.

### Lifecycle

| Event | Effect |
|---|---|
| User types | Debounced save to IDB (500ms after last keystroke). |
| Tab/browser closes | Last save persists (it's already on disk). |
| User reopens form | Hook reads IDB on mount; if a draft exists for `(formKey, scopeKey, currentUserId)`, expose it via `restored`. |
| User clicks Submit successfully | `clear()` deletes the draft. |
| User clicks Discard on banner | `clear()` deletes the draft. |
| User signs out | All drafts for that `userId` purged on logout (defence against shared devices). |
| Different user signs in | Their drafts are visible (scoped by `userId`); previous user's are not. |
| Storage pressure / browser eviction | Drafts may be lost — same as any cache. Acceptable. |
| `schemaVersion` mismatch | Old draft ignored on restore (don't try to migrate). |

## Implementation pattern — per-form opt-in, not magic

Drafting is **default-off, opt-in per form, with an explicit `formKey`**. Three patterns considered; (A) chosen.

### Option A — `useDraft` hook (chosen)
Every form that wants drafting adds 2-3 lines: import + hook call + restoration banner JSX.

```tsx
const { values, save, clear, restored } = useDraft({
  formKey: 'page.create',
  scopeKey: workspaceId,
  initial: { name: '', body: '' },
});
```

Pro: explicit; you can grep for `useDraft` and see exactly which forms persist. Con: every form needs a touch.

### Option B — `<DraftableForm>` wrapper component
Wraps a form, walks children to classify inputs, wires drafting invisibly. Saves boilerplate but only really helps uncontrolled forms; React-controlled inputs still need to know about it. Net win is smaller than it looks.

**Defer** — extract a shared `<DraftBanner restored={restored} />` after ~5 forms have it; that captures 80% of the win without the wrapping complexity.

### Option C — Global `input` listener (rejected)
Document-level event listener that auto-saves any keystroke. **Wrong answer** because:
- Cannot distinguish form input from search bar from filter chip.
- Cannot tell when to clear (no submit semantics).
- Doesn't fit React's controlled-input data flow.
- **Security inversion** — default-on capture means the first time someone adds a sensitive field and forgets to mark it, you have a leak. Default-off opt-in is the correct posture.

### What's truly sitewide
Three pieces of shared infrastructure, written once:
- IDB wrapper (~30 lines, or a thin layer over `idb-keyval`).
- Field classifier (walks `type` + `autocomplete` + `data-no-draft`).
- Logout hook that purges all drafts for the signing-out user.

Per-form cost: ~5 lines × ~30 forms = ~150 lines across the product. Modest.

## Clear-on-submit semantics

The trigger is **"server confirmed the write succeeded,"** not "user clicked Submit." This distinction prevents the worst-case state (user lost work, form empty, error showing).

```ts
async function handleSubmit(values) {
  try {
    const result = await api.createPage(values);
    clear();              // ← only after the server confirms
    router.push(result.url);
  } catch (err) {
    // draft stays — user retries without retyping
    showError(err);
  }
}
```

| Submit outcome | Draft state |
|---|---|
| Server returns 2xx | Cleared. Data is durably on the server. |
| Server returns 4xx (validation error) | **Kept.** User fixes and retries; draft is the safety net during the fix. |
| Server returns 5xx | **Kept.** Server bug, not user's fault. |
| Network error / timeout | **Kept.** |
| Browser crashes mid-submit | **Kept.** Reopens with draft intact. |
| User clicks Discard on the banner | Cleared immediately. |
| User signs out | All drafts for that user purged. |

**Edge cases:**

- **Multi-step forms.** Each step has its own `formKey` (e.g. `item.create.step1`). Stepping forward clears the previous step only after that step's data is committed — to the server, or merged into the next step's state. If the wizard is fully client-side until final submit, keep one draft keyed on the wizard's session ID.
- **Autosave-as-you-go forms** (e.g. notion-style page-body editor, if/when we have one). Drafts are redundant — the server is the source of truth on every change. Hook should no-op or be skipped for these forms. **Drafts are for forms that don't auto-persist; not for forms that do.**

## Phasing

- **Phase 0 — primitives.** `useDraft` hook + IDB wrapper (use `idb-keyval` to avoid hand-rolling the IDB API). Single test form behind a dev flag to validate the round-trip.
- **Phase 1 — first user-facing form.** Wire to "Create page" form (high-value, well-bounded). Banner UX shipped here.
- **Phase 2 — work-item forms.** Create item, edit item description, item comments. Each is a one-line addition once the hook exists.
- **Phase 3 — coverage.** Audit remaining forms; any that meet the "what gets drafted" criteria get the hook. Track in the technical-debt register if a form is intentionally skipped.
- **Phase 4 (only if needed) — cross-tab coordination.** If a user has the same form open in two tabs, the second tab should know the first tab is editing. Use `BroadcastChannel` to broadcast saves; if a tab receives a save it didn't originate, it shows a "this form is being edited in another tab" notice. Defer until reported.

## Open decisions

- **Quota awareness.** Do we proactively prune drafts older than N days, or wait for browser eviction? Probably prune at 30 days on app boot — cheap, keeps the store small, removes drafts the user has clearly abandoned.
- **Save cadence.** 500ms debounce feels right; revisit if it produces visible jank on slow devices.
- **Banner copy.** "Restored draft from 14 minutes ago" vs "You have an unsaved draft" — UX call.
- **Should the banner show a preview of the drafted content?** Probably not for the first cut — adds visual weight, slows the form open, edge cases with rich-text.
- **Multi-instance forms** (e.g. multiple comment-reply boxes open at once on a long thread): does each get its own `scopeKey`, or do we draft only the focused one? Lean towards per-comment scope (each reply box has the parent comment ID as scope).

## Risk register

- **S2 — sensitive data leaks into draft via misclassification.** A new custom field component that secretly takes payment details, missed by the field-classifier walk. Mitigation: explicit allowlist of `autocomplete` values that are safe; default-deny for any field with an `autocomplete` attribute we don't recognise; `data-no-draft` opt-out documented in the component-authoring guide. Trigger: any new form component.
- **S2 — shared-device leak between users.** User A drafts a comment, signs out without submitting; user B signs in on the same browser, opens the same form, sees user A's draft. Mitigation: drafts keyed by `userId`; logout purges all drafts for that user. Trigger: Phase 0.
- **S2 — schema drift on form fields.** Field renamed from `description` to `body`; old draft's keys no longer match. Mitigation: `schemaVersion` per `formKey`; bump on any field rename; old drafts silently ignored. Trigger: any form refactor.
- **S3 — IDB unavailable in private/incognito mode** (some browsers cap aggressively or disable). Mitigation: hook degrades gracefully — if IDB fails, no drafting, no errors thrown to user. Trigger: never; just don't make IDB writes load-bearing.
- **S3 — quota exhaustion from very long forms** (rich-text with embedded images base64'd in). Mitigation: cap per-draft size at e.g. 500 KB; oversized drafts skip the save and warn in console. Trigger: rich-text editor work.
- **S3 — restoration confuses users** ("why is there text here?"). Mitigation: explicit banner with clear Discard, never silently fill. Trigger: Phase 1 user testing.

## Pointers

- IndexedDB tier rationale: [`feature_event_audit_log.md`](feature_event_audit_log.md) — three-tier storage discipline (RDBMS / object storage / browser local).
- Hook author's reference for IndexedDB API ergonomics: [`idb-keyval`](https://github.com/jakearchibald/idb-keyval) — pick this or write a 30-line equivalent.
- Field-classification reference: HTML `autocomplete` token list (WHATWG spec) — the `cc-*`, `one-time-code`, and `current-password` / `new-password` tokens are the load-bearing ones.
