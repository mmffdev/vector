# `<services>` — check dev services

> Last verified: 2026-04-25

One-shot status check for the three local dev services managed by `MMFF Vector Dev.app`: SSH tunnel (`localhost:5434`), Go backend (`:5100`), Next.js frontend (`:5101`).

Read-only. Does not start, restart, or kill anything — use the launcher (or `<npm>`) for that.

The backend section also probes `/healthz` and compares the running process's `commit` to `git rev-parse HEAD`. Mismatch (or a plaintext `/healthz` response from a pre-2026-04-25 binary) → `STALE — restart`. Catches the trap from 2026-04-25 where the `go run`-launched backend kept running for 16+ hours while source moved on, silently invalidating any "I just changed X" claim.

## Command

```bash
HEAD_COMMIT=$(git -C "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" rev-parse HEAD 2>/dev/null)
for s in "tunnel:5434:ssh.*mmffdev-pg" "backend:5100:server|mmff-server|cmd/server" "next:5101:next dev|next-server"; do
  name=${s%%:*}; rest=${s#*:}; port=${rest%%:*}; pat=${rest#*:}
  pid=$(pgrep -f "$pat" 2>/dev/null | head -1)
  if nc -z localhost "$port" 2>/dev/null; then
    line="$name :$port  UP   pid=${pid:-?}"
    if [ "$name" = "backend" ]; then
      health=$(curl -sS --max-time 1 http://localhost:5100/healthz 2>/dev/null)
      if printf '%s' "$health" | grep -q '"commit"'; then
        run_commit=$(printf '%s' "$health" | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p')
        run_started=$(printf '%s' "$health" | sed -n 's/.*"started_at":"\([^"]*\)".*/\1/p')
        if [ "$run_commit" = "dev" ]; then
          line="$line  build=dev (go run; can't verify commit) started=$run_started"
        elif [ -n "$HEAD_COMMIT" ] && [ "${HEAD_COMMIT:0:${#run_commit}}" != "$run_commit" ]; then
          line="$line  build=${run_commit:0:8} HEAD=${HEAD_COMMIT:0:8} STALE — restart"
        else
          line="$line  build=${run_commit:0:8} started=$run_started"
        fi
      else
        line="$line  build=unknown (plaintext /healthz — pre-2026-04-25 binary, RESTART)"
      fi
    fi
    echo "$line"
  else
    echo "$name :$port  DOWN pid=${pid:-none}"
  fi
done
```

## `-s` flag — include credentials

When invoked as `<services> -s`, run the status check above, then append:

```bash
# App users (requires tunnel on :5434)
PGPASSWORD=$(grep '^DB_PASSWORD=' "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM/backend/.env.local" | cut -d= -f2-) \
/opt/homebrew/opt/libpq/bin/psql -h localhost -p 5434 -U mmff_dev -d mmff_vector \
  -c "SELECT email, role, is_active, force_password_change FROM users ORDER BY role, email;"
```

Also print: `Planka board: admin@mmffdev.com / changeme123! → http://localhost:3333`

Full credential reference: [`.claude/commands/c_accounts.md`](c_accounts.md)

---

## Logs (when something is DOWN)

- tunnel  → `/tmp/mmff-tunnel.log`
- backend → `/tmp/mmff-server.log`
- next    → `/tmp/mmff-next.log`

## Bring services back up

`open -a "MMFF Vector Dev"` — the launcher detects what's missing and starts only those. See [`c_dev-launcher.md`](c_dev-launcher.md).
