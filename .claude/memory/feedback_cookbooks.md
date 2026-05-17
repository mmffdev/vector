---
name: feedback-cookbooks
description: Append non-trivial SQL queries to c_sql_cookbook.md and non-trivial bash commands to c_bash_cookbook.md before moving on — stop re-deriving the same thing every session.
metadata:
  type: feedback
---

After any **non-trivial** SQL query or bash command that worked, append it to the relevant cookbook **before moving on to the next step**:

- SQL → [`docs/c_sql_cookbook.md`](../../docs/c_sql_cookbook.md)
- Bash → [`docs/c_bash_cookbook.md`](../../docs/c_bash_cookbook.md)

**Why:** Rick and I keep re-deriving the same psql incantations, the same `BACKEND_ENV=dev go run ...` invocations, the same tunnel commands. Each re-derivation burns a turn and risks getting the gotcha wrong (wrong DB, wrong flag, wrong env). The cookbooks turn one-time discovery into permanent reference. Rick named the pattern on 2026-05-17 — "save every sql statement that works so you don't have to guess".

**How to apply:**

**Append when:**
- SQL: joins, soft-archive filters (`deleted_at IS NULL`), tenant scoping, JSONB digging, anything past `SELECT * FROM foo LIMIT 5`
- Bash: non-obvious flag, path, env var, or pipeline — the kind of command where future-me would guess wrong on the first try

**Skip when:**
- Trivial: `ls`, `cat`, `grep`, `\dt`, plain `git status`, `SELECT * FROM small_table`
- Exploratory one-offs that didn't actually answer anything

**Entry shape (both cookbooks):**
1. Question/purpose as the heading
2. **Use when:** one-line trigger
3. **Gotcha:** the thing that would bite next-time-me (this is the most valuable line — always fill it in)
4. The code block

**SQL entries additionally MUST name DB + pool** — that's the "Never assume a database" hard rule [[feedback-never-assume-database]] expressed as a per-query record.

**End-of-session check:** before declaring a working session done, glance back at the psql/bash tool calls — anything novel that worked but didn't get cookbooked? Append it now while context is fresh.

**Related:** [[feedback-never-assume-database]] (DB routing is part of every SQL entry), [[feedback-read-source-when-stuck]] (cookbook is a *complement* to reading source, not a replacement — if a cookbook entry stops working, read the source, then update the entry).
