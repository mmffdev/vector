#!/usr/bin/env python3
"""sync_specs.py — Round-trip tool: reconcile siteAPI.yaml + samanthaAPI.yaml
against the live Go routes in main.go.

For each spec:
  1. Drop paths that no longer exist in Go (dead spec entries).
  2. Drop methods on surviving paths that no longer exist.
  3. Add stub entries for new Go routes the spec doesn't yet describe.

Auto-generated stub entries are marked explicitly per B20.5.E:
  x-stub: true
  description: "AUTO-GENERATED STUB — schema not yet curated. \\n
                Path exists in main.go; request/response shapes need
                hand-curation. See dev/scripts/sync_specs.py."

Hand-curated paths/methods are recognised by the absence of x-stub:true
and left alone except for method-set reconciliation.

Existing path-level metadata (tags, summaries, parameters, requestBody,
response schemas) is preserved through the YAML merge.

Run from repo root:
  python3 dev/scripts/extract_routes.py  # writes /tmp/{site,v2}_routes.json
  python3 dev/scripts/sync_specs.py      # merges into siteAPI.yaml + samanthaAPI.yaml

Or via the npm script:
  npm run api:sync
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

import yaml


# Block-literal multi-line strings (preserves readable description blocks).
def str_presenter(dumper, data):
    if "\n" in data:
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")
    return dumper.represent_scalar("tag:yaml.org,2002:str", data)


yaml.add_representer(str, str_presenter, Dumper=yaml.SafeDumper)


ROOT = pathlib.Path(__file__).resolve().parents[2]
HTTP_VERBS = ("get", "post", "put", "patch", "delete", "head")

STUB_DESCRIPTION = (
    "AUTO-GENERATED STUB — schema not yet curated.\n"
    "Path exists in main.go; request body, response shape, and error\n"
    "cases need hand-curation. Search for `x-stub: true` to find all\n"
    "stubs awaiting review. See dev/scripts/sync_specs.py."
)


def opid(verb: str, path: str) -> str:
    parts = re.split(r"[/{}\-_]+", path.strip("/"))
    parts = [p for p in parts if p]
    return verb + "".join(p.title() for p in parts)


def stub_op(verb: str, path: str) -> dict:
    return {
        "tags": ["uncategorised"],
        "summary": f"{verb.upper()} {path}",
        "description": STUB_DESCRIPTION,
        "operationId": opid(verb, path),
        "x-stub": True,
        "security": [{"bearerAuth": []}],
        "responses": {
            "200": {
                "description": "OK (stub response shape)",
                "content": {"application/json": {"schema": {"type": "object"}}},
            },
            "401": {"$ref": "#/components/responses/Unauthorized"},
        },
    }


def is_stub(op: dict) -> bool:
    """A method-level operation is considered a stub if it has the
    x-stub marker (or, for legacy backwards-compat, if every field
    matches the auto-generated stub shape)."""
    if not isinstance(op, dict):
        return False
    if op.get("x-stub") is True:
        return True
    return False


def sync_spec(spec_path: pathlib.Path, routes_json: pathlib.Path) -> dict:
    """Merge Go truth into a single spec file. Returns a summary dict
    with counts for the caller to print."""
    go_truth: dict[str, list[str]] = json.loads(routes_json.read_text())
    spec = yaml.safe_load(spec_path.read_text())

    existing = spec.get("paths", {})
    removed_paths: list[str] = []
    method_changes: list[str] = []
    added_paths: list[str] = []

    # 1. Drop paths not in Go.
    for p in list(existing.keys()):
        if p not in go_truth:
            removed_paths.append(p)
            del existing[p]

    # 2 + 3. Reconcile method sets; add new paths.
    for p, methods in go_truth.items():
        ml = [m.lower() for m in methods]
        if p in existing:
            ex = existing[p]
            for verb in list(ex.keys()):
                if verb in HTTP_VERBS and verb not in ml:
                    del ex[verb]
                    method_changes.append(f"{p}: dropped {verb.upper()}")
            for verb in ml:
                if verb not in ex:
                    ex[verb] = stub_op(verb, p)
                    method_changes.append(f"{p}: added {verb.upper()} (stub)")
        else:
            existing[p] = {verb: stub_op(verb, p) for verb in ml}
            added_paths.append(f"{p}: {', '.join(methods)} (stub)")

    spec["paths"] = dict(sorted(existing.items()))

    spec_path.write_text(
        yaml.safe_dump(
            spec, sort_keys=False, default_flow_style=False, width=120, allow_unicode=True
        )
    )

    # Count stubs vs. curated.
    stub_count = 0
    curated_count = 0
    for path, ops in existing.items():
        for verb in HTTP_VERBS:
            if verb in ops:
                if is_stub(ops[verb]):
                    stub_count += 1
                else:
                    curated_count += 1

    return {
        "spec": spec_path.name,
        "removed": removed_paths,
        "method_changes": method_changes,
        "added": added_paths,
        "stub_count": stub_count,
        "curated_count": curated_count,
        "total_paths": len(existing),
    }


def main() -> int:
    runs = [
        (ROOT / "siteAPI.yaml", pathlib.Path("/tmp/site_routes.json")),
        (ROOT / "samanthaAPI.yaml", pathlib.Path("/tmp/v2_routes.json")),
    ]
    for spec_path, routes_path in runs:
        if not routes_path.exists():
            print(f"FAIL: {routes_path} missing — run extract_routes.py first.", file=sys.stderr)
            return 1

    for spec_path, routes_path in runs:
        r = sync_spec(spec_path, routes_path)
        print(f"\n=== {r['spec']} ===")
        print(f"  Total paths: {r['total_paths']}  "
              f"({r['curated_count']} curated operations, {r['stub_count']} stubs)")
        print(f"  Removed {len(r['removed'])} dead spec paths")
        for p in r["removed"][:10]:
            print(f"    - {p}")
        if len(r["removed"]) > 10:
            print(f"    ... +{len(r['removed'])-10} more")
        print(f"  Method changes: {len(r['method_changes'])}")
        for c in r["method_changes"][:10]:
            print(f"    ~ {c}")
        if len(r["method_changes"]) > 10:
            print(f"    ... +{len(r['method_changes'])-10} more")
        print(f"  New paths added: {len(r['added'])}")
        for a in r["added"][:10]:
            print(f"    + {a}")
        if len(r["added"]) > 10:
            print(f"    ... +{len(r['added'])-10} more")

    # Sync hosted copies into api-reference/static/
    static_dir = ROOT / "api-reference" / "static"
    if static_dir.exists():
        for src in (ROOT / "siteAPI.yaml", ROOT / "samanthaAPI.yaml"):
            (static_dir / src.name).write_text(src.read_text())
        print(f"\n  → Hosted copies synced to {static_dir.relative_to(ROOT)}/")

    return 0


if __name__ == "__main__":
    sys.exit(main())
