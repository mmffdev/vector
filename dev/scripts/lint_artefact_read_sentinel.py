#!/usr/bin/env python3
"""Lint artefact-read-sentinel: SEC-001 (RES066) regression guard.

Rule: any HTTP handler whose package READS the tenant `artefacts` table
MUST derive the workspace clamp from Sentinel context
(`sentinel.WorkspaceIDFromCtx` / `sentinel.FromCtx`) — it must NOT trust a
workspace identifier from the request body/query. The route that mounts
such a handler is expected to sit behind `sentinelMW`; the per-handler
clamp-read is the observable proof that the handler honours the clamp
rather than a caller-supplied workspace.

Origin: SEC-001 — `POST /search` trusted `workspace_id` from the request
body and was not mounted behind `sentinelMW`, so the topology subtree
clamp degraded to a no-op and any authenticated user could read another
tenant's search results. This lint makes that class of bug fail CI.

Detection (per `backend/internal/<pkg>/`):
  1. The package SELECTs from the `artefacts` table — matched as a table
     token (`FROM artefacts` / `JOIN artefacts`), explicitly EXCLUDING the
     `artefacts_types` catalogue and any `artefacts_*` sidecar (those are
     type/config reads, not tenant artefact rows).
  2. The package has an HTTP handler file (`handler*.go`).
  3. SELECT (read) usage of the table exists — packages that only
     UPDATE/DELETE under an explicit `artefacts_id_workspace = $N` clause
     (adoption sagas) are write-scoped, not body-trusting reads.
  => Then the handler file MUST reference
     `sentinel.WorkspaceIDFromCtx(` or `sentinel.FromCtx(`.

Packages that legitimately touch `artefacts` without an HTTP clamp read
(background workers, workspace-parameterised saga writers) are listed in
`dev/registries/artefact_read_sentinel_exempt.json` with a justification.
The ledger is a ratchet — it should only ever shrink.

Exit 0 = clean. Exit 1 = an artefact-reading handler outside the ledger
does not read the Sentinel clamp.
"""
from __future__ import annotations
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCAN_DIR = ROOT / "backend" / "internal"
EXEMPT_REGISTRY = ROOT / "dev" / "registries" / "artefact_read_sentinel_exempt.json"

# `FROM artefacts` / `JOIN artefacts` as a TABLE token — the next char after
# "artefacts" must NOT be a word char (so `artefacts_types`, `artefacts_search_*`
# etc. do not match). Optional SQL alias after it is fine.
ARTEFACTS_TABLE_RE = re.compile(r"\b(?:FROM|JOIN)\s+artefacts(?![A-Za-z0-9_])", re.IGNORECASE)

# A SELECT touching the artefacts table (read path).
SELECT_RE = re.compile(r"\bSELECT\b", re.IGNORECASE)

# The clamp-read markers that prove the handler honours Sentinel.
SENTINEL_CLAMP_RE = re.compile(r"sentinel\.(WorkspaceIDFromCtx|FromCtx)\s*\(")

HANDLER_NAME_RE = re.compile(r"handler.*\.go$|.*_handler\.go$")


def load_exemptions() -> dict[str, str]:
    if not EXEMPT_REGISTRY.exists():
        return {}
    data = json.loads(EXEMPT_REGISTRY.read_text())
    return {str(e["package"]): e.get("reason", "") for e in data.get("exempt", [])}


def pkg_reads_artefacts(pkg_dir: pathlib.Path) -> bool:
    """True if a non-test .go file in the package SELECTs from the artefacts table."""
    for go in pkg_dir.glob("*.go"):
        if go.name.endswith("_test.go"):
            continue
        text = go.read_text(errors="ignore")
        if not ARTEFACTS_TABLE_RE.search(text):
            continue
        # Require a SELECT in the same file — UPDATE/DELETE-only files are
        # write-scoped saga mutators, not body-trusting reads.
        for stmt in re.split(r"`", text):
            if ARTEFACTS_TABLE_RE.search(stmt) and SELECT_RE.search(stmt):
                return True
    return False


def handler_files(pkg_dir: pathlib.Path) -> list[pathlib.Path]:
    return [
        p for p in pkg_dir.glob("*.go")
        if HANDLER_NAME_RE.search(p.name) and not p.name.endswith("_test.go")
    ]


def handler_reads_clamp(files: list[pathlib.Path]) -> bool:
    return any(SENTINEL_CLAMP_RE.search(p.read_text(errors="ignore")) for p in files)


def main() -> int:
    exemptions = load_exemptions()
    violations: list[str] = []
    checked = 0

    for pkg_dir in sorted(p for p in SCAN_DIR.iterdir() if p.is_dir()):
        pkg = pkg_dir.name
        if not pkg_reads_artefacts(pkg_dir):
            continue
        hfiles = handler_files(pkg_dir)
        if not hfiles:
            # No HTTP handler — background worker / service-only package.
            continue
        checked += 1
        if handler_reads_clamp(hfiles):
            continue
        if pkg in exemptions:
            print(f"  [exempt] {pkg} — {exemptions[pkg]}")
            continue
        violations.append(
            f"  {pkg}: reads the artefacts table and exposes an HTTP handler "
            f"({', '.join(p.name for p in hfiles)}) but never calls "
            f"sentinel.WorkspaceIDFromCtx/FromCtx — SEC-001 class. Mount the "
            f"route behind sentinelMW and derive the workspace from the clamp."
        )

    if violations:
        print("[lint:artefact-read-sentinel] FAIL — artefact-reading handler(s) "
              "do not honour the Sentinel clamp:\n")
        print("\n".join(violations))
        print(f"\n{len(violations)} violation(s). See SEC-001 / RES066.")
        return 1

    print(f"[lint:artefact-read-sentinel] OK — {checked} artefact-reading "
          f"handler package(s), all read the Sentinel clamp "
          f"({len(exemptions)} exempt).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
