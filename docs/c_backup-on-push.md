# Backup on push

> Last verified: 2026-04-21

Every push to remote auto-snapshots the database. Two channels, one downstream script, point-in-time recovery from any pushed commit.

## Why two channels

- **Channel A — git `pre-push` hook** fires on every push, regardless of who pushed (you, Claude, IDE, GUI).
- **Channel B — Claude Code `PreToolUse` hook** matches `git push` in the Bash tool. Fires only for Claude-initiated pushes; surfaces the backup result in-chat via `additionalContext`.

Both channels invoke the same script: `dev/scripts/backup-on-push.sh`. Single source of truth. SHA + time-window dedupe prevents double-dumping when Claude pushes (Channel B fires first, Channel A fires second, second call sees the log and skips).

## Artefact layout

```
local-assets/
  backups/
    <label>_<YYYYMMDD_HHMMSS>.sql    ← the dumps (gitignored)
    backup-log.jsonl                 ← append-only audit trail (gitignored)
    skip-warnings.log                ← rolling tail of skip reasons (gitignored)
```

## Label resolution

Uses `git describe --tags --exact-match <sha>` — if a tag points at the commit, the label is the tag name; otherwise it's the short SHA. Never parses `git push` argv for tag names (fragile and wrong when `git push --tags` fires after commits).

## Dedupe

If `backup-log.jsonl`'s most recent `status: "ok"` entry has the same SHA AND was written within the last 10 minutes, skip with `status: "deduped"`.

## Retention (applied after every successful backup)

- **Tagged backups** (label doesn't match short-SHA regex): kept forever.
- **SHA-labelled backups**: keep the 20 most recent, OR anything under 30 days old — whichever set is larger. Prune older SHA dumps.
- Set `SKIP_BACKUP_PRUNE=1` in env to skip retention (debug only).

## Opt-out (layered, cheapest first)

- **Per-push:** `SKIP_PUSH_BACKUP=1 git push …` → `status: "opt-out-env"`.
- **Per-commit:** HEAD commit message contains `[skip-backup]` → `status: "opt-out-commit-marker"`.
- **Long-term:** `.claude/no-push-backup` sentinel file → `status: "opt-out-sentinel"`.

## Failure handling

| Condition | Action |
|---|---|
| Tunnel down (`nc -z localhost 5434` fails) | Skip, log, stderr red banner, exit 0 |
| `pg_dump` non-zero exit | Skip, log with `skip_reason: "pg_dump_failed: <stderr tail>"`, exit 0 |
| Disk full | Skip, log, exit 0 |
| **Any** failure | **Never block `git push`.** |

## Visibility — every skip is loud

Silent skips are the failure mode. Every skip path MUST:

1. Append a JSONL entry with `status: "skipped"` and a `skip_reason`.
2. Print a red banner to stderr: `⚠ backup-on-push SKIPPED: <reason>. Run <backupsql> manually to recover.`
3. Append one line to `local-assets/backups/skip-warnings.log`.

Channel B emits the banner via `hookSpecificOutput.additionalContext` so Claude surfaces it in-chat. Channel A emits directly to the terminal the user pushed from.

## Kill-switches

- **Disable Channel B:** remove the `PreToolUse` block from `.claude/settings.json`, or set `SKIP_PUSH_BACKUP=1` in that file's `env`.
- **Disable Channel A:** `rm .git/hooks/pre-push` (the symlink) or `chmod -x dev/git-hooks/pre-push`.
- **Nuclear:** `touch .claude/no-push-backup` — both channels honour the sentinel.

## Install (after a fresh clone)

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM"
ln -sf ../../dev/git-hooks/pre-push .git/hooks/pre-push
chmod +x dev/git-hooks/pre-push dev/scripts/backup-on-push.sh .claude/hooks/push-backup-gate.sh
```

The `PreToolUse` hook for Channel B is configured in `.claude/settings.json` and is active on every Claude Code session automatically.

## Related

- [c_db-backup.md](c_db-backup.md) — the canonical `pg_dump` command this script invokes.
- [c_postgresql.md](c_postgresql.md) — tunnel + DB reference.
- [c_librarian.md](c_librarian.md) — complementary "after-changes" discipline.
