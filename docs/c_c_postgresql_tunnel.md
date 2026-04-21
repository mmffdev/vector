# Postgres — tunnel lifecycle

> Parent: [c_postgresql.md](c_postgresql.md)
> Last verified: 2026-04-21

The tunnel is an SSH `LocalForward 5434 localhost:5432` through `mmffdev-pg`. Without it, `psql`/`pg_dump` cannot reach the DB from the laptop.

## State machine

```
[not running]  →  ssh -N -f  →  [running, listening on :5434]  →  pkill ssh  →  [not running]
```

A tunnel that dropped mid-session looks like "running but not listening" — `nc -z localhost 5434` fails but `ps` may still show an `ssh` process. Kill and restart.

## Check

```bash
nc -z localhost 5434 && echo up || echo down
```

## Start

```bash
ssh -N -f mmffdev-pg
```

With auto-reconnect (preferred for long sessions):

```bash
autossh -M 0 -N -f mmffdev-pg
```

## Stop

```bash
pkill -f 'ssh -N -f mmffdev-pg'
# or
pkill -f 'autossh.*mmffdev-pg'
```

## Full setup (first time, or after a clean laptop)

Run [`dev/scripts/ssh_manager.sh`](../dev/scripts/ssh_manager.sh) — interactive, idempotent. It checks libpq, autossh, SSH key/config blocks, tunnel, and `backend/.env.local` in order.

## Why 5434 and not 5432?

The laptop reserves `5432` for any locally-installed Postgres. Using `5434` as the tunnel port avoids a collision the day you `brew install postgres`. The host side is always `5432` — that's the container's exposed port.
