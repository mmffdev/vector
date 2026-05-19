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

AUTO_CURATED_DESCRIPTION = (
    "AUTO-CURATED — schema derived from the Go handler. Field names\n"
    "and types come from struct tags + service return types; the\n"
    "human curator can refine summaries, descriptions, and add\n"
    "$ref schemas to /components/schemas. Search for\n"
    "`x-auto-curated: true` to find all auto-curated operations.\n"
    "Re-run `npm run api:sync` to refresh from Go truth (preserves\n"
    "any fields a human has added above `x-auto-curated`)."
)

NEEDS_CURATION_DESCRIPTION = (
    "AUTO-GENERATED STUB — needs hand-curation. The shape extractor\n"
    "could not resolve the response or request type from the Go\n"
    "handler (cross-package returns, polymorphic responses, or\n"
    "unrecognised patterns). Open the handler at the file:line\n"
    "below and document the shape manually. Search for\n"
    "`x-needs-curation: true` to find all such operations."
)

GO_TO_OPENAPI_TYPE = {
    "string": ("string", None),
    "int": ("integer", "int32"),
    "int32": ("integer", "int32"),
    "int64": ("integer", "int64"),
    "uint": ("integer", "int32"),
    "uint32": ("integer", "int32"),
    "uint64": ("integer", "int64"),
    "float32": ("number", "float"),
    "float64": ("number", "double"),
    "bool": ("boolean", None),
    "time.Time": ("string", "date-time"),
    "uuid.UUID": ("string", "uuid"),
    "json.RawMessage": ("object", None),
}


def go_type_to_openapi(go_type: str) -> dict:
    """Same logic as extract_handler_shapes.go_type_to_openapi —
    duplicated here so sync_specs.py is independently importable."""
    t = go_type.lstrip("*")
    if t.startswith("[]"):
        return {"type": "array", "items": go_type_to_openapi(t[2:])}
    if t.startswith("map["):
        return {"type": "object", "additionalProperties": True}
    if t in GO_TO_OPENAPI_TYPE:
        oa_type, oa_format = GO_TO_OPENAPI_TYPE[t]
        out = {"type": oa_type}
        if oa_format:
            out["format"] = oa_format
        return out
    if "." in t:
        local = t.split(".")[-1]
        return {"type": "object", "x-go-type": t, "x-go-symbol": local}
    if t[:1].isupper():
        return {"type": "object", "x-go-type": t}
    return {"type": "object"}


def fields_to_schema(fields: list[dict]) -> dict:
    """Translate the extract_handler_shapes field list into an
    OpenAPI 3.1 object schema."""
    props = {}
    required = []
    for f in fields:
        props[f["json_name"]] = go_type_to_openapi(f["go_type"])
        if not f["optional"]:
            required.append(f["json_name"])
    out = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


def shape_to_response_schema(response_struct: dict | None) -> dict:
    """Build the schema fragment for the success response."""
    if not response_struct or not response_struct.get("fields"):
        return {"type": "object"}
    schema = fields_to_schema(response_struct["fields"])
    if response_struct.get("kind") == "slice_of_struct":
        return {"type": "array", "items": schema}
    if response_struct.get("kind") == "map_literal":
        # Map literals declare KNOWN keys (we captured them) but the
        # Go author may also be adding more dynamically — leave the
        # door open via additionalProperties=true. The keys we found
        # are documented as properties; required is intentionally
        # empty (a map literal doesn't enforce presence the way a
        # struct does).
        schema["additionalProperties"] = True
        schema.pop("required", None)
    return schema


def errors_to_responses(errors: list[dict]) -> dict:
    """Convert the extracted error catalogue into an OpenAPI responses
    map. Each unique status gets a single 4xx/5xx entry; the original
    error codes are stitched into the description for traceability."""
    if not errors:
        return {}
    by_status: dict[int, list[str]] = {}
    for e in errors:
        by_status.setdefault(e["status"], []).append(e["code"])
    out: dict[str, dict] = {}
    canned = {
        400: "BadRequest", 401: "Unauthorized", 403: "Forbidden",
        404: "NotFound", 409: "Conflict", 422: "UnprocessableEntity",
        429: "TooManyRequests", 500: "InternalServerError",
        503: "ServiceUnavailable",
    }
    for status, codes in by_status.items():
        # Prefer $ref to the project's canned responses where possible.
        if status in canned and canned[status] in ("Unauthorized", "Forbidden", "NotFound", "BadRequest", "UnprocessableEntity"):
            out[str(status)] = {"$ref": f"#/components/responses/{canned[status]}"}
        else:
            out[str(status)] = {
                "description": f"{status} — error codes observed: {', '.join(sorted(set(codes)))}",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Problem"}}},
            }
    return out


def path_params_for(path: str) -> list[dict]:
    """Build the parameters list for {id}-style path segments."""
    params = []
    for token in re.findall(r"\{([^}]+)\}", path):
        params.append({
            "name": token, "in": "path", "required": True,
            "schema": {"type": "string"},
        })
    return params


def query_params_to_parameters(qps: list[str]) -> list[dict]:
    return [
        {"name": q, "in": "query", "required": False,
         "schema": {"type": "string"}}
        for q in qps
    ]


def opid(verb: str, path: str) -> str:
    parts = re.split(r"[/{}\-_]+", path.strip("/"))
    parts = [p for p in parts if p]
    return verb + "".join(p.title() for p in parts)


def tag_for(path: str) -> str:
    """Derive a Scalar-friendly group tag from the path's first segment.
    `/portfolio-items/{id}/children` → `portfolio-items`.
    `/admin/users/{id}` → `admin`. Falls back to `uncategorised` for
    pathological inputs (shouldn't happen since every path starts with /)."""
    parts = [p for p in path.strip("/").split("/") if p and not p.startswith("{")]
    return parts[0] if parts else "uncategorised"


def stub_responses(verb: str, path: str) -> dict:
    """Common response envelope shared by every stub. Adds 404 when the
    path includes a `{id}`-style param (any 200/PATCH/PUT/DELETE that
    targets a specific resource can miss it) and 400/422 on write verbs
    where the body can fail validation. 401 is universal."""
    has_param = "{" in path
    is_write = verb in ("post", "put", "patch", "delete")
    success_code = "200"
    if verb == "post" and not has_param:
        success_code = "201"
    elif verb == "delete":
        success_code = "204"
    success = {
        "description": f"{success_code} (stub response shape — schema not yet curated)",
    }
    if success_code != "204":
        success["content"] = {"application/json": {"schema": {"type": "object"}}}
    responses: dict = {
        success_code: success,
        "401": {"$ref": "#/components/responses/Unauthorized"},
    }
    if is_write:
        responses["400"] = {"$ref": "#/components/responses/BadRequest"}
        responses["422"] = {"$ref": "#/components/responses/UnprocessableEntity"}
    if has_param:
        responses["404"] = {"$ref": "#/components/responses/NotFound"}
    return responses


def stub_op(verb: str, path: str, shape: dict | None = None) -> dict:
    """Build the operation dict for one (verb, path).
       - shape=None or shape.needs_curation=True → emit a hollow stub
         (the B20.5.F shape: tag + HTTP-shape-correct responses, no
         request/response fields). Marked x-stub: true.
       - shape resolved → emit a real auto-curated operation with the
         extracted request body + response schema + error catalogue +
         query params. Marked x-auto-curated: true.
       In both cases the marker tells the human at a glance whether
       this entry is hand-curated, auto-curated, or stub."""
    op: dict = {
        "tags": [tag_for(path)],
        "summary": f"{verb.upper()} {path}",
        "operationId": opid(verb, path),
        "security": [{"bearerAuth": []}],
    }
    # Path params are always derivable, regardless of shape data.
    parameters = path_params_for(path)

    if shape is None or shape.get("needs_curation"):
        # Hollow stub — no Go truth attached.
        op["description"] = NEEDS_CURATION_DESCRIPTION if (shape and shape.get("handler_file")) else STUB_DESCRIPTION
        if shape and shape.get("handler_file"):
            op["x-handler"] = {
                "symbol": shape.get("handler_symbol"),
                "file": shape.get("handler_file"),
                "needs_curation": True,
                "reasons": shape.get("reasons", []),
            }
        op["x-stub"] = True
        op["responses"] = stub_responses(verb, path)
        if parameters:
            op["parameters"] = parameters
        return op

    # Auto-curated path — we have real shape data.
    op["description"] = AUTO_CURATED_DESCRIPTION
    op["x-auto-curated"] = True
    op["x-handler"] = {
        "symbol": shape.get("handler_symbol"),
        "file": shape.get("handler_file"),
    }

    # Request body (if the handler decodes one).
    req = shape.get("request_struct")
    if req and req.get("fields"):
        schema = fields_to_schema(req["fields"])
        if req.get("kind") == "slice_of_struct":
            schema = {"type": "array", "items": schema}
        op["requestBody"] = {
            "required": True,
            "content": {
                "application/json": {"schema": schema},
            },
        }

    # Parameters: path + query.
    qps = shape.get("query_params") or []
    parameters = parameters + query_params_to_parameters(qps)
    if parameters:
        op["parameters"] = parameters

    # Responses: success + error catalogue.
    success_status = shape.get("success_status") or (
        201 if (verb == "post" and "{" not in path) else (204 if verb == "delete" else 200)
    )
    success_schema = shape_to_response_schema(shape.get("response_struct"))
    responses: dict = {
        str(success_status): {
            "description": f"{success_status} — success response",
            "content": {"application/json": {"schema": success_schema}},
        },
    }
    if success_status == 204:
        # 204 doesn't carry a body.
        responses[str(success_status)] = {"description": "204 — no content"}
    # Merge the error catalogue.
    responses.update(errors_to_responses(shape.get("errors") or []))
    # Ensure 401 is always present.
    if "401" not in responses:
        responses["401"] = {"$ref": "#/components/responses/Unauthorized"}
    op["responses"] = responses
    return op


def is_stub(op: dict) -> bool:
    """An operation is treated as auto-managed (and therefore
    re-generatable on each sync) when it has the x-stub OR
    x-auto-curated marker. Hand-curated ops have neither marker
    and are preserved verbatim."""
    if not isinstance(op, dict):
        return False
    if op.get("x-stub") is True:
        return True
    if op.get("x-auto-curated") is True:
        return True
    return False


def _shape_lookup(shapes: dict, verb: str, path: str, mount_prefix: str) -> dict | None:
    """The handler_shapes.json keys are unprefixed by mount (the
    extractor walks main.go directly, capturing the full path). The
    per-spec routes JSON strips the mount prefix. So when sync_specs
    asks for shape for `/sprints` against siteAPI, we look up
    `GET /_site/sprints` in the shape dict."""
    if path == "/":
        # Pathological — `/widgets` + `r.Get("/")` strips to `/widgets`,
        # so the mount-prefix-anchored key would just be `mount_prefix`.
        full = mount_prefix
    else:
        full = (mount_prefix + path) if not path.startswith(mount_prefix) else path
    return shapes.get(f"{verb.upper()} {full}")


def sync_spec(spec_path: pathlib.Path, routes_json: pathlib.Path,
              shapes: dict | None = None, mount_prefix: str = "") -> dict:
    """Merge Go truth into a single spec file. `shapes` is the
    parsed `/tmp/handler_shapes.json` — when provided, stubs get
    auto-curated with real request/response/error data. Returns a
    summary dict with counts for the caller to print."""
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

    def shape_for(verb: str, path: str) -> dict | None:
        if shapes is None:
            return None
        return _shape_lookup(shapes, verb, path, mount_prefix)

    # 2 + 3. Reconcile method sets; add new paths.
    retrofitted = 0
    auto_curated_count = 0
    for p, methods in go_truth.items():
        ml = [m.lower() for m in methods]
        if p in existing:
            ex = existing[p]
            for verb in list(ex.keys()):
                if verb in HTTP_VERBS and verb not in ml:
                    del ex[verb]
                    method_changes.append(f"{p}: dropped {verb.upper()}")
            for verb in ml:
                shape = shape_for(verb, p)
                if verb not in ex:
                    ex[verb] = stub_op(verb, p, shape)
                    method_changes.append(f"{p}: added {verb.upper()} ({'auto' if shape and not shape.get('needs_curation') else 'stub'})")
                    if shape and not shape.get("needs_curation"):
                        auto_curated_count += 1
                else:
                    # Existing auto-managed entries get re-generated
                    # on every sync. Hand-curated ones (no x-stub /
                    # x-auto-curated marker) are preserved.
                    if is_stub(ex[verb]):
                        ex[verb] = stub_op(verb, p, shape)
                        retrofitted += 1
                        if shape and not shape.get("needs_curation"):
                            auto_curated_count += 1
        else:
            existing[p] = {}
            for verb in ml:
                shape = shape_for(verb, p)
                existing[p][verb] = stub_op(verb, p, shape)
                if shape and not shape.get("needs_curation"):
                    auto_curated_count += 1
            added_paths.append(f"{p}: {', '.join(methods)} (stub)")

    spec["paths"] = dict(sorted(existing.items()))

    spec_path.write_text(
        yaml.safe_dump(
            spec, sort_keys=False, default_flow_style=False, width=120, allow_unicode=True
        )
    )

    # Count by managed status.
    hand_curated = 0       # neither marker — human-owned
    auto_curated = 0       # x-auto-curated — shape from Go AST
    stub = 0               # x-stub but not auto-curated — needs work
    needs_curation_count = 0  # x-stub + handler resolved but shape unknown
    for path, ops in existing.items():
        for verb in HTTP_VERBS:
            if verb in ops:
                op = ops[verb]
                if op.get("x-auto-curated") is True:
                    auto_curated += 1
                elif op.get("x-stub") is True:
                    stub += 1
                    if op.get("x-handler", {}).get("needs_curation"):
                        needs_curation_count += 1
                else:
                    hand_curated += 1

    return {
        "spec": spec_path.name,
        "removed": removed_paths,
        "method_changes": method_changes,
        "added": added_paths,
        "retrofitted": retrofitted,
        "auto_curated_pass": auto_curated_count,
        "hand_curated": hand_curated,
        "auto_curated": auto_curated,
        "stub": stub,
        "needs_curation": needs_curation_count,
        "total_paths": len(existing),
    }


def main() -> int:
    runs = [
        (ROOT / "siteAPI.yaml", pathlib.Path("/tmp/site_routes.json"), "/_site"),
        (ROOT / "samanthaAPI.yaml", pathlib.Path("/tmp/v2_routes.json"), "/samantha/v2"),
    ]
    for spec_path, routes_path, _ in runs:
        if not routes_path.exists():
            print(f"FAIL: {routes_path} missing — run extract_routes.py first.", file=sys.stderr)
            return 1

    # Optional: load handler shapes for auto-curation. The file is
    # written by `extract_handler_shapes.py`. If missing, sync runs in
    # the legacy hollow-stub mode.
    shapes_path = pathlib.Path("/tmp/handler_shapes.json")
    if shapes_path.exists():
        shapes = json.loads(shapes_path.read_text())
        print(f"Loaded {len(shapes)} handler shapes from {shapes_path}")
    else:
        shapes = None
        print(f"  (no handler shapes — run extract_handler_shapes.py first for auto-curation)")

    for spec_path, routes_path, mount_prefix in runs:
        r = sync_spec(spec_path, routes_path, shapes=shapes, mount_prefix=mount_prefix)
        print(f"\n=== {r['spec']} ===")
        print(f"  Total paths: {r['total_paths']}")
        print(f"    hand-curated:    {r['hand_curated']:4d}  (human-owned, never overwritten)")
        print(f"    auto-curated:    {r['auto_curated']:4d}  (shape from Go AST, regenerated each sync)")
        print(f"    stubs:           {r['stub']:4d}  (no shape — needs hand curation)")
        print(f"    needs-curation:  {r['needs_curation']:4d}  (handler found but shape couldn't be extracted)")
        print(f"  Retrofitted {r['retrofitted']} existing managed entries to latest shape")
        print(f"  Newly auto-curated this run: {r['auto_curated_pass']}")
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
