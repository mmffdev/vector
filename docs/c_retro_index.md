# Retro Index

## FROZEN — solo-dev mode (since 2026-05-17)

**Counter paused at `RETRO-000`.** Manual `<r>` is downgraded in solo-dev mode — the skill warns and offers a one-line entry to root [`lessons.md`](../lessons.md) instead. The loop-detector auto-retro (`<r> --auto-loop`) remains always-on as a safety rail; if it ever fires, RETRO-001 will land here. Re-activates when prod-ready mode flips. See [`.claude/memory/feedback_solo_dev_mode.md`](../.claude/memory/feedback_solo_dev_mode.md).

---

**Last issued:** `RETRO-000`

## Format

`RETRO-NNN` (3-digit zero-padded; allocate next ID by reading this file then scanning `dev/retros/RETRO-*.json`).

## Files

- Per-retro JSON: `dev/retros/RETRO-NNN.json` (schema in [`app/api/dev/retros/route.ts`](../app/api/dev/retros/route.ts) `RetroDoc`).
- Recurring ledger: `dev/retros/LEDGER.json` (schema `Ledger`).
- CLAUDE.md proposals (NEVER auto-applied): `dev/retros/RETRO-NNN.proposed-claudemd.md`.

## Registry

| ID | Title | Date | Trigger | Findings | Wins | Max severity |
|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | |

## Deletion log

_(none)_
