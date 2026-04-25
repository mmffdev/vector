---
name: Storify all layers before starting
description: When creating backlog stories, decompose across all layers — never storify only the backend or frontend half of a feature
type: feedback
originSessionId: 421fcf55-eca4-4ec4-8e12-4a283071d470
---
Before calling /storify, decompose the full feature across all layers (backend, frontend, migration, tests). A feature is not complete until every observable layer has a card.

**Why:** In the Phase 3 gap-close session, only the two backend stories were storified. The frontend gate (blocking modal on has_blocking) was left implicit and had to be added retroactively after the backend work was already completed.

**How to apply:** When identifying stories, explicitly ask "is there a frontend half? a migration? tests?" before presenting the approval list to the user. If yes, include those cards in the same batch.
