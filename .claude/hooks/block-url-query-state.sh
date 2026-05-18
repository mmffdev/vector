#!/usr/bin/env bash
# PreToolUse hook — refuses Edit/Write/MultiEdit that introduces URL-bar
# query state into a frontend route. Enforces feedback_url_is_path_only
# (PLA-0053): the user-visible URL is path-only. Filters, sort, scope,
# vid, workspaceID, etc. all live in user-profile + React state, never
# in the address bar.
#
# This hook stops Claude from drifting back to `router.push("/x?y=z")`
# / `useSearchParams` / `<Link href="...?...">` patterns.
#
# ─── What this hook BLOCKS (frontend route state via URL) ───
#   router.push("/foo?bar=baz")          ← any ? in router.push path
#   router.replace("/foo?bar=baz")       ← same for replace/prefetch
#   <Link href="/foo?bar=baz">           ← Link with query
#   useSearchParams                      ← reading URL query in app/
#   new URLSearchParams(window.location… ← reading URL query directly
#   searchParams.set / append / delete   ← mutating URL query
#
# ─── What this hook DOES NOT block (the wire surface) ───
#   apiSite("/portfolio-items?scope=…")  ← fetch query, Go reads it
#   api/apiV2/apiRoot                    ← same
#   anything in backend/**/*.go          ← Go reads q.Get("scope")
#   app/lib/**                           ← fetch-helper itself
#   anything outside app/**/*.tsx|*.ts   ← not a route surface

set -u

PAYLOAD=$(cat)

# Python parses the JSON payload; emit three fields separated by ASCII
# Unit Separator (\x1F) which won't appear in real source code. Bash's
# `$()` strips NUL bytes, hence \x1F instead of \0.
read -r -d '' PY <<'PY' || true
import json, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.stdout.write("\x1f\x1f")
    sys.exit(0)
tool = d.get("tool_name", "") or ""
inp = d.get("tool_input", {}) or {}
fp = inp.get("file_path", "") or ""
chunks = []
ns = inp.get("new_string")
if isinstance(ns, str):
    chunks.append(ns)
co = inp.get("content")
if isinstance(co, str):
    chunks.append(co)
edits = inp.get("edits") or []
if isinstance(edits, list):
    for e in edits:
        if isinstance(e, dict):
            ns2 = e.get("new_string")
            if isinstance(ns2, str):
                chunks.append(ns2)
sys.stdout.write(tool + "\x1f" + fp + "\x1f" + "\n".join(chunks))
PY

OUT=$(python3 -c "$PY" "$PAYLOAD" 2>/dev/null)

TOOL=$(printf '%s' "$OUT" | awk -v RS=$'\x1f' 'NR==1{print; exit}')
FILE_PATH=$(printf '%s' "$OUT" | awk -v RS=$'\x1f' 'NR==2{print; exit}')
NEW_TEXT=$(printf '%s' "$OUT" | awk -v RS=$'\x1f' 'NR>=3{print}')

case "$TOOL" in
  Edit|Write|MultiEdit) ;;
  *) exit 0 ;;
esac

[[ -z "$FILE_PATH" ]] && exit 0

# Only frontend route surfaces.
case "$FILE_PATH" in
  *"/app/"*.tsx|*"/app/"*.ts) ;;
  *) exit 0 ;;
esac

# Exempt the fetch-helper itself and lib code that legitimately assembles
# wire requests.
case "$FILE_PATH" in
  *"/app/lib/"*) exit 0 ;;
esac

# Per-file annotation exemption (PLA-0053 — feedback_url_is_path_only).
# A file may carry `// hook-allow-url-query: <reason>` within the first
# 20 lines to exempt itself from the checks below. Used for files that
# legitimately handle URL query state — inbound auth-callback routes
# that read a one-shot ?token=, or work-in-progress refactors that are
# removing existing URL writes (the hook would otherwise block edits
# to the very offenders we want gone).
#
# Audit the active exemptions any time with:
#   grep -rln 'hook-allow-url-query' app/
#
# The annotation must include a non-empty reason after the colon —
# the reason is the paper trail. Files without the annotation are
# subject to the normal checks.
# For existing files: read the on-disk content (the annotation is what's
# already there). For new files (Write tool): read the NEW content
# being written. Either path can declare the exemption.
ANNOTATION_HAYSTACK=""
if [[ -f "$FILE_PATH" ]]; then
  ANNOTATION_HAYSTACK=$(head -n 20 "$FILE_PATH" 2>/dev/null)
else
  # New file — the annotation must appear in the first 20 lines of the
  # content being written.
  ANNOTATION_HAYSTACK=$(printf '%s' "$NEW_TEXT" | head -n 20)
fi
if printf '%s' "$ANNOTATION_HAYSTACK" \
     | grep -qE '^\s*//\s*hook-allow-url-query:\s*\S'; then
  exit 0
fi

[[ -z "$NEW_TEXT" ]] && exit 0

BLOCKED=()

# router.push/replace/prefetch with `?` in the path arg (string or template).
if printf '%s' "$NEW_TEXT" | grep -qE 'router\.(push|replace|prefetch)\([[:space:]]*["`'\''][^"`'\'']*\?'; then
  BLOCKED+=("router.push/replace/prefetch with a query string in the path")
fi

# <Link href="/foo?x=y">  (JSX prop)
if printf '%s' "$NEW_TEXT" | grep -qE '<Link\b[^>]*href=["`'\''][^"`'\'']*\?'; then
  BLOCKED+=("<Link href=\"...?...\"> — query in route prop")
fi

# useSearchParams
if printf '%s' "$NEW_TEXT" | grep -qE '\buseSearchParams\b'; then
  BLOCKED+=("useSearchParams — URL query reads are dead (PLA-0053)")
fi

# new URLSearchParams(window.location…)
if printf '%s' "$NEW_TEXT" | grep -qE 'new[[:space:]]+URLSearchParams\([^)]*window\.location'; then
  BLOCKED+=("new URLSearchParams(window.location...) — address-bar query read")
fi

# router.push/replace/prefetch with templated `?` inside backticks.
if printf '%s' "$NEW_TEXT" | grep -qE 'router\.(push|replace|prefetch)\([^)]*`[^`]*\?'; then
  BLOCKED+=("router.push/replace/prefetch with a templated query string")
fi

# searchParams.set / .append / .delete (mutating)
if printf '%s' "$NEW_TEXT" | grep -qE '\bsearchParams\.(set|append|delete)\('; then
  BLOCKED+=("searchParams.set/append/delete — mutating URL query")
fi

[[ ${#BLOCKED[@]} -eq 0 ]] && exit 0

# Surface the rejection.
REL="${FILE_PATH##*/MMFFDev - Vector/}"
{
  echo "BLOCK_URL_QUERY_STATE — refused edit to $REL"
  echo
  echo "Pattern(s) detected:"
  for line in "${BLOCKED[@]}"; do
    echo "  • $line"
  done
  echo
  echo "Rule: the user-visible URL is path-only (feedback_url_is_path_only,"
  echo "PLA-0053). Filter, sort, scope, vid, etc. live in user profile +"
  echo "React state, never in the address bar."
  echo
  echo "If you're reading query params off a WIRE request (Go handler,"
  echo "or the apiSite() fetch helper assembling a request), that is NOT"
  echo "what this rule covers — but those edits don't happen in app/**/*.tsx."
  echo
  echo "Common right answers:"
  echo "  • Filter state    → useState (ephemeral) or per-user backend pref"
  echo "  • Shareable view  → declare in app/lib/shareableParams.ts SHAREABLE_PARAMS"
  echo "                      and add hook-allow-url-query annotation (TD-URL-SHAREABLE-VIEWS)"
  echo "  • Deep link       → route segment, e.g. /work-items/abc-123"
  echo "  • Wizard / view   → route segment or component state"
  echo "  • Scope identity  → users.active_scope_node_id (server) + ScopeContext"
  echo
  echo "If this hook is wrong about your edit, surface it in chat — Rick"
  echo "decides whether the rule has an exception, not Claude."
} >&2

exit 2
