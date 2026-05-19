#!/usr/bin/env python3
"""Tests for extract_routes.py — locks the closure-aware route parser
behaviour in. Run with:

    python3 dev/scripts/extract_routes_test.py

Exits 0 if every fixture's expected route set matches what the parser
emits; exits 1 with a diff on the first failure.

The fixtures cover the patterns that bit us during B20.5.A + .B:
  - Single-arg closure (mountSiteRoutes := func(r chi.Router) {...})
  - Multi-arg closure (mountArtefactSite := func(r chi.Router, h *X) {...})
  - Nested closure (closure declared inside another closure body)
  - Middleware chain (r.With(...).Get("/path"))
  - Same-line closure call inside r.Route block
  - Comments + strings that look like route declarations but aren't
"""
from __future__ import annotations

import pathlib
import sys
import tempfile
import textwrap

# Import the parser as a module — same directory.
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))
import extract_routes  # type: ignore  # noqa: E402


def run_parser_on_source(src: str) -> set[tuple[str, str]]:
    """Write src to a tmp .go file and invoke extract_routes against it."""
    with tempfile.NamedTemporaryFile("w", suffix=".go", delete=False) as f:
        f.write(src)
        f.flush()
        return extract_routes.extract_all_routes(pathlib.Path(f.name))


# ── Fixtures ──────────────────────────────────────────────────────────────────


def case_simple_r_route() -> tuple[str, set[tuple[str, str]]]:
    src = textwrap.dedent("""\
        package main
        func main() {
            r.Route("/api", func(r chi.Router) {
                r.Get("/hello", h.Hello)
                r.Post("/world", h.World)
            })
        }
    """)
    expected = {
        ("GET", "/api/hello"),
        ("POST", "/api/world"),
    }
    return src, expected


def case_middleware_chain() -> tuple[str, set[tuple[str, str]]]:
    """Critical: r.With(...).Get("/path") was invisible to the
    pre-B20.5.B parser. Every middleware-gated route would be missed."""
    src = textwrap.dedent("""\
        package main
        func main() {
            r.Route("/admin", func(r chi.Router) {
                r.Use(authSvc.RequireAuth)
                r.With(auth.RequirePermission(permResolver, permissions.UsersList)).
                    Get("/users", h.List)
                r.With(rateLimit).With(auth.RequirePermission(permResolver, X)).Post("/users", h.Create)
                r.With(auth.RequireStepUpReauth("delete-user")).Delete("/users/{id}", h.Delete)
            })
        }
    """)
    expected = {
        ("GET", "/admin/users"),
        ("POST", "/admin/users"),
        ("DELETE", "/admin/users/{id}"),
    }
    return src, expected


def case_single_arg_closure() -> tuple[str, set[tuple[str, str]]]:
    """mountSiteRoutes pattern: closure declared at one point,
    invoked from inside an r.Route block elsewhere. Parser normalises
    `/api` + `/` → `/api` (trailing slash stripped on paths > 1 char)."""
    src = textwrap.dedent("""\
        package main
        func main() {
            mountRoutes := func(r chi.Router) {
                r.Get("/", h.List)
                r.Route("/inner", func(r chi.Router) {
                    r.Get("/x", h.X)
                })
            }
            r.Route("/api", func(r chi.Router) {
                mountRoutes(r)
            })
        }
    """)
    expected = {
        ("GET", "/api"),
        ("GET", "/api/inner/x"),
    }
    return src, expected


def case_multi_arg_closure() -> tuple[str, set[tuple[str, str]]]:
    """mountArtefactSite pattern: closure takes a handler parameter
    so the same body can be invoked twice with different handlers
    under different parent prefixes (work-items vs portfolio-items)."""
    src = textwrap.dedent("""\
        package main
        func main() {
            mountArtefact := func(r chi.Router, h *Handler) {
                r.Get("/", h.List)
                r.Post("/", h.Create)
                r.Get("/{id}", h.Get)
            }
            r.Route("/work-items", func(r chi.Router) { mountArtefact(r, workH) })
            r.Route("/portfolio-items", func(r chi.Router) { mountArtefact(r, portH) })
        }
    """)
    expected = {
        ("GET", "/work-items"),
        ("POST", "/work-items"),
        ("GET", "/work-items/{id}"),
        ("GET", "/portfolio-items"),
        ("POST", "/portfolio-items"),
        ("GET", "/portfolio-items/{id}"),
    }
    return src, expected


def case_nested_closure() -> tuple[str, set[tuple[str, str]]]:
    """A closure declared INSIDE another closure's body. The PLA-0039
    backend has mountArtefactSite declared inside mountSiteRoutes —
    so the closure-detection pass must continue scanning inside each
    closure body, not jump past it."""
    src = textwrap.dedent("""\
        package main
        func main() {
            mountSite := func(r chi.Router) {
                mountInner := func(r chi.Router, h *Handler) {
                    r.Get("/", h.List)
                    r.Patch("/{id}", h.Patch)
                }
                r.Route("/things", func(r chi.Router) { mountInner(r, thingsH) })
            }
            r.Route("/_site", func(r chi.Router) {
                mountSite(r)
            })
        }
    """)
    expected = {
        ("GET", "/_site/things"),
        ("PATCH", "/_site/things/{id}"),
    }
    return src, expected


def case_comments_and_strings() -> tuple[str, set[tuple[str, str]]]:
    """Routes that look like declarations but live inside comments
    or string literals must NOT be parsed."""
    src = textwrap.dedent('''\
        package main
        func main() {
            // r.Route("/fake-line-comment", func(r chi.Router) { r.Get("/x", h.X) })
            /* r.Route("/fake-block-comment", func(r chi.Router) { r.Get("/y", h.Y) }) */
            msg := "r.Route(\\"/fake-string\\", ...)"
            _ = msg
            r.Route("/real", func(r chi.Router) {
                r.Get("/path", h.Path)
            })
        }
    ''')
    expected = {
        ("GET", "/real/path"),
    }
    return src, expected


def case_same_line_closure_call() -> tuple[str, set[tuple[str, str]]]:
    """All-on-one-line r.Route + closure call pattern (line 1551
    in main.go: `r.Route("/work-items", func(r chi.Router) { mountArtefactRoutes(r, workItemsV2H) })`)."""
    src = textwrap.dedent("""\
        package main
        func main() {
            doStuff := func(r chi.Router, h *X) {
                r.Get("/leaf", h.Leaf)
            }
            r.Route("/api", func(r chi.Router) { doStuff(r, myHandler) })
        }
    """)
    expected = {("GET", "/api/leaf")}
    return src, expected


def case_route_with_trailing_slash_normalised() -> tuple[str, set[tuple[str, str]]]:
    """Two normalisation invariants:
      - `r.Route("/widgets/", ...)` + `r.Get("/foo")` must NOT
        double-slash to `/widgets//foo` (collapsed by re.sub).
      - `r.Route("/things", ...)` + `r.Get("/")` yields `/things/`
        which the parser then strips to `/things` (trailing slash
        stripped on any path > 1 char)."""
    src = textwrap.dedent("""\
        package main
        func main() {
            r.Route("/widgets/", func(r chi.Router) {
                r.Get("/foo", h.Foo)
            })
            r.Route("/things", func(r chi.Router) {
                r.Get("/", h.Index)
            })
        }
    """)
    expected = {
        ("GET", "/widgets/foo"),
        ("GET", "/things"),
    }
    return src, expected


# ── Test runner ───────────────────────────────────────────────────────────────

CASES = {
    "simple_r_route": case_simple_r_route,
    "middleware_chain": case_middleware_chain,
    "single_arg_closure": case_single_arg_closure,
    "multi_arg_closure": case_multi_arg_closure,
    "nested_closure": case_nested_closure,
    "comments_and_strings": case_comments_and_strings,
    "same_line_closure_call": case_same_line_closure_call,
    "route_with_trailing_slash_normalised": case_route_with_trailing_slash_normalised,
}


def main() -> int:
    failed = 0
    for name, case in CASES.items():
        src, expected = case()
        actual = run_parser_on_source(src)
        if actual == expected:
            print(f"  PASS  {name}")
            continue
        failed += 1
        missing = expected - actual
        extra = actual - expected
        print(f"  FAIL  {name}")
        if missing:
            print(f"        missing routes (expected, not emitted):")
            for r in sorted(missing):
                print(f"          {r[0]:7s} {r[1]}")
        if extra:
            print(f"        extra routes (emitted, not expected):")
            for r in sorted(extra):
                print(f"          {r[0]:7s} {r[1]}")
    print()
    if failed:
        print(f"FAIL: {failed} of {len(CASES)} parser cases failed")
        return 1
    print(f"OK: all {len(CASES)} parser cases pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
