# `<npm>` flags

> Parent: [c_npm.md](c_npm.md)
> Last verified: 2026-04-21

Flag variants of the `<npm>` shortcut. The bare form is documented in the parent. These flags all operate on the Next dev server found by process (`pgrep -f "next dev|next-server"`), not by a hardcoded port.

## `<npm> -h` / `<npm> -help`

Print the flag list and exit.

```bash
cat <<'EOF'
<npm>           start next dev (default port 5101) if none is running
<npm> -where    report whether next dev is running and its URL
<npm> -stop     kill the running next dev and confirm it's gone
<npm> -restart  restart next dev on the same port it was using
<npm> -<PORT>   (re)start next dev on <PORT>; if taken by non-next,
                propose the next free port and ask to accept
<npm> -h        show this list
EOF
```

## `<npm> -where`

Report whether a Next dev server is running, with its pid and URL.

```bash
pid=$(pgrep -f "next dev|next-server" | head -1)
if [ -z "$pid" ]; then
  echo "next dev: not running"
else
  port=$(lsof -aP -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {split($9,a,":"); print a[length(a)]; exit}')
  echo "next dev: running → http://localhost:${port:-?} (pid $pid)"
fi
```

## `<npm> -stop`

Kill the running Next dev server (and any workers `npm run dev` spawned) and confirm it's gone.

```bash
pids=$(pgrep -f "next dev|next-server")
if [ -z "$pids" ]; then
  echo "next dev: nothing to stop"
else
  kill $pids 2>/dev/null
  for _ in $(seq 1 10); do
    sleep 0.5
    still=$(pgrep -f "next dev|next-server")
    [ -z "$still" ] && break
  done
  still=$(pgrep -f "next dev|next-server")
  if [ -z "$still" ]; then
    echo "next dev: stopped (killed pids: $pids)"
  else
    kill -9 $still 2>/dev/null
    echo "next dev: force-killed (pids: $still)"
  fi
fi
```

## `<npm> -restart`

Stop the running Next dev server, then start it on the **same port** it was using. If nothing was running, start fresh on the default port.

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" && \
pid=$(pgrep -f "next dev|next-server" | head -1); \
port=""; \
if [ -n "$pid" ]; then
  port=$(lsof -aP -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {split($9,a,":"); print a[length(a)]; exit}')
  kill $(pgrep -f "next dev|next-server") 2>/dev/null
  for _ in $(seq 1 10); do sleep 0.5; pgrep -f "next dev|next-server" >/dev/null || break; done
  pgrep -f "next dev|next-server" >/dev/null && kill -9 $(pgrep -f "next dev|next-server") 2>/dev/null
fi; \
: > /tmp/mmff-next.log; \
if [ -n "$port" ]; then
  nohup npm run dev -- -p "$port" >/tmp/mmff-next.log 2>&1 &
else
  nohup npm run dev >/tmp/mmff-next.log 2>&1 &
fi; \
npid=$!; \
for _ in $(seq 1 60); do
  url=$(grep -Eom1 'https?://localhost:[0-9]+' /tmp/mmff-next.log)
  [ -n "$url" ] && { echo "next dev restarted → $url (pid $npid)"; break; }
  sleep 1
done; \
[ -z "$url" ] && echo "timed out; tail /tmp/mmff-next.log"
```

## `<npm> -<PORT>` (e.g. `<npm> -3005`)

Restart (or start) the Next dev server on the given port. If the port is already in use by **something other than next**, the script finds the next free port sequentially (PORT+1, PORT+2, …) and asks the user whether to accept before starting.

```bash
PORT=3005   # ← substitute the requested port
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" && \
holder=$(lsof -tiTCP:$PORT -sTCP:LISTEN -n -P 2>/dev/null | head -1); \
holder_is_next=""; \
if [ -n "$holder" ]; then
  cmd=$(ps -o command= -p "$holder" 2>/dev/null)
  case "$cmd" in *next*) holder_is_next=1;; esac
fi; \
if [ -z "$holder" ] || [ -n "$holder_is_next" ]; then
  chosen=$PORT
else
  # find next free port above PORT
  chosen=""
  try=$((PORT+1))
  while [ $try -lt $((PORT+50)) ]; do
    lsof -tiTCP:$try -sTCP:LISTEN -n -P >/dev/null 2>&1 || { chosen=$try; break; }
    try=$((try+1))
  done
  [ -z "$chosen" ] && { echo "no free port within 50 of $PORT"; return 1 2>/dev/null || exit 1; }
  echo "port $PORT is taken (pid $holder, $cmd); next free is $chosen."
  printf "accept %s? [y/N] " "$chosen"
  read -r ans
  case "$ans" in y|Y|yes) : ;; *) echo "aborted"; return 1 2>/dev/null || exit 1;; esac
fi; \
# stop any existing next dev first, then start on $chosen
kill $(pgrep -f "next dev|next-server") 2>/dev/null; \
for _ in $(seq 1 10); do sleep 0.5; pgrep -f "next dev|next-server" >/dev/null || break; done; \
: > /tmp/mmff-next.log; \
nohup npm run dev -- -p "$chosen" >/tmp/mmff-next.log 2>&1 &
npid=$!; \
for _ in $(seq 1 60); do
  url=$(grep -Eom1 'https?://localhost:[0-9]+' /tmp/mmff-next.log)
  [ -n "$url" ] && { echo "next dev running → $url (pid $npid)"; break; }
  sleep 1
done; \
[ -z "$url" ] && echo "timed out; tail /tmp/mmff-next.log"
```

Notes:
- `npm run dev -- -p <port>` passes `-p` through to `next dev`.
- The `read -r` prompt needs an interactive shell; when Claude runs this, it should ask the user in-chat and re-run with a confirmed port rather than relying on the prompt.
