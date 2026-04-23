# Form drafts (IndexedDB autosave)

> Last verified: 2026-04-23
> Parent: [c_page-structure.md](c_page-structure.md)

IDB-backed autosave for forms that hold meaningful user input. The system has three parts: a store wrapper, a field classifier, and a React hook. A UI component (`DraftBanner`) offers explicit restore/discard.

## Key files

| File | Role |
|---|---|
| `app/lib/draftStore.ts` | IDB wrapper. DB `vector-drafts`, store `forms`, version 1. |
| `app/lib/draftClassifier.ts` | Pure classifier — default-deny on sensitive `autocomplete` tokens. |
| `app/hooks/useDraft.ts` | React hook. 500ms debounced save, schema-versioned payload. |
| `app/components/DraftBanner.tsx` | Restore / discard UI offered to the user. |
| `app/contexts/AuthContext.tsx` | Logout calls `purgeDraftsFor(userId)` to clear the departing user's drafts. |
| `e2e/drafts/classifier.spec.mjs` | 17 node:test specs covering the classifier (all passing). |

## IDB key structure

```
${userId}:${formKey}:${scopeKey ?? "_"}
```

Scoping by `userId` prevents one user's draft surfacing to another user on the same browser. `formKey` names the form (e.g. `create-custom-page`). `scopeKey` is optional — use it when the same form exists in multiple independent contexts (e.g. per-entity scope).

## DraftRecord shape

```ts
{
  formKey: string;
  scopeKey: string | null;
  values: T;
  savedAt: string;     // ISO timestamp
  userId: string;
  schemaVersion: number;  // currently 1 (DRAFT_SCHEMA_VERSION)
}
```

On read, the hook discards any record whose `schemaVersion` differs from the current constant or whose `userId` does not match the caller — defence against stale or cross-user records surviving in IDB.

## Field classifier

`classifyField(FieldShape): ClassifyResult` — pure, no DOM dependency. Default-deny:

- `type="password"` — excluded.
- `type="hidden"` — excluded.
- `autocomplete` token in the sensitive set — excluded. Sensitive tokens: `current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`, `cc-name`, `cc-given-name`, `cc-additional-name`, `cc-family-name`, `cc-type`.
- `data-no-draft` attribute present on the element — excluded.

Everything else is draftable. Classifies the whole `autocomplete` attribute as a space-separated token list — any one sensitive token disqualifies the field.

## Hook usage

```ts
const { save, clear, restored } = useDraft(
  { formKey: "create-custom-page", initial },
  (values) => setFormValues(values),   // called when user hits "Restore"
);
```

- `save(partial)` — debounced 500ms. Guards: no userId, no IDB, payload > 500 KB → silent no-op.
- `clear()` — call after a confirmed 2xx submit to remove the stale draft.
- `restored` — non-null if an eligible draft was found on mount; pass to `DraftBanner`.

## Logout purge

`AuthContext.logout` captures `user.id` before nulling the session, then calls `purgeDraftsFor(userId)`. This walks the IDB key-cursor and deletes every key with the `${userId}:` prefix. IDB failure is silently ignored (incognito / denied storage).

## Security posture

- Keys are scoped to `userId` — no cross-user draft access.
- Sensitive fields (passwords, OTP, card numbers) are excluded by the classifier's default-deny list.
- Logout triggers a full purge of the departing user's drafts.
- No draft data is sent to the server — IDB is local-only.
- `schemaVersion` check on read invalidates drafts from older schema iterations.

## Limitations / not yet covered

- No expiry TTL on drafts — a draft survives indefinitely until the user restores, discards, or logs out.
- No cross-tab synchronisation — concurrent tabs on the same form may clobber each other's draft.
- `data-no-draft` must be set by individual form authors; there is no global registry of excluded forms.
