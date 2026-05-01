---
name: Planka PATCH listId requires position field
description: Moving cards between lists via PATCH silently fails without position parameter
type: feedback
originSessionId: eb9596cd-e90d-4375-94e7-4cb506cb339a
---
**Rule:** When moving a card to a different list via `PATCH /api/cards/:id`, the `position` field is mandatory. Without it, the endpoint returns 200 but does not move the card.

**Why:** Planka's card ordering is position-based (not insertion order). Any list mutation requires specifying where in that list the card should land. The API doesn't auto-assign a default position; it silently ignores the `listId` change if `position` is omitted.

**How to apply:** Every card move MUST include both fields:
```bash
curl -s -X PATCH "http://localhost:3333/api/cards/$CARD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"listId":"'$TARGET_LIST'","position":65536}'
```

The position can be a placeholder (65536, 131072, etc.) to land at the end of the target list. When you need a specific position (e.g., first card in a list), inspect existing cards in that list and pick a lower position value.

**Discovered during:** 00031–00049 storify run. Agent moved 19 cards in batch at the end; initial per-card moves silently failed until `position` was added to the PATCH payload.
