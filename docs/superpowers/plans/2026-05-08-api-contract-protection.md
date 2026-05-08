# API Contract Protection & Blast Radius Toolchain — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install a four-layer API contract protection toolchain: drift detection scripts, a breaking-change git hook with `[breaking]` escape, a snapshot + blast radius reporter, a Dev panel tab, and a stubbed GitHub Actions workflow.

**Architecture:** Three Python/shell scripts in `dev/scripts/` enforce the Go router ↔ spec ↔ frontend caller invariants locally; a version-controlled pre-push hook runs them before every push; `npm run api:snap` freezes the spec into `api-snapshots/vN.yaml` and generates a blast radius report; a new `DevApiChangelogPanel` in `/dev` renders the report on demand; a `.github/workflows/api-contracts.yml` file is stubbed ready for when a GitHub remote is added.

**Tech Stack:** Python 3, bash, `oasdiff` (Go binary via `go install`), Next.js App Router API route, React + `.dui-*` CSS catalog, GitHub Actions (stubbed)

---

## File Map

| File | Action |
| --- | --- |
| `dev/scripts/check_routes.sh` | Create — Layer 1: Go router vs spec drift |
| `dev/scripts/check_callers.py` | Create — Layer 1: frontend api() callers vs spec |
| `dev/scripts/snap_api.sh` | Create — Layer 4: snapshot + blast radius generator |
| `dev/scripts/pre-push.sh` | Create — Layer 2: version-controlled hook source |
| `api-snapshots/` | Create dir + initial `v1.yaml`, `CHANGELOG.md`, placeholder files |
| `dev/registries/dead-api-exemptions.txt` | Create — allow-list for intentionally uncalled spec paths |
| `app/api/dev/api-changelog/route.ts` | Create — Next.js API route serving changelog data |
| `dev/pages/DevApiChangelogPanel.tsx` | Create — Dev panel tab rendering the blast radius report |
| `dev/pages/DevPage.tsx` | Modify — register new panel tab |
| `package.json` | Modify — add `api:snap`, `api:check`, `api:install-hooks` scripts |
| `docs/c_c_lint_rules.md` | Modify — add check_routes + check_callers entries |
| `README.md` | Modify — add oasdiff to dev setup instructions |
| `.github/workflows/api-contracts.yml` | Create — stubbed GH Actions workflow |

---

### Task 1: `check_routes.sh` — Go router vs spec drift

**Files:**
- Create: `dev/scripts/check_routes.sh`

**Context:** The Go router is in `backend/cmd/server/main.go`. After PLA-0028 the mount prefix is `/samantha/v1`. Routes are registered as `r.Get("/work-items", ...)`, `r.Post("/auth/login", ...)` etc. inside `r.Route("/samantha/v1", func(r chi.Router) { ... })`. Infra routes (`/healthz`, `/env`, `/status/pipeline`, `/ws`, `/env/switch`) live outside the versioned block at the root level — skip them. The spec is at `openapi.yaml` in the repo root.

- [ ] **Step 1: Create the script**

```bash
#!/usr/bin/env bash
# check_routes.sh — Layer 1: Go router ↔ openapi.yaml drift
# Exit 0 = clean. Exit 1 = undocumented routes found.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MAIN_GO="$REPO_ROOT/backend/cmd/server/main.go"
SPEC="$REPO_ROOT/openapi.yaml"

# Infra routes that live outside the versioned block — always skip
INFRA_ALLOW=(
  "/healthz"
  "/env"
  "/env/switch"
  "/status/pipeline"
  "/ws"
)

# Extract all path strings from chi route registrations.
# Matches: r.Get("/foo", ...), r.Post("/foo/{id}", ...) etc.
# Strips the /samantha/v1 or /samantha/v2 mount prefix if present.
go_paths() {
  grep -oE 'r\.(Get|Post|Put|Patch|Delete|Head)\("(/[^"]*)"' "$MAIN_GO" \
    | grep -oE '"(/[^"]*)"' \
    | tr -d '"' \
    | sed 's|^/samantha/v[0-9]*||' \
    | sort -u
}

# Extract all path keys from openapi.yaml (lines starting with "  /")
spec_paths() {
  grep -E '^  /' "$SPEC" | sed 's/://; s/^  //' | sort -u
}

is_infra() {
  local p="$1"
  for infra in "${INFRA_ALLOW[@]}"; do
    [[ "$p" == "$infra" ]] && return 0
  done
  return 1
}

errors=0
warnings=0

echo "=== check_routes: Go router ↔ openapi.yaml ==="

# Hard fail: Go route not in spec
while IFS= read -r path; do
  is_infra "$path" && continue
  if ! spec_paths | grep -qx "$path"; then
    echo "ERROR: Go route '$path' has no spec entry (undocumented route)" >&2
    errors=$((errors + 1))
  fi
done < <(go_paths)

# Warn only: spec path not in Go routes
while IFS= read -r path; do
  if ! go_paths | grep -qx "$path"; then
    echo "WARN:  Spec path '$path' has no Go route (spec-first OK, or dead spec entry)"
    warnings=$((warnings + 1))
  fi
done < <(spec_paths)

echo "--- Result: $errors error(s), $warnings warning(s)"

if [[ $errors -gt 0 ]]; then
  echo "FAIL: $errors undocumented route(s) found. Add them to openapi.yaml before pushing." >&2
  exit 1
fi

echo "OK"
exit 0
```

- [ ] **Step 2: Make executable and run**

```bash
chmod +x dev/scripts/check_routes.sh
bash dev/scripts/check_routes.sh
```

Expected (before PLA-0028 is done): warnings about `/samantha/v1` prefix not stripping correctly, or several WARN lines for spec paths with no Go route. No ERRORs if the spec is current. After PLA-0028 lands, re-run — should show OK with only WARNs.

- [ ] **Step 3: Commit**

```bash
git add dev/scripts/check_routes.sh
git commit -m "feat(PLA-0029): add check_routes.sh — Go router vs spec drift detector"
```

---

### Task 2: `check_callers.py` — frontend callers vs spec

**Files:**
- Create: `dev/scripts/check_callers.py`
- Create: `dev/registries/dead-api-exemptions.txt`
- Create: `api-snapshots/` directory with placeholder files

**Context:** The frontend uses `api("/path")` from `app/lib/api.ts` (prepends `${host}/samantha/v1`) and `apiInfra("/path")` (prepends `${host}` only — for infra routes like `/env`, `/status/pipeline`). Call sites live in `app/` excluding `app/api/v2/` (Next.js PoC handlers, not part of the Samantha surface). The script must extract the literal path strings, strip query params, and check each against `openapi.yaml`. It also writes `api-snapshots/caller-map.json` and `api-snapshots/dead-apis.txt` as side effects.

Infra paths from `apiInfra` (`/env`, `/status/pipeline`, `/env/switch`) should be checked against the unversioned routes in the spec (they appear under the root server entry, not under `/samantha/v1`) — for now, skip them from the hard-fail check and include in the warn-only dead-api scan.

- [ ] **Step 1: Create the exemptions registry**

```bash
mkdir -p api-snapshots dev/registries
touch dev/registries/dead-api-exemptions.txt
```

Add a comment header to `dev/registries/dead-api-exemptions.txt`:

```
# dead-api-exemptions.txt
# Spec paths with no frontend caller that are intentionally uncalled
# (e.g. used by external scripts or future external clients).
# One path per line. Lines starting with # are ignored.
```

- [ ] **Step 2: Create placeholder snap files**

```bash
mkdir -p api-snapshots
echo "# API Snapshot Changelog" > api-snapshots/CHANGELOG.md
echo '{}' > api-snapshots/caller-map.json
touch api-snapshots/dead-apis.txt
```

- [ ] **Step 3: Write the script**

Create `dev/scripts/check_callers.py`:

```python
#!/usr/bin/env python3
"""check_callers.py — Layer 1: frontend api() callers vs openapi.yaml.

Rules:
  - Caller path not in spec  → exit 1 (hard fail — frontend calling undocumented endpoint)
  - Spec path has no caller  → warn only, written to api-snapshots/dead-apis.txt
  - apiInfra() paths         → skipped from hard-fail, included in dead-api scan

Side effects (always written, even on failure):
  - api-snapshots/caller-map.json   — { "/path": ["file:line", ...] }
  - api-snapshots/dead-apis.txt     — spec paths with zero callers
"""
from __future__ import annotations
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_DIR = ROOT / "app"
SPEC = ROOT / "openapi.yaml"
SNAPSHOTS_DIR = ROOT / "api-snapshots"
EXEMPTIONS_FILE = ROOT / "dev" / "registries" / "dead-api-exemptions.txt"
CALLER_MAP_FILE = SNAPSHOTS_DIR / "caller-map.json"
DEAD_APIS_FILE = SNAPSHOTS_DIR / "dead-apis.txt"

# Regex: api("/path") or api('/path') — captures the path string
API_RE = re.compile(r'\bapi\s*\(\s*["\']([^"\'?#]+)')
# Regex: apiInfra("/path") or apiInfra('/path')
INFRA_RE = re.compile(r'\bapiInfra\s*\(\s*["\']([^"\'?#]+)')

EXCLUDE_DIRS = {"node_modules", ".next", "api"}  # app/api/v2 PoC handlers excluded


def load_spec_paths() -> set[str]:
    paths: set[str] = set()
    for line in SPEC.read_text().splitlines():
        if re.match(r"^  /", line):
            paths.add(line.strip().rstrip(":"))
    return paths


def load_exemptions() -> set[str]:
    if not EXEMPTIONS_FILE.exists():
        return set()
    lines = EXEMPTIONS_FILE.read_text().splitlines()
    return {l.strip() for l in lines if l.strip() and not l.startswith("#")}


def scan_callers() -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    """Returns (api_callers, infra_callers) — both map path → [file:line, ...]."""
    api_callers: dict[str, list[str]] = {}
    infra_callers: dict[str, list[str]] = {}

    for ts_file in APP_DIR.rglob("*.ts"):
        if any(part in EXCLUDE_DIRS for part in ts_file.parts):
            continue
        _scan_file(ts_file, api_callers, infra_callers)

    for tsx_file in APP_DIR.rglob("*.tsx"):
        if any(part in EXCLUDE_DIRS for part in tsx_file.parts):
            continue
        _scan_file(tsx_file, api_callers, infra_callers)

    return api_callers, infra_callers


def _scan_file(
    path: pathlib.Path,
    api_callers: dict[str, list[str]],
    infra_callers: dict[str, list[str]],
) -> None:
    rel = str(path.relative_to(ROOT))
    for i, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
        for m in API_RE.finditer(line):
            p = m.group(1)
            api_callers.setdefault(p, []).append(f"{rel}:{i}")
        for m in INFRA_RE.finditer(line):
            p = m.group(1)
            infra_callers.setdefault(p, []).append(f"{rel}:{i}")


def main() -> int:
    spec_paths = load_spec_paths()
    exemptions = load_exemptions()
    api_callers, infra_callers = scan_callers()

    errors: list[str] = []

    # Hard fail: api() caller path not in spec
    for path, refs in sorted(api_callers.items()):
        if path not in spec_paths:
            errors.append(f"  ERROR: '{path}' called at {refs[0]} has no spec entry")

    # Build caller map (api callers only — infra excluded from map)
    caller_map: dict[str, list[str]] = {}
    for path in spec_paths:
        if path in api_callers:
            caller_map[path] = api_callers[path]

    # Dead APIs: spec paths with no api() caller and not exempted
    dead: list[str] = []
    for path in sorted(spec_paths):
        if path not in api_callers and path not in exemptions:
            dead.append(path)

    # Write side-effect files
    SNAPSHOTS_DIR.mkdir(exist_ok=True)
    CALLER_MAP_FILE.write_text(json.dumps(caller_map, indent=2))
    DEAD_APIS_FILE.write_text("\n".join(dead) + ("\n" if dead else ""))

    # Report
    print("=== check_callers: frontend api() callers vs openapi.yaml ===")
    if errors:
        for e in errors:
            print(e, file=sys.stderr)
        print(f"FAIL: {len(errors)} caller(s) reference undocumented endpoints", file=sys.stderr)
    print(f"  caller-map.json: {len(caller_map)} mapped endpoints")
    print(f"  dead-apis.txt:   {len(dead)} uncalled spec path(s)")
    if infra_callers:
        print(f"  apiInfra paths:  {len(infra_callers)} (skipped from hard-fail check)")
    print(f"--- Result: {len(errors)} error(s)")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Make executable and run**

```bash
chmod +x dev/scripts/check_callers.py
python3 dev/scripts/check_callers.py
```

Expected: prints caller map stats and dead-api count. If any `api("/api/...")` call sites still exist (pre-PLA-0028), they'll show as ERRORs because the spec won't have `/api/work-items` — that's correct, it means PLA-0028 hasn't landed yet. After PLA-0028, re-run — should be clean.

Check the generated files:

```bash
cat api-snapshots/caller-map.json | head -20
cat api-snapshots/dead-apis.txt
```

- [ ] **Step 5: Commit**

```bash
git add dev/scripts/check_callers.py dev/registries/dead-api-exemptions.txt api-snapshots/
git commit -m "feat(PLA-0029): add check_callers.py + api-snapshots scaffold"
```

---

### Task 3: `snap_api.sh` — snapshot + blast radius generator

**Files:**
- Create: `dev/scripts/snap_api.sh`

**Context:** `oasdiff` must be installed (`go install github.com/tufin/oasdiff@latest`). This script is run manually via `npm run api:snap`. It determines the next version number by scanning `api-snapshots/` for existing `vN.yaml` files, copies `openapi.yaml` as the new snapshot, generates a changelog vs the previous snapshot, regenerates `caller-map.json`, and appends to `CHANGELOG.md`.

- [ ] **Step 1: Install oasdiff**

```bash
go install github.com/tufin/oasdiff@latest
oasdiff --version
```

Expected: prints version like `oasdiff version 1.x.x`.

- [ ] **Step 2: Create the script**

Create `dev/scripts/snap_api.sh`:

```bash
#!/usr/bin/env bash
# snap_api.sh — Layer 4: bump snapshot + generate blast radius report
# Usage: npm run api:snap
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SPEC="$REPO_ROOT/openapi.yaml"
SNAP_DIR="$REPO_ROOT/api-snapshots"
SCRIPTS_DIR="$REPO_ROOT/dev/scripts"

mkdir -p "$SNAP_DIR"

# Determine next version number
latest_n=0
for f in "$SNAP_DIR"/v*.yaml; do
  [[ -f "$f" ]] || continue
  n="${f##*/v}"; n="${n%.yaml}"
  [[ "$n" =~ ^[0-9]+$ ]] && (( n > latest_n )) && latest_n=$n
done
next_n=$(( latest_n + 1 ))
prev_n=$latest_n

echo "=== api:snap — creating v${next_n} snapshot ==="

# Copy spec
cp "$SPEC" "$SNAP_DIR/v${next_n}.yaml"
echo "  Wrote api-snapshots/v${next_n}.yaml"

# Generate changelog vs previous snapshot
if [[ $prev_n -gt 0 && -f "$SNAP_DIR/v${prev_n}.yaml" ]]; then
  if command -v oasdiff &>/dev/null; then
    oasdiff changelog \
      "$SNAP_DIR/v${prev_n}.yaml" \
      "$SNAP_DIR/v${next_n}.yaml" \
      --format=markdown \
      > "$SNAP_DIR/blast-radius-latest.md" 2>/dev/null || true
    echo "  Wrote api-snapshots/blast-radius-latest.md"
  else
    echo "WARN: oasdiff not found — blast-radius-latest.md not generated. Run: go install github.com/tufin/oasdiff@latest"
    echo "# Blast radius report not generated — oasdiff not installed" > "$SNAP_DIR/blast-radius-latest.md"
  fi
else
  echo "# First snapshot — no previous version to diff against" > "$SNAP_DIR/blast-radius-latest.md"
  echo "  v${next_n} is first snapshot — no diff generated"
fi

# Regenerate caller map
python3 "$SCRIPTS_DIR/check_callers.py" > /dev/null
echo "  Regenerated api-snapshots/caller-map.json + dead-apis.txt"

# Append to CHANGELOG.md
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
DATE=$(date +%Y-%m-%d)
BREAKING="no"
if [[ -f "$SNAP_DIR/blast-radius-latest.md" ]] && grep -qi "breaking" "$SNAP_DIR/blast-radius-latest.md" 2>/dev/null; then
  BREAKING="yes"
fi

cat >> "$SNAP_DIR/CHANGELOG.md" <<EOF

## v${next_n} — ${DATE}

Snapshot of openapi.yaml at ${SHA}. Breaking changes: ${BREAKING}.
EOF
echo "  Appended to api-snapshots/CHANGELOG.md"

echo ""
echo "=== Done: v${next_n} snapshot ready. Commit api-snapshots/ to record it. ==="
```

- [ ] **Step 3: Make executable and run first snapshot**

```bash
chmod +x dev/scripts/snap_api.sh
bash dev/scripts/snap_api.sh
```

Expected output:
```
=== api:snap — creating v1 snapshot ===
  Wrote api-snapshots/v1.yaml
  v1 is first snapshot — no diff generated
  Regenerated api-snapshots/caller-map.json + dead-apis.txt
  Appended to api-snapshots/CHANGELOG.md

=== Done: v1 snapshot ready. Commit api-snapshots/ to record it. ===
```

- [ ] **Step 4: Verify files**

```bash
ls -la api-snapshots/
wc -l api-snapshots/v1.yaml   # should match openapi.yaml
cat api-snapshots/CHANGELOG.md
```

- [ ] **Step 5: Commit**

```bash
git add dev/scripts/snap_api.sh api-snapshots/
git commit -m "feat(PLA-0029): add snap_api.sh + v1 snapshot baseline"
```

---

### Task 4: Pre-push hook

**Files:**
- Create: `dev/scripts/pre-push.sh`

**Context:** Git hooks in `.git/hooks/` are not committed. The version-controlled source lives at `dev/scripts/pre-push.sh`. `npm run api:install-hooks` copies it to `.git/hooks/pre-push`. The hook runs `check_routes.sh`, `check_callers.py`, then `oasdiff breaking` against the latest snapshot. Breaking changes are blocked unless the last commit message contains `[breaking]`.

- [ ] **Step 1: Create the hook source**

Create `dev/scripts/pre-push.sh`:

```bash
#!/usr/bin/env bash
# pre-push.sh — Layer 2: API contract gate on every git push
# Install: npm run api:install-hooks
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPTS="$REPO_ROOT/dev/scripts"
SNAP_DIR="$REPO_ROOT/api-snapshots"
SPEC="$REPO_ROOT/openapi.yaml"

echo "=== pre-push: API contract checks ==="

# Layer 1a: Go router vs spec
if ! bash "$SCRIPTS/check_routes.sh"; then
  echo "BLOCKED: fix undocumented routes before pushing." >&2
  exit 1
fi

# Layer 1b: Frontend callers vs spec
if ! python3 "$SCRIPTS/check_callers.py"; then
  echo "BLOCKED: fix undocumented caller paths before pushing." >&2
  exit 1
fi

# Layer 2: Breaking change detection
# Find highest vN.yaml snapshot
latest_snap=""
latest_n=0
for f in "$SNAP_DIR"/v*.yaml; do
  [[ -f "$f" ]] || continue
  n="${f##*/v}"; n="${n%.yaml}"
  [[ "$n" =~ ^[0-9]+$ ]] && (( n > latest_n )) && { latest_n=$n; latest_snap=$f; }
done

if [[ -z "$latest_snap" ]]; then
  echo "WARN: no snapshot found in api-snapshots/ — breaking-change check skipped."
  echo "      Run 'npm run api:snap' to establish a baseline."
  echo "=== pre-push: OK (no snapshot) ==="
  exit 0
fi

if ! command -v oasdiff &>/dev/null; then
  echo "WARN: oasdiff not installed — breaking-change check skipped."
  echo "      Run: go install github.com/tufin/oasdiff@latest"
  echo "=== pre-push: OK (oasdiff missing) ==="
  exit 0
fi

# Run oasdiff breaking — exit 1 means breaking changes found
if ! oasdiff breaking "$latest_snap" "$SPEC" --fail-on ERR 2>/dev/null; then
  # Check last commit message for [breaking] token
  LAST_MSG=$(git log -1 --format="%s%n%b" 2>/dev/null || echo "")
  if echo "$LAST_MSG" | grep -q '\[breaking\]'; then
    echo "INFO: Breaking changes detected but [breaking] token found in commit — allowed."
    echo "      Intentional breaking change recorded in git log."
  else
    echo "" >&2
    echo "BLOCKED: Breaking API changes detected vs $(basename "$latest_snap")." >&2
    echo "         Add [breaking] to your commit message to allow this push." >&2
    echo "         Breaking diff:" >&2
    oasdiff breaking "$latest_snap" "$SPEC" --fail-on ERR 2>/dev/null >&2 || true
    exit 1
  fi
fi

echo "=== pre-push: OK ==="
exit 0
```

- [ ] **Step 2: Add install script to package.json**

Open `package.json`. In the `"scripts"` block, add:

```json
"api:snap": "bash dev/scripts/snap_api.sh",
"api:check": "bash dev/scripts/check_routes.sh && python3 dev/scripts/check_callers.py",
"api:install-hooks": "cp dev/scripts/pre-push.sh .git/hooks/pre-push && chmod +x .git/hooks/pre-push && echo 'pre-push hook installed'"
```

- [ ] **Step 3: Install the hook and verify**

```bash
chmod +x dev/scripts/pre-push.sh
npm run api:install-hooks
```

Expected: `pre-push hook installed`

```bash
cat .git/hooks/pre-push | head -5
```

Expected: shows the shebang and script content.

- [ ] **Step 4: Test the hook runs cleanly**

```bash
npm run api:check
```

Expected: both scripts pass (or show only warnings, no errors).

- [ ] **Step 5: Commit**

```bash
git add dev/scripts/pre-push.sh package.json
git commit -m "feat(PLA-0029): add pre-push hook + api:snap/check/install-hooks npm scripts"
```

---

### Task 5: Next.js API route — `/api/dev/api-changelog`

**Files:**
- Create: `app/api/dev/api-changelog/route.ts`

**Context:** Next.js App Router API route. Reads `api-snapshots/blast-radius-latest.md`, `api-snapshots/caller-map.json`, `api-snapshots/dead-apis.txt`, and `api-snapshots/CHANGELOG.md` from `process.cwd()` (repo root). Returns JSON. Pattern matches existing `app/api/dev/plans/route.ts`.

- [ ] **Step 1: Create the route**

Create `app/api/dev/api-changelog/route.ts`:

```typescript
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SNAP_DIR = path.join(process.cwd(), "api-snapshots");

function readFile(name: string): string {
  const p = path.join(SNAP_DIR, name);
  if (!fs.existsSync(p)) return "";
  return fs.readFileSync(p, "utf-8");
}

function latestSnapshot(): { version: string; date: string } {
  let latestN = 0;
  if (fs.existsSync(SNAP_DIR)) {
    for (const f of fs.readdirSync(SNAP_DIR)) {
      const m = f.match(/^v(\d+)\.yaml$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > latestN) latestN = n;
      }
    }
  }
  if (latestN === 0) return { version: "none", date: "" };

  const changelog = readFile("CHANGELOG.md");
  const dateMatch = changelog.match(/## v\d+ — (\d{4}-\d{2}-\d{2})/g);
  const lastDate = dateMatch ? dateMatch[dateMatch.length - 1].replace(/## v\d+ — /, "") : "";
  return { version: `v${latestN}`, date: lastDate };
}

export async function GET() {
  const changelog = readFile("blast-radius-latest.md");
  const callerMapRaw = readFile("caller-map.json");
  const deadApisRaw = readFile("dead-apis.txt");
  const { version, date } = latestSnapshot();

  let callerMap: Record<string, string[]> = {};
  try {
    callerMap = callerMapRaw ? JSON.parse(callerMapRaw) : {};
  } catch {
    callerMap = {};
  }

  const deadApis = deadApisRaw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  return NextResponse.json({
    changelog,
    caller_map: callerMap,
    dead_apis: deadApis,
    snapshot_version: version,
    snapshot_date: date,
  });
}
```

- [ ] **Step 2: Test the route**

Start the dev server if not running (`npm run dev`), then:

```bash
curl http://localhost:5101/api/dev/api-changelog | python3 -m json.tool | head -30
```

Expected: JSON with `changelog`, `caller_map`, `dead_apis`, `snapshot_version: "v1"`, `snapshot_date`.

- [ ] **Step 3: Commit**

```bash
git add app/api/dev/api-changelog/route.ts
git commit -m "feat(PLA-0029): add /api/dev/api-changelog Next.js route"
```

---

### Task 6: `DevApiChangelogPanel` — Dev panel tab

**Files:**
- Create: `dev/pages/DevApiChangelogPanel.tsx`
- Modify: `dev/pages/DevPage.tsx`

**Context:** Follow the exact pattern of `DevPlansPanel.tsx` and `DevApiV2TestsPanel.tsx`. Use `.dui-*` CSS classes only — no bespoke classes, no inline styles. Three sections: Changelog (markdown), Caller Map (searchable table), Dead APIs (list). A Refresh button re-fetches the API route.

- [ ] **Step 1: Create the panel component**

Create `dev/pages/DevApiChangelogPanel.tsx`:

```typescript
"use client";

import { useEffect, useState } from "react";
import Panel from "@/app/components/Panel";

type ApiChangelogData = {
  changelog: string;
  caller_map: Record<string, string[]>;
  dead_apis: string[];
  snapshot_version: string;
  snapshot_date: string;
};

export default function DevApiChangelogPanel() {
  const [data, setData] = useState<ApiChangelogData | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/dev/api-changelog");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredMap = data
    ? Object.entries(data.caller_map).filter(([path, callers]) =>
        !filter ||
        path.toLowerCase().includes(filter.toLowerCase()) ||
        callers.some((c) => c.toLowerCase().includes(filter.toLowerCase()))
      )
    : [];

  return (
    <Panel name="dev_api_changelog">
      <div className="dui-section-header">
        <span className="dui-label">API Changelog</span>
        <span className="dui-meta">
          {data ? `Snapshot ${data.snapshot_version} · ${data.snapshot_date || "—"}` : "Loading…"}
        </span>
        <button className="dui-btn dui-btn--sm" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && <p className="dui-empty">Loading…</p>}

      {!loading && data && (
        <>
          {/* Changelog */}
          <div className="dui-card">
            <div className="dui-card-header">Blast Radius — Changes vs Previous Snapshot</div>
            <div className="dui-card-body">
              {data.changelog ? (
                <pre className="dui-code">{data.changelog}</pre>
              ) : (
                <p className="dui-empty">No changelog — this is the first snapshot, or snap has not been run yet.</p>
              )}
            </div>
          </div>

          {/* Caller Map */}
          <div className="dui-card">
            <div className="dui-card-header">
              Caller Map
              <span className="dui-meta">{Object.keys(data.caller_map).length} endpoints mapped</span>
            </div>
            <div className="dui-card-body">
              <input
                className="dui-input"
                placeholder="Filter by endpoint or file…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <table className="dui-table">
                <thead>
                  <tr>
                    <th className="dui-th">Endpoint</th>
                    <th className="dui-th">Callers</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMap.length === 0 ? (
                    <tr><td className="dui-td" colSpan={2}>No matches</td></tr>
                  ) : (
                    filteredMap.map(([path, callers]) => (
                      <tr key={path}>
                        <td className="dui-td dui-td--mono">{path}</td>
                        <td className="dui-td">
                          {callers.map((c) => (
                            <div key={c} className="dui-meta">{c}</div>
                          ))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dead APIs */}
          <div className="dui-card">
            <div className="dui-card-header">
              Dead APIs
              <span className="dui-meta">{data.dead_apis.length} uncalled spec path(s)</span>
            </div>
            <div className="dui-card-body">
              {data.dead_apis.length === 0 ? (
                <p className="dui-empty">No dead APIs detected.</p>
              ) : (
                <ul className="dui-list">
                  {data.dead_apis.map((p) => (
                    <li key={p} className="dui-list-item dui-td--mono">{p}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}
```

- [ ] **Step 2: Register the panel in DevPage.tsx**

Open `dev/pages/DevPage.tsx`. Add the import after the existing imports:

```typescript
import DevApiChangelogPanel from "./DevApiChangelogPanel";
```

In `TAB_LABELS`, add:

```typescript
"api-changelog": "API Changelog",
```

In the render section where other panels are conditionally rendered (look for `{tab === "api-v2-tests" && <DevApiV2TestsPanel />}`), add:

```typescript
{tab === "api-changelog" && <DevApiChangelogPanel />}
```

In the tab navigation (look for where tab buttons are rendered using `TAB_LABELS`), no change needed — `TAB_LABELS` drives the nav automatically.

- [ ] **Step 3: Verify in browser**

Open `http://localhost:5101/dev` → click "API Changelog" tab. Verify:

- Snapshot version and date shown in header
- Blast radius section shows "first snapshot" message (since v1 has no previous diff)
- Caller Map table populates with endpoint → file:line rows
- Filter input narrows the table
- Dead APIs section shows uncalled spec paths (or "No dead APIs")
- Refresh button re-fetches without page reload

- [ ] **Step 4: Check lint:dev-css**

```bash
npm run lint:dev-css 2>/dev/null || python3 dev/scripts/lint_dev_css.py
```

Expected: no new violations from `DevApiChangelogPanel.tsx`.

- [ ] **Step 5: Commit**

```bash
git add dev/pages/DevApiChangelogPanel.tsx dev/pages/DevPage.tsx
git commit -m "feat(PLA-0029): add DevApiChangelogPanel + register tab in DevPage"
```

---

### Task 7: GitHub Actions workflow (stubbed)

**Files:**
- Create: `.github/workflows/api-contracts.yml`

**Context:** No GitHub remote exists yet. The workflow is inert until one is added. It mirrors the pre-push hook — `api-map` job runs the drift checks, `api-protect` job runs `oasdiff breaking` with the `[breaking]` PR title gate. Both block merge on failure. No snap job — snapshots are always manual.

- [ ] **Step 1: Create the .github directory and workflow**

```bash
mkdir -p .github/workflows
```

Create `.github/workflows/api-contracts.yml`:

```yaml
# api-contracts.yml
# Mirrors the pre-push hook for CI.
# Inert until a GitHub remote is configured.
#
# Jobs:
#   api-map     — Go router + frontend caller drift (blocks PR on failure)
#   api-protect — Breaking change detection (blocks PR unless [breaking] in PR title/body)

name: API Contracts

on:
  pull_request:
    branches: [main]

jobs:
  api-map:
    name: Route & Caller Drift
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Check Go routes vs spec
        run: bash dev/scripts/check_routes.sh

      - name: Check frontend callers vs spec
        run: python3 dev/scripts/check_callers.py

  api-protect:
    name: Breaking Change Gate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # needed to read full history

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version-file: backend/go.mod

      - name: Install oasdiff
        run: go install github.com/tufin/oasdiff@latest

      - name: Find latest snapshot
        id: snap
        run: |
          latest=""
          latest_n=0
          for f in api-snapshots/v*.yaml; do
            [ -f "$f" ] || continue
            n="${f##*/v}"; n="${n%.yaml}"
            [[ "$n" =~ ^[0-9]+$ ]] && (( n > latest_n )) && { latest_n=$n; latest=$f; }
          done
          echo "path=$latest" >> "$GITHUB_OUTPUT"
          echo "found=$([ -n "$latest" ] && echo true || echo false)" >> "$GITHUB_OUTPUT"

      - name: Breaking change check
        if: steps.snap.outputs.found == 'true'
        env:
          PR_TITLE: ${{ github.event.pull_request.title }}
          PR_BODY: ${{ github.event.pull_request.body }}
          SNAP: ${{ steps.snap.outputs.path }}
        run: |
          if oasdiff breaking "$SNAP" openapi.yaml --fail-on ERR 2>/dev/null; then
            echo "No breaking changes."
            exit 0
          fi
          # Breaking changes found — check for [breaking] token
          if echo "$PR_TITLE $PR_BODY" | grep -q '\[breaking\]'; then
            echo "Breaking changes detected — [breaking] token present. Allowed."
            oasdiff breaking "$SNAP" openapi.yaml --fail-on ERR 2>/dev/null || true
            exit 0
          fi
          echo "FAIL: Breaking API changes detected. Add [breaking] to your PR title to allow." >&2
          oasdiff breaking "$SNAP" openapi.yaml --fail-on ERR >&2 || true
          exit 1

      - name: No snapshot warning
        if: steps.snap.outputs.found == 'false'
        run: |
          echo "WARN: No snapshot found in api-snapshots/ — breaking-change check skipped."
          echo "      Run 'npm run api:snap' and commit the result to establish a baseline."
```

- [ ] **Step 2: Verify YAML is valid**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/api-contracts.yml'))" && echo "YAML valid"
```

Expected: `YAML valid`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/api-contracts.yml
git commit -m "feat(PLA-0029): stub GitHub Actions api-contracts workflow (inert until remote added)"
```

---

### Task 8: Docs + README

**Files:**
- Modify: `docs/c_c_lint_rules.md`
- Modify: `README.md`

**Context:** `docs/c_c_lint_rules.md` documents all custom lint scripts. `README.md` needs `oasdiff` added to the dev setup section so new engineers know to install it.

- [ ] **Step 1: Update lint rules doc**

Open `docs/c_c_lint_rules.md`. Add two entries following the existing format:

```markdown
## `check_routes` — Go router vs OpenAPI spec

**Script:** `dev/scripts/check_routes.sh`
**Run:** `bash dev/scripts/check_routes.sh`
**Rule:** Every `r.Get/Post/Put/Patch/Delete` path in `backend/cmd/server/main.go` must have a matching entry in `openapi.yaml`. Infra routes (`/healthz`, `/env`, `/status/pipeline`, `/ws`, `/env/switch`) are exempt.
**Fail on:** Go route present, spec path absent (exit 1). Spec path present, Go route absent = warn only.
**Part of:** `npm run api:check`, pre-push hook (PLA-0029)

## `check_callers` — Frontend api() callers vs OpenAPI spec

**Script:** `dev/scripts/check_callers.py`
**Run:** `python3 dev/scripts/check_callers.py`
**Rule:** Every `api("…")` path string in `app/` must have a matching entry in `openapi.yaml`.
**Fail on:** Caller path present, spec entry absent (exit 1). Spec path with no caller = warn + dead-apis.txt.
**Side effects:** Writes `api-snapshots/caller-map.json` and `api-snapshots/dead-apis.txt`.
**Exemptions:** `dev/registries/dead-api-exemptions.txt` (one path per line).
**Part of:** `npm run api:check`, pre-push hook (PLA-0029)
```

- [ ] **Step 2: Update README**

Find the dev setup section in `README.md` (look for Go install instructions or backend setup). Add:

```markdown
### oasdiff (API breaking-change detector)

```bash
go install github.com/tufin/oasdiff@latest
```

Used by the pre-push hook (`npm run api:install-hooks`) to detect breaking API changes vs the committed snapshot. Skipped gracefully if not installed, but required for the full contract gate.
```

- [ ] **Step 3: Install hooks reminder**

Add to README dev setup (after oasdiff):

```markdown
### API contract hooks

```bash
npm run api:install-hooks   # installs pre-push hook
npm run api:check           # run drift checks manually
npm run api:snap            # bump snapshot + generate blast radius report
```
```

- [ ] **Step 4: Commit**

```bash
git add docs/c_c_lint_rules.md README.md
git commit -m "docs(PLA-0029): add check_routes + check_callers to lint rules doc; oasdiff to README"
```

---

### Task 9: Register PLA-0029 in plan index + JSON

**Files:**
- Modify: `docs/c_plan_index.md`
- Create: `dev/plans/PLA-0029.json`

- [ ] **Step 1: Update plan index**

In `docs/c_plan_index.md`, change `**Last issued:** \`PLA-0028\`` to `**Last issued:** \`PLA-0029\`` and add the row:

```markdown
| `PLA-0029` | API Contract Protection & Blast Radius Toolchain | 2026-05-08 | active |
```

- [ ] **Step 2: Create plan JSON**

Create `dev/plans/PLA-0029.json`:

```json
{
  "id": "PLA-0029",
  "title": "API Contract Protection & Blast Radius Toolchain",
  "date_created": "2026-05-08",
  "date_started": "2026-05-08",
  "date_last_updated": "2026-05-08",
  "date_finished": null,
  "scope": "<p>Four-layer toolchain to map, protect, contract, and visualise the Samantha API surface. Layer 1: two scripts (<code>check_routes.sh</code>, <code>check_callers.py</code>) enforce Go router ↔ spec ↔ frontend caller invariants. Layer 2: a version-controlled pre-push git hook runs all checks before every push, with <code>oasdiff breaking</code> gating on a <code>[breaking]</code> commit-message token. Layer 3: <code>caller-map.json</code> is the consumer contract artefact — spec path → frontend files. Layer 4: <code>npm run api:snap</code> freezes a snapshot and generates a blast radius report; <code>DevApiChangelogPanel</code> renders it in <code>/dev</code>. Layer 5: GitHub Actions workflow stubbed, inert until a remote is added.</p>",
  "value": "<p>Catches undocumented routes, caller/spec drift, and silent breaking changes before they reach any consumer. Establishes <code>api-snapshots/v1.yaml</code> as the baseline contract against which all future changes are measured. The blast radius panel gives instant visibility into what frontend components are affected by any API change.</p>",
  "implementation_plan": [
    "Task 1: check_routes.sh — Go router vs spec drift (hard fail if route undocumented)",
    "Task 2: check_callers.py — frontend api() callers vs spec + caller-map.json + dead-apis.txt",
    "Task 3: snap_api.sh — snapshot bump + oasdiff changelog + blast radius report",
    "Task 4: pre-push.sh + npm scripts — api:snap, api:check, api:install-hooks",
    "Task 5: /api/dev/api-changelog Next.js route — serves changelog data to Dev panel",
    "Task 6: DevApiChangelogPanel — blast radius + caller map + dead APIs in /dev",
    "Task 7: GitHub Actions workflow stub — api-map + api-protect jobs (inert until remote)",
    "Task 8: Docs + README — lint rules doc + oasdiff install instructions",
    "Task 9: Register PLA-0029 in plan index + JSON"
  ],
  "areas_impacted": [
    "DEV: dev/scripts/ — 4 new scripts (check_routes.sh, check_callers.py, snap_api.sh, pre-push.sh)",
    "DEV: dev/pages/DevApiChangelogPanel.tsx — new Dev panel tab",
    "DEV: dev/registries/dead-api-exemptions.txt — allow-list for intentionally uncalled paths",
    "API: app/api/dev/api-changelog/route.ts — Next.js route serving changelog JSON",
    "INFRA: api-snapshots/ — v1.yaml baseline + CHANGELOG.md + generated artefacts",
    "INFRA: .github/workflows/api-contracts.yml — stubbed CI workflow",
    "DOCS: docs/c_c_lint_rules.md, README.md"
  ],
  "feature_list": [
    "check_routes.sh: Go router ↔ openapi.yaml drift — hard fail on undocumented route",
    "check_callers.py: frontend api() callers ↔ spec — hard fail on undocumented caller",
    "caller-map.json: { path → [file:line, ...] } — consumer contract artefact",
    "dead-apis.txt + exemptions registry: spec paths with no frontend caller",
    "snap_api.sh: vN.yaml snapshot + oasdiff changelog → blast-radius-latest.md",
    "api-snapshots/CHANGELOG.md: one entry per snap with SHA + breaking flag",
    "pre-push hook: runs all checks before every push, [breaking] token escape hatch",
    "npm run api:snap / api:check / api:install-hooks",
    "DevApiChangelogPanel: blast radius + searchable caller map + dead APIs in /dev",
    "/api/dev/api-changelog: Next.js route serving snapshot data",
    ".github/workflows/api-contracts.yml: stubbed api-map + api-protect CI jobs"
  ],
  "features_extended": [],
  "features_removed": [],
  "work_item_backlog": [],
  "acceptance_criteria": [
    {
      "order": 1,
      "criterion": "check_routes.sh exits 1 when a Go route has no spec entry",
      "proven_by": "Temporarily add a fake route to main.go, run check_routes.sh, confirm exit 1",
      "story_id": null,
      "card_url": null,
      "done": false
    },
    {
      "order": 2,
      "criterion": "check_callers.py exits 1 when an api() call has no spec entry",
      "proven_by": "Temporarily add api('/nonexistent') to a tsx file, run check_callers.py, confirm exit 1",
      "story_id": null,
      "card_url": null,
      "done": false
    },
    {
      "order": 3,
      "criterion": "api-snapshots/v1.yaml exists and matches openapi.yaml line count",
      "proven_by": "wc -l api-snapshots/v1.yaml openapi.yaml — same count",
      "story_id": null,
      "card_url": null,
      "done": false
    },
    {
      "order": 4,
      "criterion": "pre-push hook blocks push when breaking change detected without [breaking] token",
      "proven_by": "Remove a path from openapi.yaml, attempt git push, confirm blocked with oasdiff diff output",
      "story_id": null,
      "card_url": null,
      "done": false
    },
    {
      "order": 5,
      "criterion": "DevApiChangelogPanel renders in /dev with caller map table and filter",
      "proven_by": "Open http://localhost:5101/dev → API Changelog tab, verify table populates and filter works",
      "story_id": null,
      "card_url": null,
      "done": false
    },
    {
      "order": 6,
      "criterion": ".github/workflows/api-contracts.yml is valid YAML with api-map + api-protect jobs",
      "proven_by": "python3 -c \"import yaml; yaml.safe_load(open('.github/workflows/api-contracts.yml'))\" exits 0",
      "story_id": null,
      "card_url": null,
      "done": false
    }
  ],
  "risks": [
    {
      "impact": 3,
      "risk": "check_routes.sh regex misses route registrations using middleware wrappers or sub-routers",
      "mitigation": "After running, manually diff script output against actual routes in main.go; refine regex if gaps found"
    },
    {
      "impact": 2,
      "risk": "check_callers.py misses api() calls using template literals or variable paths",
      "mitigation": "Script only catches literal string paths — dynamic paths must be documented manually; dead-api list will flag them"
    },
    {
      "impact": 2,
      "risk": "oasdiff not on PATH blocks pre-push for engineers who haven't installed it",
      "mitigation": "Hook skips breaking check with a warning if oasdiff missing — never hard-blocks on missing tool"
    }
  ],
  "references": [
    {
      "kind": "internal",
      "label": "Design spec — 2026-05-08-api-contract-protection-design.md",
      "href": "docs/superpowers/specs/2026-05-08-api-contract-protection-design.md"
    },
    {
      "kind": "external",
      "label": "oasdiff — GitHub",
      "href": "https://github.com/tufin/oasdiff"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add docs/c_plan_index.md dev/plans/PLA-0029.json
git commit -m "docs(PLA-0029): register plan in index + create plan JSON"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| check_routes.sh — Go router vs spec, hard fail one way | Task 1 |
| check_callers.py — caller vs spec, hard fail + dead-api warn | Task 2 |
| caller-map.json side effect | Task 2 |
| dead-api-exemptions.txt allow-list | Task 2 |
| snap_api.sh — snapshot bump + oasdiff changelog | Task 3 |
| api-snapshots/ directory + v1.yaml baseline | Task 3 |
| pre-push hook + npm scripts | Task 4 |
| /api/dev/api-changelog route | Task 5 |
| DevApiChangelogPanel — changelog + caller map + dead APIs | Task 6 |
| GitHub Actions stubbed workflow | Task 7 |
| Docs + README | Task 8 |
| apiInfra paths skipped from hard-fail | Task 2 (INFRA_ALLOW in check_callers) |
| oasdiff graceful skip if not installed | Tasks 3, 4 |
| [breaking] token escape hatch | Task 4 |

All requirements covered. No gaps.

**Placeholder scan:** Clean — no TBD, TODO, or vague steps. All code blocks are complete.

**Type consistency:** `ApiChangelogData` defined in Task 6, used only in Task 6. `caller_map` key name consistent between route.ts (Task 5) and panel (Task 6).
