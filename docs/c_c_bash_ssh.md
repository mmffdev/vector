# Bash — SSH operations

> Parent: [c_bash.md](c_bash.md)
> Last verified: 2026-04-21

Host aliases live in `~/.ssh/config` — see [c_ssh.md](c_ssh.md) for the full reference.

## Start the Postgres tunnel

```bash
ssh -N -f mmffdev-pg
```

- `-N` — no remote command (forward only).
- `-f` — background after auth.
- `mmffdev-pg` config: `LocalForward 5434 localhost:5432`.

Prefer `autossh` if installed (auto-reconnect):

```bash
autossh -M 0 -N -f mmffdev-pg
```

## Is the tunnel alive?

```bash
nc -z localhost 5434
```

Exit 0 = TCP reachable on `localhost:5434`. Does NOT prove Postgres is serving — pair with the `psql SELECT 1` round-trip in [c_c_bash_postgres.md](c_c_bash_postgres.md) for a real health check.

## Stop the tunnel

```bash
pkill -f 'ssh -N -f mmffdev-pg'
```

or for `autossh`:

```bash
pkill -f 'autossh.*mmffdev-pg'
```

## Interactive admin shell

```bash
ssh mmffdev-admin
```

Full interactive session to `root@mmffdev.com` without the tunnel.

## One-off command on the server

```bash
ssh mmffdev-admin 'docker ps | grep postgres'
```

## Setup helper (has all of this wrapped)

```bash
bash "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/dev/scripts/ssh_manager.sh"
```

Interactive setup that installs libpq, adds SSH config blocks, starts the tunnel, writes `backend/.env.local`. Safe to re-run — every step asks before doing anything.
