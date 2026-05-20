#!/usr/bin/env bash
# audit_role_page_grants.sh — PLA-0053 (B5.15)
#
# Lists every (role, page) grant in users_roles_pages grouped by tag
# bucket. Used to surface stray grants — e.g. a Team Member with grants
# under admin tags they shouldn't have — before relying on the single
# users_roles_pages gate as the sole page-access authority.
#
# Writes a markdown + json snapshot to dev/audits/role-page-grants.{md,json}.
#
# Read-only: only SELECT queries.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$REPO_ROOT/backend/.env.dev"
OUT_MD="$REPO_ROOT/dev/audits/role-page-grants.md"
OUT_JSON="$REPO_ROOT/dev/audits/role-page-grants.json"

mkdir -p "$REPO_ROOT/dev/audits"

if [[ ! -f "$ENV_FILE" ]]; then
    echo "missing $ENV_FILE" >&2
    exit 1
fi

# Load DB creds from backend/.env.dev (avoid printing to stderr).
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

PSQL_BIN=""
for candidate in psql /opt/homebrew/Cellar/libpq/*/bin/psql /usr/local/opt/libpq/bin/psql; do
    if command -v "$candidate" >/dev/null 2>&1 || [[ -x "$candidate" ]]; then
        PSQL_BIN="$candidate"
        break
    fi
done
if [[ -z "$PSQL_BIN" ]]; then
    echo "psql not found on PATH or in expected locations" >&2
    exit 1
fi

run_query() {
    PGPASSWORD="$DB_PASSWORD" "$PSQL_BIN" \
        -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -At -F$'\t' -c "$1"
}

# Markdown output — per-role bucket breakdown.
{
    echo "# Role × Page-Grant Audit"
    echo
    echo "_Generated: $(date '+%Y-%m-%d %H:%M:%S')_"
    echo
    echo "Snapshot of every \`users_roles_pages\` row, grouped by role and tag bucket."
    echo "Useful for sanity-checking what each role can actually reach via the nav rail"
    echo "(PLA-0053 / B5.15 — single-gate validation)."
    echo
    echo "## Grants by role × bucket"
    echo
    echo "| Role | Tag bucket | # pages | Pages |"
    echo "|---|---|---:|---|"

    run_query "
        SELECT r.users_roles_label,
               COALESCE(p.tag_enum, '(none)'),
               COUNT(*) AS n,
               string_agg(p.key_enum, ', ' ORDER BY p.key_enum)
          FROM users_roles_pages rp
          JOIN users_roles r ON r.users_roles_id = rp.users_roles_pages_id_role
          JOIN pages p       ON p.id            = rp.users_roles_pages_id_page
         WHERE r.users_roles_id_subscription IS NULL  -- system roles only
           AND p.created_by IS NULL
           AND p.subscription_id IS NULL
         GROUP BY r.users_roles_label, p.tag_enum
         ORDER BY r.users_roles_label, p.tag_enum;
    " | while IFS=$'\t' read -r role bucket n pages; do
        echo "| $role | \`$bucket\` | $n | $pages |"
    done

    echo
    echo "## Possible drift — non-admin roles with admin-tag grants"
    echo
    echo "If you see a Team-Member-tier role listed under \`vector_admin\`, \`user_management\`,"
    echo "\`workspace_admin\`, or \`dev_tools\` and that wasn't an explicit grant from the"
    echo "permissions matrix at \`/user-management/permissions\`, treat it as a seed-drift bug."
    echo "After PLA-0053 there is no tier filter hiding it — what the table says is what users see."
    echo
    echo "| Role | Admin bucket | # pages |"
    echo "|---|---|---:|"

    run_query "
        SELECT r.users_roles_label,
               p.tag_enum,
               COUNT(*) AS n
          FROM users_roles_pages rp
          JOIN users_roles r ON r.users_roles_id = rp.users_roles_pages_id_role
          JOIN pages p       ON p.id            = rp.users_roles_pages_id_page
         WHERE r.users_roles_id_subscription IS NULL
           AND r.users_roles_code NOT IN ('grp_global', 'grp_portfolio')
           AND p.tag_enum IN ('vector_admin', 'user_management', 'workspace_admin', 'dev_tools')
           AND p.created_by IS NULL
           AND p.subscription_id IS NULL
         GROUP BY r.users_roles_label, p.tag_enum
         ORDER BY r.users_roles_label, p.tag_enum;
    " | while IFS=$'\t' read -r role bucket n; do
        echo "| $role | \`$bucket\` | $n |"
    done
} > "$OUT_MD"

# JSON output — same data, machine-readable.
run_query "
    SELECT json_agg(row_to_json(t))
      FROM (
        SELECT r.users_roles_code AS role_code,
               r.users_roles_label AS role_label,
               p.tag_enum,
               p.key_enum,
               p.label AS page_label
          FROM users_roles_pages rp
          JOIN users_roles r ON r.users_roles_id = rp.users_roles_pages_id_role
          JOIN pages p       ON p.id            = rp.users_roles_pages_id_page
         WHERE r.users_roles_id_subscription IS NULL
           AND p.created_by IS NULL
           AND p.subscription_id IS NULL
         ORDER BY r.users_roles_label, p.tag_enum, p.key_enum
      ) t;
" > "$OUT_JSON"

echo "Wrote $OUT_MD"
echo "Wrote $OUT_JSON"
