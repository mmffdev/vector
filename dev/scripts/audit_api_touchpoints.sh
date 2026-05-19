#!/usr/bin/env bash
# audit_api_touchpoints.sh — full-repo API audit.
#
# Walks the codebase and emits dev/audits/api-touchpoints.json:
# one entry per network call (apiSite / apiV2 / apiRoot / fetch / psql / etc.)
# across frontend, dev panels, scripts, and the Next.js shadow backend.
#
# Output schema (one object per touchpoint):
#   {
#     "id": <int>,
#     "group": "<page-first hybrid code>",
#     "location_page": "<URL or panel/script name>",
#     "location_file": "<file>:<line>",
#     "fn": "apiSite|apiV2|apiRoot|fetch|psql|pg_dump|curl|query|none",
#     "path": "<literal URL/path/SQL stem>",
#     "method": "GET|POST|PUT|PATCH|DELETE|SELECT|UPDATE|EXEC|...",
#     "kind": "site-api|v2-api|root-api|raw-fetch-shadow|raw-fetch-external|sse-stream|blob|psql-direct|pg-dump-sanctioned|curl-internal|curl-external|fs-only",
#     "status": "green|yellow|red|black|grey",
#     "gap": "<one-line action plan>",
#     "snippet": "<the matched line, trimmed to 140 chars>"
#   }
#
# Re-run any time. Idempotent; overwrites the snapshot.
#
# Read-only operation: no DB connections, no network calls. Just grep.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="$REPO_ROOT/dev/audits/api-touchpoints.json"
TMP=$(mktemp -t api-audit-XXXXXX.jsonl)
trap 'rm -f "$TMP"' EXIT

# ─── Helpers ──────────────────────────────────────────────────────────────────

# Emit a single JSONL row. Args: group, page, file:line, fn, path, method, kind, status, gap, snippet.
emit() {
  local group="$1" page="$2" loc="$3" fn="$4" path="$5" method="$6" kind="$7" status="$8" gap="$9" snippet="${10}"
  jq -nc \
    --arg group "$group" \
    --arg page "$page" \
    --arg loc "$loc" \
    --arg fn "$fn" \
    --arg path "$path" \
    --arg method "$method" \
    --arg kind "$kind" \
    --arg status "$status" \
    --arg gap "$gap" \
    --arg snippet "$snippet" \
    '{
      group: $group,
      location_page: $page,
      location_file: $loc,
      fn: $fn,
      path: $path,
      method: $method,
      kind: $kind,
      status: $status,
      gap: $gap,
      snippet: $snippet
    }' >> "$TMP"
}

# Trim a snippet to 140 chars, escape any literal quotes.
trim() {
  echo "$1" | tr -d '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | cut -c1-140
}

# Derive group code from a file path.
group_for() {
  local p="$1"
  case "$p" in
    app/\(user\)/work-items/*)            echo "WI" ;;
    app/\(user\)/portfolio-items/*)       echo "PI" ;;
    app/\(user\)/portfolio-model/*)       echo "PORT" ;;
    app/\(user\)/risk/*)                  echo "RISK" ;;
    app/\(user\)/topology/*)              echo "TOP" ;;
    app/\(user\)/sprints/*)               echo "SPR" ;;
    app/\(user\)/releases/*)              echo "REL" ;;
    app/\(user\)/user-management/*)       echo "UM" ;;
    app/\(user\)/admin/*)                 echo "UM.admin" ;;
    app/\(user\)/workspace-admin/*)       echo "WS" ;;
    app/\(user\)/vector-admin/*)          echo "WS.api-mgr" ;;
    app/\(user\)/library-releases/*)      echo "LIB" ;;
    app/\(user\)/account-settings/*)      echo "CFG.account" ;;
    app/\(user\)/preferences/*)           echo "CFG.prefs" ;;
    app/\(user\)/notifications-manager/*) echo "CFG.notif" ;;
    app/\(user\)/dev/*)                   echo "DEV-FE" ;;
    app/\(user\)/help/*)                  echo "HELP" ;;
    app/\(user\)/product/*)               echo "WI.product" ;;
    app/\(user\)/*)                       echo "SITE.other" ;;
    app/login/*)                          echo "AUTH" ;;
    app/help/*)                           echo "HELP" ;;
    app/v2/*)                             echo "V2" ;;
    app/components/*)                     echo "CMP" ;;
    app/lib/apiSite/*)                    echo "LIB-APISITE" ;;
    app/lib/*)                            echo "LIB-OTHER" ;;
    app/api/dev/*)                        echo "SHADOW.dev" ;;
    app/api/v2/*)                         echo "SHADOW.v2" ;;
    app/api/*)                            echo "SHADOW.other" ;;
    app/hooks/*)                          echo "HOOK" ;;
    app/contexts/*)                       echo "CTX" ;;
    app/*)                                echo "APP.root" ;;
    dev/pages/*)                          echo "DEV-PANEL" ;;
    dev/scripts/*)                        echo "DEV-SCRIPT" ;;
    *)                                    echo "MISC" ;;
  esac
}

# Sub-group from file basename — "WI" + filename "page.tsx" → "WI.page".
sub_for() {
  local p="$1"
  local base
  base=$(basename "$p" .tsx)
  base=$(basename "$base" .ts)
  base=$(basename "$base" .sh)
  echo "$base"
}

# Page URL from a route file path. app/(user)/work-items/page.tsx → /work-items.
url_for() {
  local p="$1"
  echo "$p" | sed -E 's#app/\(user\)/##; s#app/v2/#/v2/#; s#app/login#/login#; s#app/help#/help#; s#/page\.tsx$##; s#/route\.ts$##' | sed -E 's#^([^/])#/\1#'
}

# Classify kind for a frontend call given fn + path.
classify_kind() {
  local fn="$1" path="$2"
  case "$fn" in
    apiSite)        echo "site-api" ;;
    apiV2)          echo "v2-api" ;;
    apiRoot)        echo "root-api" ;;
    fetch)
      case "$path" in
        /api/dev/*) echo "raw-fetch-shadow" ;;
        /api/v2/*)  echo "raw-fetch-shadow" ;;
        /api/*)     echo "raw-fetch-shadow" ;;
        data:*)     echo "blob" ;;
        http*)      echo "raw-fetch-external" ;;
        *)          echo "raw-fetch-other" ;;
      esac
      ;;
    EventSource)    echo "sse-stream" ;;
    *)              echo "fs-only" ;;
  esac
}

# Sanctioned shadow-backend paths: Next.js handlers under app/api/dev/*
# that only touch the filesystem (read repo content like dev/research/,
# Vector_Scope.md, audit snapshots). These are NOT siteAPI bypasses for
# SOC2 purposes — the rule is "DB-touching code goes through siteAPI",
# and these handlers never touch a DB. Documented in:
#   docs/c_c_shadow_backend_exceptions.md
#
# Adding a path here downgrades it from red → sanctioned-shadow in both
# the shadow-pass (the route handler itself) and the frontend-fetch-pass
# (any `fetch("/api/dev/<path>…")` caller).
#
# Only file-only handlers belong here. If a handler talks to Postgres,
# leave it red — that's the real gap.
SANCTIONED_SHADOW_PATHS=(
  /api/dev/api-changelog
  /api/dev/library
  /api/dev/memory-reports
  /api/dev/operations
  /api/dev/plans
  /api/dev/research
  /api/dev/retros
  /api/dev/scope
  /api/dev/security-audits
  /api/dev/services
  /api/dev/go-test
)

# Returns 0 if path matches a sanctioned shadow path (literal prefix).
is_sanctioned_shadow() {
  local p="$1"
  for sp in "${SANCTIONED_SHADOW_PATHS[@]}"; do
    [[ "$p" == "$sp"* ]] && return 0
  done
  return 1
}

# Status colour from kind. Frontend rule:
#   site-api          → green   (sanctioned BFF)
#   root-api          → green   (legit transport infra)
#   v2-api            → yellow  (public data plane; only legit on /v2/* PoC)
#   raw-fetch-shadow  → red     (bypassing siteAPI via Next.js shadow backend)
#   raw-fetch-other   → red     (rogue path)
#   raw-fetch-external→ green   (blob/CDN/SSE that can't go through helpers)
#   blob              → green   (data: URLs)
#   sse-stream        → yellow  (SSE legitimately needs raw fetch but should use apiSite URL)
#   sanctioned-shadow → green   (file-only Next.js handler; not a DB-touching bypass)
#   psql-direct       → black   (worst case: pg-direct from Next.js)
#   pg-dump-sanctioned→ green   (backup tooling)
#   curl-internal     → green   (script against Go on :5100)
#   curl-external     → yellow  (script against something else)
#   fs-only           → green   (no DB, just file reads)
status_for() {
  case "$1" in
    site-api|root-api|raw-fetch-external|blob|pg-dump-sanctioned|curl-internal|fs-only|sanctioned-shadow) echo "green" ;;
    v2-api|sse-stream|curl-external)                                                                      echo "yellow" ;;
    raw-fetch-shadow|raw-fetch-other)                                                                     echo "red" ;;
    psql-direct)                                                                                          echo "black" ;;
    *)                                                                                                    echo "grey" ;;
  esac
}

# One-line action plan for any non-green status.
gap_for() {
  local kind="$1" path="$2"
  case "$kind" in
    site-api|root-api|raw-fetch-external|blob|pg-dump-sanctioned|curl-internal|fs-only) echo "" ;;
    v2-api)            echo "Move to apiSite if used from a site page (samanthaAPI is the public data plane, not site UI)." ;;
    sse-stream)        echo "Acceptable for SSE; ensure URL is constructed from API_SITE_BASE, not hardcoded." ;;
    raw-fetch-shadow)  echo "Migrate $path to /_site/* endpoint on Go backend, then switch caller to apiSite." ;;
    raw-fetch-other)   echo "Move to apiSite or document a sanctioned exception." ;;
    psql-direct)       echo "Critical: Next.js handler talks to Postgres directly. Migrate to a Go handler under /_site/* and call via apiSite." ;;
    curl-external)     echo "Confirm external dependency is intentional; otherwise route via backend proxy." ;;
    *)                 echo "Investigate." ;;
  esac
}

# ─── Pass 1: Frontend + dev panels — apiSite / apiV2 / apiRoot calls ──────────

# Match patterns like:  apiSite<X>("/path"   |  apiSite("/path"  |  apiV2("/path"  |  apiRoot("/path"
# Captures: 1=fn, 2=path. Method default is GET unless we find `method:` on the same/next line.

# Files we never audit: third-party plugins, test/spec files, the
# auditor itself, etc. Returns 0 (skip) if the path matches any rule.
should_skip_file() {
  local f="$1"
  [[ "$f" == *"/node_modules/"* ]]                    && return 0
  [[ "$f" == *"/cgl-volatile-do-not-commit/"* ]]      && return 0  # vendor-drop Claude plugins
  [[ "$f" == *".test."* ]]                            && return 0
  [[ "$f" == *".spec."* ]]                            && return 0
  return 1
}

scan_frontend_helper() {
  local fn_pattern="$1"  # apiSite, apiV2, apiRoot

  grep -rn --include="*.tsx" --include="*.ts" -E "\b${fn_pattern}<[^>]+>\(\"[^\"]+\"|\b${fn_pattern}\(\"[^\"]+\"|\b${fn_pattern}<[^>]+>\(\`[^\`]+\`|\b${fn_pattern}\(\`[^\`]+\`" \
    "$REPO_ROOT/app" "$REPO_ROOT/dev" 2>/dev/null | while IFS=: read -r file line content; do
    should_skip_file "$file" && continue

    rel=${file#$REPO_ROOT/}

    # Extract the path literal.
    path=$(echo "$content" | sed -nE "s/.*${fn_pattern}(<[^>]+>)?\(\"([^\"]+)\".*/\2/p; s/.*${fn_pattern}(<[^>]+>)?\(\`([^\`]+)\`.*/\2/p" | head -1)
    [[ -z "$path" ]] && path="<dynamic>"

    # Method inference: look for `method:` in the same line, else assume GET.
    method=$(echo "$content" | grep -oE 'method[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"/\1/')
    [[ -z "$method" ]] && method="GET"

    kind=$(classify_kind "$fn_pattern" "$path")
    status=$(status_for "$kind")
    gap=$(gap_for "$kind" "$path")
    group="$(group_for "$rel")"
    sub=$(sub_for "$rel")
    page=$(url_for "$rel")

    emit "${group}.${sub}" "$page" "${rel}:${line}" "$fn_pattern" "$path" "$method" "$kind" "$status" "$gap" "$(trim "$content")"
  done
}

scan_frontend_helper apiSite
scan_frontend_helper apiV2
scan_frontend_helper apiRoot

# ─── Pass 2: Frontend raw fetch() — the bypassing pattern ─────────────────────

grep -rn --include="*.tsx" --include="*.ts" -E '\bfetch\(' \
  "$REPO_ROOT/app" "$REPO_ROOT/dev" 2>/dev/null | while IFS=: read -r file line content; do
  should_skip_file "$file" && continue
  # Skip api.ts itself — its internal _fetch is the sanctioned wrapper.
  [[ "$file" == *"/app/lib/api.ts" ]] && continue
  # Skip Next.js route handlers — they're catalogued by Pass 4 as
  # shadow-backend handlers, not as frontend bypasses. Their fetch()
  # calls are server-to-server (e.g. TCP probes) and need different
  # classification than a browser-side fetch.
  [[ "$file" == *"/app/api/"* ]] && continue

  rel=${file#$REPO_ROOT/}

  # Extract path from fetch("…") or fetch(`…`).
  # Also recognise fetch(API_BASE + "…") / fetch(VAR + "/path") — capture
  # the trailing string so /_site or other prefix patterns can be detected.
  path=$(echo "$content" | sed -nE \
    -e 's/.*fetch\("([^"]+)".*/\1/p' \
    -e 's/.*fetch\(`([^`]+)`.*/\1/p' \
    -e 's/.*fetch\([A-Za-z_][A-Za-z0-9_]*[[:space:]]*\+[[:space:]]*"([^"]+)".*/\1/p' \
    | head -1)

  # If still dynamic, try to resolve a single-arg variable: e.g. `fetch(RELATIONS_PATH)`
  # and the file declares `const RELATIONS_PATH = "/api/...";` elsewhere.
  # Captures the var name then greps the file for its string constant.
  if [[ -z "$path" ]]; then
    var=$(echo "$content" | sed -nE 's/.*fetch\(([A-Za-z_][A-Za-z0-9_]*)[,)].*/\1/p' | head -1)
    if [[ -n "$var" ]]; then
      path=$(grep -E "(const|let|var)[[:space:]]+${var}[[:space:]]*=[[:space:]]*\"" "$file" 2>/dev/null \
        | sed -nE "s/.*${var}[[:space:]]*=[[:space:]]*\"([^\"]+)\".*/\1/p" | head -1)
    fi
  fi

  [[ -z "$path" ]] && path="<dynamic>"

  method=$(echo "$content" | grep -oE 'method[[:space:]]*:[[:space:]]*"[^"]+"' | head -1 | sed -E 's/.*"([^"]+)"/\1/')
  [[ -z "$method" ]] && method="GET"

  kind=$(classify_kind fetch "$path")

  # Sanctioned-shadow override: file-only /api/dev/* handlers don't
  # touch a DB, so calls to them aren't bypasses for SOC2 purposes.
  if is_sanctioned_shadow "$path"; then
    kind="sanctioned-shadow"
  fi

  # Peek the surrounding 20 lines once — multiple heuristics use it.
  # Wider window matters for SSE consumers: the `getReader()` call can
  # be 7+ lines below the fetch (await + ok-check + body extraction).
  ctx=$(sed -n "$((line>10 ? line-10 : 1)),$((line+10))p" "$file" 2>/dev/null)

  # Heuristic 1: if the fetch is consumed as an SSE stream (look for
  # `getReader()`, `ReadableStream`, `text/event-stream` nearby),
  # reclassify as sse-stream (yellow).
  if echo "$ctx" | grep -qE 'getReader\(\)|ReadableStream|text/event-stream|EventSource'; then
    kind="sse-stream"
  fi
  # Heuristic 2: if the call result becomes a blob (`.blob()`) or the
  # arg is a `data:` URL or variable named `dataUrl`/`*Url`, it's a
  # blob/data-URL fetch — not a backend call. Reclassify as blob.
  if echo "$ctx" | grep -qE '\.blob\(\)|data:[a-z]+/|fetch\([a-zA-Z_][a-zA-Z0-9_]*[Uu]rl\)'; then
    kind="blob"
  fi

  status=$(status_for "$kind")
  gap=$(gap_for "$kind" "$path")
  group="$(group_for "$rel")"
  sub=$(sub_for "$rel")
  page=$(url_for "$rel")

  emit "${group}.${sub}" "$page" "${rel}:${line}" "fetch" "$path" "$method" "$kind" "$status" "$gap" "$(trim "$content")"
done

# ─── Pass 3: EventSource (SSE) ────────────────────────────────────────────────

grep -rn --include="*.tsx" --include="*.ts" -E '\bnew EventSource\(' \
  "$REPO_ROOT/app" "$REPO_ROOT/dev" 2>/dev/null | while IFS=: read -r file line content; do
  should_skip_file "$file" && continue
  rel=${file#$REPO_ROOT/}
  path=$(echo "$content" | sed -nE 's/.*EventSource\("([^"]+)".*/\1/p' | head -1)
  [[ -z "$path" ]] && path="<dynamic>"
  group="$(group_for "$rel")"
  sub=$(sub_for "$rel")
  page=$(url_for "$rel")
  emit "${group}.${sub}" "$page" "${rel}:${line}" "EventSource" "$path" "GET" "sse-stream" "yellow" \
    "Acceptable for SSE; ensure URL is constructed from API_SITE_BASE." "$(trim "$content")"
done

# ─── Pass 4: Next.js shadow backend — app/api/**/route.ts pg-direct queries ───

if [[ -d "$REPO_ROOT/app/api" ]]; then
  find "$REPO_ROOT/app/api" -name "route.ts" -o -name "route.tsx" 2>/dev/null | while read -r file; do
    rel=${file#$REPO_ROOT/}
    page=$(echo "$rel" | sed -E 's#app/api##; s#/route\.tsx?$##')

    # Detect what this route handler does.
    has_pg=$(grep -cE '\bquery<|\bfrom\s+"@/app/lib/v2/db"|\bfrom\s+"@/app/lib/db"|\bnew Pool\(|\bPool\.connect' "$file" 2>/dev/null || true)
    has_fs=$(grep -cE '\bfs\.\(?readFileSync|readdirSync|readFile|readdir\)|fs/promises' "$file" 2>/dev/null || true)
    has_spawn=$(grep -cE '\bspawn\(|\bexec\(|child_process' "$file" 2>/dev/null || true)
    has_socket=$(grep -cE '\bnet\.Socket\(|\.connect\(' "$file" 2>/dev/null || true)

    # Each route handler emits one row, classified by the dominant op.
    for method in GET POST PUT PATCH DELETE; do
      if grep -qE "export\s+async\s+function\s+${method}\b" "$file"; then
        line=$(grep -nE "export\s+async\s+function\s+${method}\b" "$file" | head -1 | cut -d: -f1)
        # Pre-compute whether this route is a sanctioned shadow exception.
        # The route's effective URL is "/api" + the path we already derived.
        route_url="/api${page}"
        sanctioned=0
        is_sanctioned_shadow "$route_url" && sanctioned=1

        if [[ "$has_pg" -gt 0 ]]; then
          kind="psql-direct"
          status="black"
          gap="Critical: pg-direct from Next.js. Migrate to /_site/* Go handler. Frontend caller switches to apiSite."
          path="(pg query — see file)"
        elif [[ "$has_fs" -gt 0 ]]; then
          if [[ "$sanctioned" -eq 1 ]]; then
            kind="sanctioned-shadow"
            status="green"
            gap="Sanctioned shadow handler: filesystem reads only, no DB touch. Exempted per docs/c_c_shadow_backend_exceptions.md."
          else
            kind="fs-only"
            status="green"
            gap=""
          fi
          path="(filesystem reads)"
        elif [[ "$has_spawn" -gt 0 ]]; then
          if [[ "$sanctioned" -eq 1 ]]; then
            kind="sanctioned-shadow"
            status="green"
            gap="Sanctioned shadow handler: child_process spawn only, no DB touch. Exempted per docs/c_c_shadow_backend_exceptions.md."
          else
            kind="fs-only"
            status="green"
            gap=""
          fi
          path="(child_process spawn)"
        elif [[ "$has_socket" -gt 0 ]]; then
          if [[ "$sanctioned" -eq 1 ]]; then
            kind="sanctioned-shadow"
            status="green"
            gap="Sanctioned shadow handler: TCP health probe only, no DB touch. Exempted per docs/c_c_shadow_backend_exceptions.md."
          else
            kind="curl-internal"
            status="green"
            gap=""
          fi
          path="(TCP probe)"
        else
          kind="fs-only"
          status="grey"
          gap="Unknown handler type; inspect manually."
          path="(unknown)"
        fi
        group="$(group_for "$rel")"
        sub=$(echo "$page" | tr '/' '.')
        emit "${group}${sub}" "$page" "${rel}:${line}" "route-handler" "$path" "$method" "$kind" "$status" "$gap" \
          "$(trim "$(sed -n "${line}p" "$file")")"
      fi
    done
  done
fi

# ─── Pass 5: Scripts — psql / pg_dump / curl ──────────────────────────────────

if [[ -d "$REPO_ROOT/dev/scripts" ]]; then
  find "$REPO_ROOT/dev/scripts" -type f \( -name "*.sh" -o -name "*.py" -o -name "*.ts" \) ! -name "audit_api_touchpoints.sh" 2>/dev/null | while read -r file; do
    rel=${file#$REPO_ROOT/}

    # psql calls
    grep -nE '\bpsql\b' "$file" 2>/dev/null | while IFS=: read -r line content; do
      kind="psql-direct"
      status="black"
      gap="Ops script bypasses backend. If READ-only diagnostic, document exception; else add /_site/admin/dev/<area> endpoint."
      # backup script is sanctioned
      if echo "$content" | grep -qE '\bpg_dump\b'; then
        kind="pg-dump-sanctioned"; status="green"; gap=""
      fi
      # If the script is one of the known sanctioned ones, downgrade.
      # Sanctioned categories:
      #   - backup tooling (backup-on-push, c_db-backup)
      #   - migration dry-run (dry_run_migration)
      #   - cookbook harvest (cookbook_harvest)
      #   - one-shot pre-migration audit (audit_field_library_orphans)
      #   - ops scripts that diagnose the DB infra itself (ssh_manager
      #     for pg_stat_statements check + tunnel health, cross_db_canary
      #     for FK integrity sweep, capture_role_grants for seed regen)
      # All READ-only. None are invoked by site code paths.
      case "$file" in
        *backup-on-push.sh|*c_db-backup*|*dry_run_migration*|*cookbook_harvest*|*audit_field_library_orphans*|*ssh_manager.sh|*cross_db_canary.sh|*capture_role_grants.sh)
          status="green"; kind="pg-dump-sanctioned"
          gap="Sanctioned ops/diagnostic script: READ-only psql, not invoked from site code paths. Same exemption class as backup tooling." ;;
      esac
      emit "DEV-SCRIPT.$(basename "$file" .sh)" "$(basename "$file")" "${rel}:${line}" "psql" "(see script)" "EXEC" "$kind" "$status" "$gap" "$(trim "$content")"
    done

    # pg_dump
    grep -nE '\bpg_dump\b' "$file" 2>/dev/null | while IFS=: read -r line content; do
      emit "DEV-SCRIPT.$(basename "$file" .sh)" "$(basename "$file")" "${rel}:${line}" "pg_dump" "(backup)" "EXEC" \
        "pg-dump-sanctioned" "green" "" "$(trim "$content")"
    done

    # curl against localhost:5100 (the Go API) — sanctioned
    grep -nE 'curl\s+[^|]*localhost:5100' "$file" 2>/dev/null | while IFS=: read -r line content; do
      emit "DEV-SCRIPT.$(basename "$file" .sh)" "$(basename "$file")" "${rel}:${line}" "curl" \
        "$(echo "$content" | grep -oE 'localhost:5100[^"'"'"' ]*' | head -1)" "MIXED" \
        "curl-internal" "green" "" "$(trim "$content")"
    done
  done
fi

# ─── Pass 6: Skills that EXECUTE psql in a fenced bash code block ─────────────
#
# Pre-refactor we grepped any `psql`/`PGPASSWORD` line in a skill body,
# which flagged skills that merely DOCUMENT psql in prose (e.g. an
# error-handling note saying "Per HARD RULE do not run psql directly").
# Now we only count lines that live inside a ```bash / ```sh fenced
# code block — i.e. commands the skill actually runs.
#
# An awk state machine tracks the in-fence state across the file and
# emits "LINE:CONTENT" for matching lines.

for d in "$REPO_ROOT/.claude/skills" "$REPO_ROOT/.claude/commands"; do
  [[ -d "$d" ]] || continue
  find "$d" -name "*.md" -type f 2>/dev/null | while read -r file; do
    rel=${file#$REPO_ROOT/}

    matches=$(awk '
      /^```bash$|^```sh$|^```zsh$/ { in_fence = 1; next }
      /^```$/                       { in_fence = 0; next }
      in_fence && /(^|[[:space:]])psql[[:space:]]|^[[:space:]]*PGPASSWORD=/ {
        print NR ":" $0
      }
    ' "$file" 2>/dev/null)

    [[ -z "$matches" ]] && continue

    line=$(echo "$matches" | head -1 | cut -d: -f1)
    case "$file" in
      # Sanctioned skills: backup tooling, migration scaffolding,
      # diagnostic-only gadmin commands. All READ-only; none mutate
      # tenant data. Same justification as the shadow-backend
      # exemption (docs/c_c_shadow_backend_exceptions.md): the SOC2
      # rule targets site-UI code paths, not gadmin-only ops tools.
      */c_db-backup.md|*/c_cookbook.md|*/migration/SKILL.md|*/c_services.md|*/c_accounts.md)
        status="green"; kind="pg-dump-sanctioned"; gap="Sanctioned diagnostic skill: READ-only psql, gadmin-only invocation." ;;
      *)
        status="red"; kind="psql-direct"
        gap="Skill body runs psql in a code fence. Migrate to /_site/admin/dev/<area> endpoint + curl from skill." ;;
    esac
    emit "SKILL.$(basename "$(dirname "$file")")" "$(basename "$file" .md)" "${rel}:${line}" "psql" "(skill body)" "EXEC" \
      "$kind" "$status" "$gap" "Skill executes psql in a fenced code block"
  done
done

# Pass 7 (backend route inventory) intentionally omitted.
# chi's nested r.Route() prefixes are not visible at each r.Get/Post line —
# parsing them correctly needs a stateful walk of main.go (chi router
# context tracking). For now the audit focuses on FRONTEND + SCRIPTS +
# SHADOW BACKEND, which is where the rule-enforcement value is.
# Backend route compliance is tracked separately in c_c_transport_segregation.md.

# ─── Build final JSON with sequential IDs ─────────────────────────────────────

jq -s 'to_entries | map(.value + {id: (.key + 1)})' "$TMP" > "$OUT"

# ─── Summary to stderr ────────────────────────────────────────────────────────

TOTAL=$(jq 'length' "$OUT")
GREEN=$(jq '[.[] | select(.status=="green")] | length' "$OUT")
YELLOW=$(jq '[.[] | select(.status=="yellow")] | length' "$OUT")
RED=$(jq '[.[] | select(.status=="red")] | length' "$OUT")
BLACK=$(jq '[.[] | select(.status=="black")] | length' "$OUT")
GREY=$(jq '[.[] | select(.status=="grey")] | length' "$OUT")

echo "API touchpoint audit complete." >&2
echo "  Total: $TOTAL" >&2
echo "  Green (compliant): $GREEN" >&2
echo "  Yellow (warn):     $YELLOW" >&2
echo "  Red (bypass):      $RED" >&2
echo "  Black (pg-direct): $BLACK" >&2
echo "  Grey (unknown):    $GREY" >&2
echo "Snapshot: $OUT" >&2
