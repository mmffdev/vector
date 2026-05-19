#!/usr/bin/env python3
"""extract_handler_shapes.py — Parse Go handlers under backend/internal/
and emit per-route request/response/query/error shape JSON for the
sync_specs.py stub auto-curation pass.

Workflow:
  1. Walk backend/cmd/server/main.go via extract_routes.py to get the
     full (METHOD, path, handler_symbol) catalogue. extract_routes.py
     only gives us (METHOD, path) — this script reparses main.go to
     also capture the trailing handler reference (e.g. `usersH.Create`).
  2. For each handler reference, resolve which file under
     backend/internal/<pkg>/ defines the function.
  3. Scrape the function body for:
       - request struct: `type NAMEReq struct { ... }` paired with
         `json.NewDecoder(r.Body).Decode(&req)` or `&NAMEReq{}`
       - response shape: `writeJSON(w, CODE, ...)` calls — capture the
         status code; capture the response variable's name and try to
         resolve its struct type either locally or in the same file.
       - query params: `r.URL.Query().Get("KEY")` calls.
       - error codes: `httperr.Write(w, r, http.STATUS, "code")` calls
         for documenting the error catalogue.
  4. Emit /tmp/handler_shapes.json keyed by f"{METHOD} {path}":
       {
         "handler_symbol": "usersH.Create",
         "handler_file":   "backend/internal/users/handler.go",
         "status_code":    201,
         "request_struct": {"name": "createReq", "fields": [...]},
         "response_struct": {"name": "createResp", "fields": [...]},
         "query_params":   ["search", "limit"],
         "errors":         [{"code": 400, "message": "request_bad"}, ...],
         "needs_curation": false,   // true if we couldn't resolve a shape
       }

The Go syntax recognised is the project's own convention — not
Go-AST-grade. Anything weird (interface returns, generic responses,
helpers that hide the shape) gets marked needs_curation=true so the
human knows where to look.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from collections import defaultdict

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import extract_routes  # type: ignore  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parents[2]
MAIN_GO = ROOT / "backend" / "cmd" / "server" / "main.go"
INTERNAL = ROOT / "backend" / "internal"

# ── Regexes ──────────────────────────────────────────────────────────────────

# Verb call with handler binding: `.Get("/path", handlerVar.Method)` or
# `.Get("/path", handlerVar.Method)` (with optional whitespace + newlines).
# The handler can also be a chain: usersH.Create. We capture the full
# dotted symbol after the comma.
VERB_HANDLER_RE = re.compile(
    r'\.\s*(Get|Post|Put|Patch|Delete|Head)\(\s*"([^"]+)"\s*,\s*([\w.]+)\s*\)'
)

# Handler function definition: `func (h *Handler) NAME(...)`
HANDLER_FUNC_RE = re.compile(
    r'func\s*\(\s*\w+\s*\*?\s*\w+\s*\)\s*(\w+)\s*\(\s*w\s+http\.ResponseWriter'
)

# Local request struct: `type NAME struct {`
STRUCT_DECL_RE = re.compile(r'type\s+(\w+)\s+struct\s*\{')

# json.NewDecoder(r.Body).Decode(&req) — captures the var name (req)
DECODE_RE = re.compile(r'json\.NewDecoder\(r\.Body\)\.Decode\(&(\w+)\)')

# var req NAME — captures the var name + type
VAR_DECL_RE = re.compile(r'var\s+(\w+)\s+(\w+(?:\.\w+)?)')

# writeJSON / WriteJSON helper, optionally with status code arg:
#   writeJSON(w, 200, out)
#   writeJSON(w, 201, createResp{User: u})
#   WriteJSON(w, http.StatusOK, body)
WRITE_JSON_RE = re.compile(
    r'(?:writeJSON|WriteJSON|httpx\.WriteJSON|httpx\.JSON)\(\s*w\s*,\s*([^,]+?)\s*,\s*([^)]+?)\s*\)'
)

# httperr.Write(w, r, http.StatusXxx, "code")
HTTPERR_RE = re.compile(
    r'httperr\.Write\(\s*w\s*,\s*r\s*,\s*(?:http\.)?(\w+)\s*,\s*[\'"]?([\w.]+?)[\'"]?\s*\)'
)

# r.URL.Query().Get("key")
QUERY_PARAM_RE = re.compile(r'r\.URL\.Query\(\)\.Get\(\s*"([^"]+)"')

# Variable assignment from service call:
#   out, err := h.Svc.List(r.Context(), actor.SubscriptionID)
#   user, err := h.Svc.Create(ctx, ...)
#   list := h.Svc.Foo(...)
# Captures: result var, optional err var, method chain (h.Svc.List).
VAR_FROM_CALL_RE = re.compile(
    r'^\s*(\w+)\s*(?:,\s*err)?\s*:=\s*([\w.]+)\(',
    re.MULTILINE,
)

# Service method definition: `func (s *Service) Name(ctx, ...) (TYPE, error) {`
# Captures the return TYPE (first return value). Handles pointer + dotted types.
SVC_METHOD_RE_TEMPLATE = r'func\s*\(\s*\w+\s*\*?\s*\w+\s*\)\s*{NAME}\s*\([^)]*\)\s*\(?\s*(\*?\[?\]?\*?[\w.]+)'

# Struct field line: `Name *string `json:"name,omitempty"``
# Captures: field name, Go type (pointer + dotted ok), json tag name.
FIELD_LINE_RE = re.compile(
    r'^\s*(\w+)\s+(\*?\[?\]?\*?[\w.]+)\s+`[^`]*json:"([^",]+)(?:,([^"]*))?"'
)

# Status const → numeric code lookup. Covers the common http.* constants
# the codebase actually uses. Anything outside this falls back to the
# raw string for the human to interpret.
HTTP_STATUS_CONSTS = {
    "StatusOK": 200, "StatusCreated": 201, "StatusAccepted": 202,
    "StatusNoContent": 204, "StatusBadRequest": 400,
    "StatusUnauthorized": 401, "StatusForbidden": 403,
    "StatusNotFound": 404, "StatusMethodNotAllowed": 405,
    "StatusConflict": 409, "StatusGone": 410,
    "StatusUnprocessableEntity": 422, "StatusTooManyRequests": 429,
    "StatusInternalServerError": 500, "StatusServiceUnavailable": 503,
}


# ── Go-aware skip helpers (reuse from extract_routes) ────────────────────────


def skip_token(src: str, i: int, n: int) -> int | None:
    return extract_routes.skip_token(src, i, n)


# ── Step 1: enumerate handler bindings from main.go ──────────────────────────


def collect_handler_bindings() -> list[tuple[str, str, str]]:
    """Return (METHOD, full_path, handler_symbol) for every route call
    in main.go. Resolves through the same closure machinery as
    extract_routes so closures get the right path prefix."""
    src = MAIN_GO.read_text(encoding="utf-8")
    closure_bodies = extract_routes.find_closure_bodies(src)
    return _walk_for_bindings(src, closure_bodies)


def _walk_for_bindings(
    src: str,
    closure_bodies: dict[str, tuple[int, int]],
    start: int = 0,
    end: int | None = None,
    parent_stack: list[tuple[str, int]] | None = None,
) -> list[tuple[str, str, str]]:
    """Mirror of extract_routes.parse_top + parse_block but captures
    the handler symbol from VERB_HANDLER_RE instead of VERB_CALL_RE."""
    if end is None:
        end = len(src)
    parent_stack = parent_stack or []
    out: list[tuple[str, str, str]] = []
    stack: list[tuple[str, int]] = [(p, -1) for p, _ in parent_stack]
    depth = 0
    i = start
    while i < end:
        nxt = skip_token(src, i, end)
        if nxt is not None:
            i = nxt
            continue
        sub = src[i:i + 400]
        m = extract_routes.CLOSURE_DECL_RE.match(sub)
        if m and m.group(1) in closure_bodies:
            _, be = closure_bodies[m.group(1)]
            if be + 1 <= end:
                i = be + 1
                continue
        ch = src[i]
        if ch == "{":
            depth += 1
            i += 1
            continue
        if ch == "}":
            depth -= 1
            while stack and stack[-1][1] > depth:
                stack.pop()
            i += 1
            continue
        m = extract_routes.ROUTE_RE.match(sub)
        if m:
            stack.append((m.group(1), depth + 1))
            depth += 1
            i += m.end()
            continue
        m = VERB_HANDLER_RE.match(sub)
        if m:
            full = "".join(s[0] for s in stack) + m.group(2)
            full = re.sub(r"//+", "/", full)
            if len(full) > 1 and full.endswith("/"):
                full = full[:-1]
            out.append((m.group(1).upper(), full, m.group(3)))
            i += m.end()
            continue
        m = extract_routes.CLOSURE_CALL_RE.match(sub)
        if m and m.group(1) in closure_bodies:
            cs, ce = closure_bodies[m.group(1)]
            out.extend(_walk_for_bindings(src, closure_bodies, cs, ce, stack))
            i += m.end()
            continue
        i += 1
    return out


# ── Step 2: locate the handler file for a given symbol ────────────────────────

# handler_symbol format: `usersH.Create`. We don't know which package
# `usersH` was declared as in main.go — but we can search every Go file
# under backend/internal/ for a `func (h *X) Create(w http.ResponseWriter, ...)`
# definition and use the package of any single unique match. If multiple
# packages define the same method name, we fall back to disambiguating
# by the var prefix (usersH → users, sprintH → timeboxes/sprints, etc.).

# Handler-var declaration in main.go, e.g.
#   usersH := users.NewHandler(...)
#   sprintH := timeboxsprints.NewHandler(pool, ...)
#   navGrantsAdminH := navgrantsadmin.NewHandler(pool)
# Captures: var name, package name.
HANDLER_VAR_DECL_RE = re.compile(
    r'(?:^|\s)(\w+H[a-zA-Z]*?)\s*:?=\s*(\w+)\.NewHandler\(',
    re.MULTILINE,
)


def build_var_to_pkg_map() -> dict[str, str]:
    """Parse main.go to learn which package each handler var was
    constructed from. Replaces the brittle hand-maintained
    _VAR_PKG_HINTS dict."""
    src = MAIN_GO.read_text(encoding="utf-8")
    out: dict[str, str] = {}
    for m in HANDLER_VAR_DECL_RE.finditer(src):
        var, pkg = m.group(1), m.group(2)
        if var not in out:
            out[var] = pkg
    return out


_VAR_TO_PKG: dict[str, str] | None = None


def _var_to_pkg() -> dict[str, str]:
    global _VAR_TO_PKG
    if _VAR_TO_PKG is None:
        _VAR_TO_PKG = build_var_to_pkg_map()
    return _VAR_TO_PKG


def find_handler_file(handler_symbol: str) -> pathlib.Path | None:
    """Walk backend/internal/ looking for the func definition that
    matches the method name. Disambiguates by parsing main.go for
    `varName := pkg.NewHandler(...)` declarations — so when we see
    `navGrantsAdminH.List`, we look in backend/internal/navgrantsadmin/
    first instead of guessing across the whole tree."""
    if "." not in handler_symbol:
        return None
    var, method = handler_symbol.split(".", 1)
    pkg_hint = _var_to_pkg().get(var)
    # Two-stage scan: hinted package first, then broad fallback.
    search_dirs: list[pathlib.Path] = []
    if pkg_hint:
        hinted = INTERNAL / pkg_hint
        if hinted.exists():
            search_dirs.append(hinted)
    search_dirs.append(INTERNAL)
    seen: set[pathlib.Path] = set()
    for d in search_dirs:
        candidates: list[pathlib.Path] = []
        for p in d.rglob("*.go"):
            if p in seen or p.name.endswith("_test.go"):
                continue
            seen.add(p)
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            if re.search(
                rf'func\s*\(\s*\w+\s*\*?\s*\w+\s*\)\s*{re.escape(method)}\s*\(\s*w\s+http\.ResponseWriter',
                text,
            ):
                candidates.append(p)
        if candidates:
            return candidates[0]
    return None


# ── Step 3: scrape one handler function body ──────────────────────────────────


def extract_handler_body(file_path: pathlib.Path, method_name: str) -> tuple[str, str] | None:
    """Return (body_text, full_file_text). Body is from the opening
    `{` of the func to its matching `}`. None if not found."""
    src = file_path.read_text(encoding="utf-8", errors="ignore")
    pat = re.compile(
        rf'func\s*\(\s*\w+\s*\*?\s*\w+\s*\)\s*{re.escape(method_name)}\s*\([^)]*\)\s*\{{'
    )
    m = pat.search(src)
    if not m:
        return None
    body_start = m.end()
    depth = 1
    j = body_start
    n = len(src)
    while j < n and depth > 0:
        nxt = skip_token(src, j, n)
        if nxt is not None:
            j = nxt
            continue
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
        j += 1
    return src[body_start:j - 1], src


def parse_struct_fields(struct_body: str) -> list[dict]:
    """Pull fields out of a Go struct body. Each field becomes
    {name, go_type, json_name, optional}."""
    fields = []
    for line in struct_body.splitlines():
        m = FIELD_LINE_RE.match(line)
        if not m:
            continue
        go_name, go_type, json_name, tag_rest = m.group(1), m.group(2), m.group(3), (m.group(4) or "")
        is_pointer = go_type.startswith("*")
        is_omit = "omitempty" in tag_rest
        fields.append({
            "go_name": go_name,
            "go_type": go_type,
            "json_name": json_name,
            "optional": is_pointer or is_omit,
        })
    return fields


def find_struct(file_src: str, struct_name: str) -> list[dict] | None:
    """Find `type NAME struct { ... }` in file_src and return field list."""
    pat = re.compile(rf'type\s+{re.escape(struct_name)}\s+struct\s*\{{')
    m = pat.search(file_src)
    if not m:
        return None
    body_start = m.end()
    depth = 1
    j = body_start
    n = len(file_src)
    while j < n and depth > 0:
        nxt = skip_token(file_src, j, n)
        if nxt is not None:
            j = nxt
            continue
        if file_src[j] == "{":
            depth += 1
        elif file_src[j] == "}":
            depth -= 1
        j += 1
    return parse_struct_fields(file_src[body_start:j - 1])


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
    """Map a Go type string to an OpenAPI 3.1 schema fragment.
    Falls back to {type: object} when the type is unknown — better
    to be vague than wrong."""
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
    # Dotted type — e.g. roletypes.User. Reference by name (the human
    # curator can wire $ref to a defined component, or leave as-is).
    if "." in t:
        local = t.split(".")[-1]
        return {"type": "object", "x-go-type": t, "x-go-symbol": local}
    # PascalCase — assume named local struct (we'll resolve if findable
    # at the merge stage; if not, leave as opaque object).
    if t[:1].isupper():
        return {"type": "object", "x-go-type": t}
    return {"type": "object"}


def fields_to_schema(fields: list[dict]) -> dict:
    props = {}
    required = []
    for f in fields:
        schema = go_type_to_openapi(f["go_type"])
        props[f["json_name"]] = schema
        if not f["optional"]:
            required.append(f["json_name"])
    out = {"type": "object", "properties": props}
    if required:
        out["required"] = required
    return out


def _find_struct_in_package(struct_name: str, pkg_dir: pathlib.Path) -> list[dict] | None:
    """Search every non-test .go file in pkg_dir for the struct
    definition. Used when the struct lives in a sibling file
    (e.g. types.go, service.go, inputs.go)."""
    for p in pkg_dir.glob("*.go"):
        if p.name.endswith("_test.go"):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        fields = find_struct(text, struct_name)
        if fields is not None:
            return fields
    return None


def _resolve_response_variable(
    var_name: str, handler_body: str, pkg_dir: pathlib.Path, handler_file_src: str,
) -> dict | None:
    """Given a response var like `out`, find its assignment in the
    handler body (`out, err := h.Svc.List(...)`), follow to the service
    method definition in the same package directory, capture the return
    type, and resolve to a struct shape if possible. Returns None if
    any step fails."""
    # Step 1: find the assignment line for var_name.
    call_target = None
    for m in VAR_FROM_CALL_RE.finditer(handler_body):
        if m.group(1) == var_name:
            call_target = m.group(2)
            break
    if call_target is None:
        return None
    # Step 2: pull the method name off the call target tail.
    method = call_target.rsplit(".", 1)[-1]
    # Step 3: scan every .go file in pkg_dir (and parent if pkg_dir is
    # nested) for a method def with this name + capture return type.
    return_type = None
    search_files = list(pkg_dir.glob("*.go"))
    # Add sibling internal/<other>/*.go for cross-package services (rare
    # but happens — e.g. usersH calls into permissions.Service).
    for p in search_files:
        if p.name.endswith("_test.go"):
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        rm = re.search(SVC_METHOD_RE_TEMPLATE.format(NAME=re.escape(method)), text)
        if rm:
            return_type = rm.group(1)
            # Step 4: find the struct definition for this type. Strip
            # leading * and []. If dotted (pkg.Type), try same-package
            # tail; we don't follow cross-package imports here.
            bare = return_type.lstrip("*").lstrip("[]").lstrip("*")
            if "." in bare:
                bare = bare.split(".")[-1]
            # Try the file where we found the method first.
            fields = find_struct(text, bare)
            if fields is None:
                # Try the original handler file.
                fields = find_struct(handler_file_src, bare)
            if fields is None:
                # Try every file in pkg_dir.
                for p2 in search_files:
                    if p2.name.endswith("_test.go"):
                        continue
                    fields = find_struct(p2.read_text(encoding="utf-8", errors="ignore"), bare)
                    if fields is not None:
                        break
            if fields is not None:
                # Preserve outer wrapping (slice / pointer).
                is_slice = return_type.lstrip("*").startswith("[]")
                struct = {
                    "name": bare,
                    "fields": fields,
                    "kind": "struct",
                    "variable_name": var_name,
                }
                if is_slice:
                    struct["kind"] = "slice_of_struct"
                return struct
            # Type found but struct not — return what we know.
            return {
                "name": bare,
                "fields": None,
                "kind": "unresolved_type",
                "go_type": return_type,
                "variable_name": var_name,
            }
    return None


def analyse_handler(
    file_path: pathlib.Path, method_name: str
) -> dict:
    """Return the shape record for one handler — request struct,
    response struct, query params, errors, and a needs_curation flag
    that flips true when we couldn't resolve something."""
    body_info = extract_handler_body(file_path, method_name)
    if body_info is None:
        return {"needs_curation": True, "reason": "handler-not-found"}
    body, full_src = body_info
    needs = False
    reasons: list[str] = []

    # --- request struct
    request_struct = None
    decode_m = DECODE_RE.search(body)
    if decode_m:
        var_name = decode_m.group(1)
        # Find `var <name> <Type>` in the body to learn the struct name.
        vm = re.search(rf'var\s+{re.escape(var_name)}\s+(\w+)', body)
        if vm:
            struct_name = vm.group(1)
            fields = find_struct(full_src, struct_name)
            if fields is None:
                # Search every other .go file in the same package dir
                # (struct may be in service.go, types.go, etc.).
                fields = _find_struct_in_package(struct_name, file_path.parent)
            if fields is not None:
                request_struct = {"name": struct_name, "fields": fields}
            else:
                needs = True
                reasons.append(f"request-struct-{struct_name}-not-found")
        else:
            needs = True
            reasons.append("request-var-decl-not-found")

    # --- response: pull every writeJSON call
    response_calls = []
    for m in WRITE_JSON_RE.finditer(body):
        code_expr = m.group(1).strip()
        payload_expr = m.group(2).strip()
        # Resolve numeric status code.
        if code_expr.isdigit():
            status = int(code_expr)
        elif code_expr.startswith("http.") and code_expr[5:] in HTTP_STATUS_CONSTS:
            status = HTTP_STATUS_CONSTS[code_expr[5:]]
        elif code_expr in HTTP_STATUS_CONSTS:
            status = HTTP_STATUS_CONSTS[code_expr]
        else:
            status = None
            needs = True
            reasons.append(f"status-expr-{code_expr}")
        response_calls.append({"status": status, "payload_expr": payload_expr})

    # Pick the success response: first writeJSON with status in 200–299.
    success = next((c for c in response_calls if c["status"] and 200 <= c["status"] < 300), None)
    response_struct = None
    if success:
        payload = success["payload_expr"]
        # Strip leading address-of, casts, &.
        payload = payload.lstrip("&*")
        # Patterns we recognise:
        #   createResp{...}        — struct literal
        #   out / list / etc.      — variable; need to resolve type
        sl_m = re.match(r'(\w+)\s*\{', payload)
        if sl_m:
            struct_name = sl_m.group(1)
            fields = find_struct(full_src, struct_name)
            if fields is not None:
                response_struct = {"name": struct_name, "fields": fields, "kind": "struct"}
            else:
                # Map-literal like map[string]any{...} — skip.
                if struct_name not in ("map", "any", "interface"):
                    needs = True
                    reasons.append(f"response-struct-{struct_name}-not-found")
        else:
            # Variable form. Resolve via:
            #   1. find `<var>[, err] := <call_target>(...)` in body
            #   2. extract method name from call_target tail
            #   3. find that method's definition in the same package
            #      directory; capture its first return type
            #   4. find that type's struct definition; emit fields
            var_m = re.match(r'^(\w+)$', payload)
            if var_m:
                var_name = var_m.group(1)
                resolved = _resolve_response_variable(
                    var_name, body, file_path.parent, full_src
                )
                if resolved is not None:
                    response_struct = resolved
                else:
                    response_struct = {
                        "name": None, "fields": None, "kind": "variable",
                        "variable_name": var_name,
                    }
                    needs = True
                    reasons.append(f"response-from-variable-{var_name}")
            else:
                needs = True
                reasons.append(f"response-payload-shape-{payload[:40]}")

    # --- query params
    query_params = sorted({m.group(1) for m in QUERY_PARAM_RE.finditer(body)})

    # --- error codes
    errors: list[dict] = []
    seen_errs = set()
    for m in HTTPERR_RE.finditer(body):
        status_const = m.group(1)
        code = m.group(2)
        status = HTTP_STATUS_CONSTS.get(status_const)
        key = (status, code)
        if status and key not in seen_errs:
            seen_errs.add(key)
            errors.append({"status": status, "code": code})
    errors.sort(key=lambda e: (e["status"], e["code"]))

    return {
        "success_status": success["status"] if success else None,
        "request_struct": request_struct,
        "response_struct": response_struct,
        "query_params": query_params,
        "errors": errors,
        "needs_curation": needs,
        "reasons": reasons,
    }


# ── Step 4: orchestrate ──────────────────────────────────────────────────────


def main() -> int:
    bindings = collect_handler_bindings()
    print(f"Found {len(bindings)} handler bindings in main.go")
    out: dict[str, dict] = {}
    unmatched_handlers = 0
    needs_curation_count = 0
    for method, path, handler_symbol in bindings:
        key = f"{method} {path}"
        if key in out:
            continue
        file_path = find_handler_file(handler_symbol)
        if file_path is None:
            out[key] = {
                "handler_symbol": handler_symbol,
                "handler_file": None,
                "needs_curation": True,
                "reasons": ["handler-file-not-found"],
            }
            unmatched_handlers += 1
            continue
        method_name = handler_symbol.split(".", 1)[1]
        shape = analyse_handler(file_path, method_name)
        shape["handler_symbol"] = handler_symbol
        shape["handler_file"] = str(file_path.relative_to(ROOT))
        if shape.get("needs_curation"):
            needs_curation_count += 1
        out[key] = shape

    pathlib.Path("/tmp/handler_shapes.json").write_text(
        json.dumps(out, indent=2, sort_keys=True)
    )
    print(f"  resolved: {len(out) - unmatched_handlers}/{len(out)}")
    print(f"  needs curation (incomplete shapes): {needs_curation_count}")
    print(f"  unmatched handler files: {unmatched_handlers}")
    print(f"  → /tmp/handler_shapes.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
