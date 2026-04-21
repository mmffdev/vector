# `<npm>` — start the Next.js dev server

Starts the Next dev server on `http://localhost:5101` — but only if one isn't already running.

## One-shot: check, then start if absent

Finds any live `next dev` / `next-server` process on this machine (any port) and reports its URL. If none exists, starts `npm run dev` in the background and reports the URL once the server is listening.

```bash
cd "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM" && \
found=""; \
for pid in $(pgrep -f "next dev|next-server" 2>/dev/null); do
  port=$(lsof -aP -p "$pid" -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {split($9,a,":"); print a[length(a)]; exit}')
  [ -z "$port" ] && continue
  found="http://localhost:$port (pid $pid)"; break
done; \
if [ -n "$found" ]; then
  echo "next dev already running → $found"
else
  : > /tmp/mmff-next.log
  nohup npm run dev >/tmp/mmff-next.log 2>&1 &
  npid=$!
  echo "started npm run dev (pid $npid); waiting for listener..."
  for _ in $(seq 1 60); do
    url=$(grep -Eom1 'https?://localhost:[0-9]+' /tmp/mmff-next.log)
    [ -n "$url" ] && { echo "next dev running → $url (pid $npid)"; break; }
    sleep 1
  done
  [ -z "$url" ] && echo "timed out waiting; tail /tmp/mmff-next.log for details"
fi
```

Logs stream to `/tmp/mmff-next.log`.

## Flags

`<npm> -h`, `-where`, `-stop`, `-restart`, `-<PORT>` → [`c_c_npm_flags.md`](c_c_npm_flags.md).
