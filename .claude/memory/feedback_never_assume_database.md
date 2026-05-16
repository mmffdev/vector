---
name: feedback-never-assume-database
description: HARD RULE — never assume which database a feature lives in; always read the backend wiring first and verify the pool→DB mapping before any psql query
metadata:
  type: feedback
---

**Never assume a database.** Ever. Before any `psql` query, schema lookup, or "the table is probably called X" statement, you MUST trace the backend wiring to confirm which pool serves the feature, and which DB that pool connects to.

**Why:** On 2026-05-13 Claude blindly ran psql against `mmff_vector` looking for the `artefact_types` table because that DB was the most recently referenced in conversation context. The table actually lives in `vector_artefacts`. Claude then rationalised the wrong-DB query results ("`obj_strategy_types` exists, looks plausible") and went down a rabbit hole drafting an icon-picker plan against the wrong schema. The user shut it down with: *"we dont use the mmff_vector db, why did you think we do?"*

**How to apply (before ANY DB lookup):**

1. **Find the handler.** `grep -rn '<route>' backend/internal/` or look up the handler file directly.
2. **Read `backend/cmd/server/main.go`** for the `NewService(...)` call. Note which pool it takes: `pool` (mmff_vector), `vaPool` (vector_artefacts), or `libPool` (mmff_library).
3. **Cross-check against [`docs/c_c_db_routing.md`](../../../docs/c_c_db_routing.md)** — the canonical map of every service → pool → DB → tables.
4. **Only then** open psql, and use the correct `-d <dbname>` flag.

**Never write "the table is probably X" or "let me check `mmff_vector` first" without doing steps 1–3.** If a fact must be verified live, the verification path is: handler → main.go pool → routing doc → psql with the right DB.

This rule cannot be overridden by prior session context, conversation summaries, or "the connection string was right there." Connection strings prove a pool exists, not which one serves the feature you're working on.

**Conversational replies are not exempt.** On 2026-05-13 Claude was asked to explain a deferred follow-up ("3 DB-seeded default groups") and said "a migration on `mmff_vector`" without tracing. The user shut it down: *"mmff_vector again we dont use this fucking table you just wrote a rule to stop you from touching it"*. The trace would have shown `user_nav_groups` is owned by `nav.New(pool, …)` at main.go:179 (which DOES point at mmff_vector) — so the destination was actually correct, but **claiming it without verifying is the violation**. Even when describing existing schema in chat, name the DB only after the handler → main.go → routing-doc trace. If you haven't traced yet, say "I'd need to check which DB" — never name one.

Linked: [[reference-db-routing-doc]]
