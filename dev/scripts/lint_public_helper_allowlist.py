#!/usr/bin/env python3
"""Lint public-helper-allowlist: structural rule for PLA-0039 / Story 00523.

Rule: every file that calls `apiV2(` (the customer-public surface at
`/samantha/v2`) MUST be listed in
`dev/registries/public_helper_allowlist.json` (`allowed_paths`).

`apiV2()` is the helper for the public, deprecation-bound, billed customer
API. Internal app features must NOT silently leak into that surface — they
go through `apiSite()` (BFF, /_site) instead. This lint is the one-line
ratchet that catches a new `apiV2` call before it lands.

Every new entry to `allowed_paths` is a vetted decision:
  • The route exists in the OpenAPI v2 spec.
  • The response is a stable DTO with a `MapPublic` mapper (Story 00532).
  • The work has been considered for SOC 2 audit-event emission.

Exit 0 = clean. Exit 1 = one or more apiV2 callers not on the allow-list.
Output is line-oriented for the Reports panel (renders as
"public-helper-allowlist" row).
"""
from __future__ import annotations
import datetime as _dt
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
ALLOWLIST = ROOT / "dev" / "registries" / "public_helper_allowlist.json"
SCAN_DIRS = ["app"]

# Match `apiV2(` or `apiV2<…>(` as a call — TS generic invocations are
# common (e.g. `apiV2<{items: T[]}>(...)`) so the optional `<…>` block
# must be tolerated. Guard against `apiV2Foo(` / `myApiV2(` with a
# non-identifier char on the left. Also match `import { apiV2 ` / re-exports
# so api.ts itself is required to be on the allow-list (def is a use).
APIV2_CALL_RE = re.compile(
    r"(?:^|[^A-Za-z0-9_$])apiV2(?:\s*<[^;]{0,200}?>)?\s*\("
)
APIV2_NAME_RE = re.compile(r"(?:^|[^A-Za-z0-9_$])apiV2(?![A-Za-z0-9_$])")


def load_allowlist() -> set[str]:
    if not ALLOWLIST.exists():
        return set()
    data = json.loads(ALLOWLIST.read_text())
    return {str(p) for p in data.get("allowed_paths", [])}


def scan() -> list[pathlib.Path]:
    hits: list[pathlib.Path] = []
    for sub in SCAN_DIRS:
        base = ROOT / sub
        if not base.exists():
            continue
        for ext in ("*.tsx", "*.ts"):
            for path in base.rglob(ext):
                if "node_modules" in path.parts or ".next" in path.parts:
                    continue
                if path.name.endswith(".d.ts"):
                    continue
                # api.ts itself defines apiV2 — let it through unconditionally
                # by including it in the allow-list rather than by special-case.
                try:
                    text = path.read_text(errors="ignore")
                except OSError:
                    continue
                # Match the symbol, not just call syntax — TS generics
                # (`apiV2<T>(`), imports, and re-exports must all show up.
                if APIV2_NAME_RE.search(text):
                    hits.append(path)
    return hits


def write_report(hits: list[pathlib.Path], allowed: set[str]) -> None:
    reports_dir = ROOT / "dev" / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    now = _dt.datetime.now()
    ts_id = now.strftime("%Y%m%d-%H%M%S") + "-public-helper-allowlist"

    checks = []
    for p in hits:
        rel = str(p.relative_to(ROOT))
        if rel in allowed:
            checks.append({
                "status": "pass",
                "label": rel,
                "detail": "allow-listed apiV2 caller",
            })
        else:
            checks.append({
                "status": "fail",
                "label": rel,
                "detail": "apiV2() caller not on allow-list — add to public_helper_allowlist.json after vet",
            })

    if not hits:
        checks.append({
            "status": "pass",
            "label": "lint:public-helper-allowlist",
            "detail": "no apiV2 callers found",
        })

    summary = {
        "pass": sum(1 for c in checks if c["status"] == "pass"),
        "warn": sum(1 for c in checks if c["status"] == "warn"),
        "fail": sum(1 for c in checks if c["status"] == "fail"),
        "fixed": 0,
    }

    report = {
        "id": ts_id,
        "scope": "H",
        "scopeName": "public-helper-allowlist",
        "flag": "lint:public-helper-allowlist",
        "timestamp": now.replace(microsecond=0).isoformat(),
        "checks": checks,
        "summary": summary,
    }

    out = reports_dir / f"{ts_id}.json"
    out.write_text(json.dumps(report, indent=2) + "\n")


def main() -> int:
    allowed = load_allowlist()
    hits = scan()

    if "--report" in sys.argv[1:]:
        write_report(hits, allowed)

    rels = [str(p.relative_to(ROOT)) for p in hits]
    failing = [r for r in rels if r not in allowed]

    if not failing:
        print(
            f"[lint:public-helper-allowlist] OK — {len(hits)} apiV2 caller(s), "
            f"all allow-listed ({len(allowed)} allow-listed path(s))."
        )
        return 0

    print(
        f"[lint:public-helper-allowlist] FAIL — {len(failing)} apiV2 caller(s) "
        f"not on allow-list:"
    )
    for rel in failing:
        print(
            f"  {rel}: add to dev/registries/public_helper_allowlist.json after vet "
            f"(OpenAPI v2 + MapPublic + audit-event review)"
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
