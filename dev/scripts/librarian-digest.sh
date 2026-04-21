#!/usr/bin/env bash
# librarian-digest.sh — prints a compact summary for session-start injection.
# Output goes to stdout and is captured by the SessionStart hook.

set -u

PROJECT_ROOT="/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM"
FLAGS="$PROJECT_ROOT/local-assets/security-flags.jsonl"
LOG="$PROJECT_ROOT/local-assets/backups/librarian-log.jsonl"
DOCS="$PROJECT_ROOT/docs"

# Open flag counts by severity (state:"open" entries only).
if [[ -f "$FLAGS" ]]; then
  COUNTS=$(python3 - "$FLAGS" <<'PY' 2>/dev/null || true
import json,sys
h=m=l=0
try:
    for line in open(sys.argv[1]):
        line=line.strip()
        if not line: continue
        try: e=json.loads(line)
        except Exception: continue
        if e.get("state") != "open": continue
        s=e.get("severity","")
        if s=="high": h+=1
        elif s=="med": m+=1
        elif s=="low": l+=1
    print(f"{h} {m} {l}")
except Exception: print("0 0 0")
PY
)
  read -r H M L <<<"${COUNTS:-0 0 0}"
else
  H=0; M=0; L=0
fi

# Stale leaves: Last verified > 90 days ago. Print oldest if any.
STALE=""
if [[ -d "$DOCS" ]]; then
  STALE=$(python3 - "$DOCS" <<'PY' 2>/dev/null || true
import os,re,sys,time
from datetime import datetime, timezone
root=sys.argv[1]; now=datetime.now(timezone.utc); cutoff=90
oldest=None
for fn in os.listdir(root):
    if not fn.endswith('.md') or not fn.startswith('c_'): continue
    path=os.path.join(root,fn)
    try:
        with open(path,'r',encoding='utf-8') as f:
            for i,line in enumerate(f):
                if i>5: break
                m=re.search(r'Last verified:\s*(\d{4}-\d{2}-\d{2})', line)
                if m:
                    dt=datetime.strptime(m.group(1), '%Y-%m-%d').replace(tzinfo=timezone.utc)
                    age=(now-dt).days
                    if age>cutoff and (oldest is None or age>oldest[0]):
                        oldest=(age,fn,m.group(1))
                    break
    except Exception: pass
if oldest: print(f"{oldest[1]} ({oldest[2]}, {oldest[0]}d)")
PY
)
fi

# Last 3 librarian activity lines.
RECENT=""
if [[ -f "$LOG" ]]; then
  RECENT=$(tail -n 3 "$LOG" 2>/dev/null | python3 - <<'PY' 2>/dev/null || true
import json,sys
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try: e=json.loads(line)
    except Exception: continue
    ts=e.get("ts",""); scope=e.get("scope","?"); n=e.get("files_reviewed",0)
    print(f"  - {ts} scope={scope} files={n}")
PY
)
fi

# Compose digest. Stay silent if nothing interesting.
if (( H == 0 && M == 0 && L == 0 )) && [[ -z "$STALE" ]] && [[ -z "$RECENT" ]]; then
  exit 0
fi

{
  echo "Librarian digest:"
  echo "  Open flags: high=$H med=$M low=$L"
  [[ -n "$STALE" ]] && echo "  Oldest stale leaf: $STALE"
  if [[ -n "$RECENT" ]]; then
    echo "  Recent runs:"
    echo "$RECENT"
  fi
}

exit 0
