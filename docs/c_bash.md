# Bash commands — golden source

> Last verified: 2026-04-21

Only commands that have actually been run on this machine. If you can't point at a verified run, it belongs in scratch, not here.

## Rules

1. **Quote paths with spaces.** The repo root is `"/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM"` — unquoted breaks word-split.
2. **Absolute paths preferred** over `cd`. Keeps pwd stable across multi-step runs.
3. **No `| xargs`** — word-splits. Use `read -r f; …` from a single-value pipeline, or a `while read` loop.
4. **Use `pg_dump` at `/opt/homebrew/opt/libpq/bin/pg_dump`** — libpq is keg-only on macOS; not on PATH.

## Domain leaves

| Domain | Leaf | What's inside |
|---|---|---|
| Git operations | [c_c_bash_git.md](c_c_bash_git.md) | `git rev-parse`, `git push`, `git describe`, `git log --since` |
| Postgres ops | [c_c_bash_postgres.md](c_c_bash_postgres.md) | `pg_dump`, `psql` round-trip, `docker exec` fallback |
| SSH ops | [c_c_bash_ssh.md](c_c_bash_ssh.md) | tunnel start (`ssh -N -f`), tunnel health check (`nc -z`) |

## Things you might reach for but shouldn't

- **`find` / `cat` / `grep`** — use `Glob`, `Read`, `Grep` tools instead; faster and sandbox-friendly.
- **`mkdir -p` + `> file`** for new files — use the `Write` tool; it handles spaces-in-path cleanly.
- **`sed -i` in-place** — use `Edit`; `sed` on macOS needs `-i ''` which trips up cross-platform scripts.
