# `<cookbook>` — harvest psql history into a staging draft

Scans `~/.psql_history` for queries run since the last harvest, filters out trivial ones, and writes novel queries to [`docs/c_sql_cookbook_staging.md`](../../docs/c_sql_cookbook_staging.md) for next-session curation.

**Pattern:** harvest → I read staging next session → write proper entries with **DB + pool + gotcha** → move to [`docs/c_sql_cookbook.md`](../../docs/c_sql_cookbook.md) → clear staging.

**Why staging, not direct append?** Raw psql history has typos, exploratory `\d` calls, and queries without context. A human/LLM pass turns each into a useful cookbook entry. Direct-append would pollute the main file with TODO placeholders.

---

## Syntax

```
<cookbook>            Harvest new psql queries into staging
<cookbook> -s         Show what would be harvested without writing (dry-run)
<cookbook> -r         Reset the last-harvest marker (re-scan everything)
<cookbook> -c         Curate: read staging, prompt me to convert each into a proper entry
```

---

## Harvest protocol (no flags or `-s`)

```bash
dev/scripts/cookbook_harvest.sh
```

The script:
1. Reads `~/.psql_history`
2. Skips lines before the marker at `~/.claude/cookbook_last_harvest` (timestamp + line count)
3. Filters trivial ones: pure `\d`, `\dt`, `\?`, `\q`, `SELECT 1`, `SELECT NOW()`, queries < 20 chars
4. De-dupes against staging file and main cookbook
5. Appends survivors to `docs/c_sql_cookbook_staging.md` with a timestamp header
6. Updates the marker

Dry-run mode (`-s`) prints what would be harvested without writing or updating the marker.

---

## Curate protocol (`-c`)

When I'm invoked with `<cookbook> -c`:

1. Read `docs/c_sql_cookbook_staging.md`
2. For each draft entry, ask Rick (or use context if obvious): **DB+pool? Use-case? Gotcha?**
3. Write the proper entry into the right section of [`docs/c_sql_cookbook.md`](../../docs/c_sql_cookbook.md) using the template at the top of that file
4. Remove the curated entry from staging
5. Report: "N curated, M skipped (trivial/duplicate), K remaining in staging"

If staging is empty, just say so and exit.

---

## When to run

- **End of a session** that involved real psql work — `<cookbook>` to capture, then `<cookbook> -c` if you want me to write proper entries now
- **Start of a session** — `<cookbook> -c` to clear any backlog before doing other work
- **After a debugging marathon** — single `<cookbook>` capture saves the trail for later curation

The discipline is still: prefer to cookbook **inline as I work** (per the [feedback_cookbooks](../memory/feedback_cookbooks.md) memory). This command is the **safety net** for the queries I forget to bank in the moment.

---

## Hard rules

- **Never harvest from worktrees.** Always run from the main repo so the staging file is in one place.
- **Never auto-curate without me.** Curation needs the gotcha line, which often needs Rick's input. Auto-fill = polluted cookbook.
- **Marker is per-machine, not in git.** `~/.claude/cookbook_last_harvest` is local state — different machines harvest independently.
