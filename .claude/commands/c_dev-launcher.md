# Dev launcher — `MMFF Vector Dev.app`

> Last verified: 2026-04-27

Double-clickable AppleScript bundle that brings up the four local dev services: SSH tunnel (`localhost:5434` + `:3333` + more), Go backend (`:5100`), Next.js frontend (`:5101`), with Planka (`:3333`) status shown in the summary.

## Source

[`../MMFF Vector Dev.applescript`](../MMFF%20Vector%20Dev.applescript) — the readable source, committed alongside the compiled bundle.

## Bundle locations

- `<root>/MMFF Vector Dev.app` — the compiled bundle.
- `/Applications/MMFF Vector Dev.app` — symlink pointing at the repo bundle (so Spotlight / Dock / Launchpad find it without duplicating binaries).

## Usage

Launch via Spotlight ("MMFF Vector Dev"), Dock, or `open -a "MMFF Vector Dev"`. On each run it:

1. Detects running services **by process name** (`pgrep -f`) and verifies the port is actually listening.
2. If any of the three are already up, shows a dialog listing them with PIDs and offers **Kill and restart** / **Leave running** / **Cancel**.
3. Starts missing services fully detached (`nohup … & disown` inside `bash -lc`) so they survive the launcher exiting, Terminal quitting, and Claude Code session ending.
4. Waits for each to come up (tunnel 15s, backend 30s, frontend 60s) and reports a status summary.

## Logs

- `/tmp/mmff-tunnel.log`
- `/tmp/mmff-server.log`
- `/tmp/mmff-next.log`

## Rebuild after edits

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" \
  && osacompile -o "MMFF Vector Dev.app" "MMFF Vector Dev.applescript"
```

The `/Applications` symlink picks up the new bundle automatically — no re-link needed.

## First-run Gatekeeper

First launch may be blocked by Gatekeeper because the bundle is unsigned. Right-click the app in Finder and choose **Open** once to whitelist it; subsequent double-clicks work normally.
