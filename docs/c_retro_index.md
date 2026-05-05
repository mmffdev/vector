# Retro Index

**Last issued:** `RETRO-000`

## Format

`RETRO-NNN` (3-digit zero-padded; allocate next ID by reading this file then scanning `dev/retros/RETRO-*.json`).

## Files

- Per-retro JSON: `dev/retros/RETRO-NNN.json` (schema in [`app/api/dev/retros/route.ts`](../app/api/dev/retros/route.ts) `RetroDoc`).
- Recurring ledger: `dev/retros/LEDGER.json` (schema `Ledger`).
- CLAUDE.md proposals (NEVER auto-applied): `dev/retros/RETRO-NNN.proposed-claudemd.md`.

## Planka board

Continuous Improvement board ID `1767896664086938708`, Backlog list `1767896919369057368`. Severity-4+ findings auto-create a card on this board (cap 5/retro, ≥90% confidence, AIGEN label). Never use the main workflow board (`1760699595475649556`) for retro cards.

## Registry

| ID | Title | Date | Trigger | Findings | Wins | Max severity |
|---|---|---|---|---|---|---|
| _(none yet)_ | | | | | | |

## Deletion log

_(none)_
