#!/usr/bin/env python3
"""PLA-0005 / story 00250 — audit /dashboard's panel inventory.

Walks app/(user)/dashboard/page.tsx and emits a Markdown report listing
every element on the page that is "panel-shaped" — i.e. has an <h1>/<h2>/
<h3> as its first sibling under the page root, OR is a chart/table block
that needs to become a Panel/Table when story 00251 wraps the page in
strict mode.

Classification:
  panel             — heading immediately followed by a block of content;
                      the heading + content pair will be wrapped in
                      <Panel name=…> by 00251.
  info              — heading-less informational tile; tiles are wrapped
                      in their parent panel (the Overview block) so they
                      do not get individual addresses.
  heading           — a heading that does NOT have content after it
                      (rare; flagged for human review).
  chart-without-frame — a <ChartWidget> outside any panel; 00251 will
                      decide whether it joins a panel or stands alone.
  table             — <table>/<div className="table-wrap">; will be
                      wrapped in <Table name=…>.

Output is deterministic (sorted by line number) so the report diffs
cleanly across runs.
"""

import os
import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DASHBOARD_PAGE = REPO_ROOT / "app" / "(user)" / "dashboard" / "page.tsx"
REPORT_DIR = REPO_ROOT / "dev" / "reports"
REPORT_PATH = REPORT_DIR / "dashboard_panel_audit.md"

# ─────────────────────────────────────────────────────────────────────
# Regex catalog. Kept literal — the dashboard file is hand-written JSX
# with predictable shapes; a full TSX parser is overkill for AC15.
# ─────────────────────────────────────────────────────────────────────

# h1/h2/h3 with any class — captures the heading text content.
RX_HEADING = re.compile(r'<(h[1-3])(?:\s[^>]*)?>([^<{]*?)</\1>')

# Container that opens after a heading and looks panel-shaped.
RX_GRID_OPEN = re.compile(r'<div\s+className="(dashboard-grid|dashboard-charts-row)"')

# Recent activity table.
RX_TABLE_WRAP = re.compile(r'<div\s+className="table-wrap"')

# Standalone ChartWidget (will be flagged when not inside a panel block).
RX_CHART_WIDGET = re.compile(r'<ChartWidget\b')


def slugify(text: str) -> str:
    """Lower-snake-case a heading into a name segment that satisfies
    /^[a-z0-9_]{1,64}$/ (the substrate's NAME_RE)."""
    s = text.strip().lower()
    # Normalise HTML entities the dashboard uses.
    s = s.replace("&amp;", "and").replace("&rsquo;", "")
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s[:64] if s else "unnamed"


def find_candidates(path: Path):
    """Yield (line_no, classification, snippet, proposed_name) tuples."""
    text = path.read_text()
    lines = text.splitlines()

    # First pass: collect every heading and its line number.
    # Handles both <h3>Text</h3> on one line AND multi-line forms where
    # the opening tag, text, and closing tag span lines (common when JSX
    # attrs like style={{...}} wrap onto a new line).
    headings = []  # (line_no, heading_text)
    open_tag_re = re.compile(r'<(h[1-3])(?:\s|>)')
    close_tag_re = re.compile(r'</(h[1-3])>')
    inline_re = re.compile(r'<(h[1-3])(?:\s[^>]*)?>([^<]*?)</\1>')

    i = 0
    while i < len(lines):
        line = lines[i]
        m_inline = inline_re.search(line)
        if m_inline:
            headings.append((i + 1, m_inline.group(2).strip()))
            i += 1
            continue
        m_open = open_tag_re.search(line)
        if m_open:
            # Multi-line: gather text between open and close tag.
            buf = []
            # Take any text after the closing > on the same line.
            after_open = line[line.find(m_open.group(0)) + len(m_open.group(0)) - 1:]
            close_here = close_tag_re.search(after_open)
            if close_here:
                buf.append(after_open[after_open.find(">") + 1:close_here.start()])
            else:
                # Walk forward until we find the close tag.
                j = i + 1
                while j < len(lines):
                    cl = close_tag_re.search(lines[j])
                    if cl:
                        buf.append(lines[j][:cl.start()])
                        break
                    buf.append(lines[j])
                    j += 1
            text_ = " ".join(s.strip() for s in buf if s.strip())
            headings.append((i + 1, text_))
        i += 1

    # Second pass: for each heading, find what immediately follows.
    out = []
    for idx, (line_no, text_) in enumerate(headings):
        # Look at the next 10 lines for the panel-content opener.
        window = "\n".join(lines[line_no:line_no + 10])
        if RX_GRID_OPEN.search(window):
            classification = "panel"
        elif RX_TABLE_WRAP.search(window):
            classification = "panel"  # the table belongs inside a panel
        else:
            classification = "heading"
        out.append((line_no, classification, text_.strip(), slugify(text_)))

    # Third pass: tables not preceded by a heading-tagged region (info table).
    for i, line in enumerate(lines, start=1):
        if RX_TABLE_WRAP.search(line):
            # Skip if a heading on a prior nearby line already claimed it
            # (avoid double-counting Recent activity).
            if any(abs(i - h_line) <= 8 for h_line, _ in headings):
                continue
            out.append((i, "table", "(table-wrap)", "table"))

    # Fourth pass: ChartWidget instances (cataloged so 00251 knows the
    # population). These do not become panels themselves but each panel
    # contains many of them.
    chart_count = 0
    for i, line in enumerate(lines, start=1):
        if RX_CHART_WIDGET.search(line):
            chart_count += 1
    if chart_count:
        out.append((0, "chart-without-frame",
                    f"{chart_count} ChartWidget instances (not individually addressable; rolled into parent panel)",
                    f"chart_count_{chart_count}"))

    out.sort(key=lambda t: t[0])
    return out


def render_report(rel_path: str, candidates) -> str:
    today = date.today().isoformat()
    panel_count = sum(1 for _, c, _, _ in candidates if c == "panel")

    rows = []
    for line_no, classification, snippet, proposed in candidates:
        line_cell = str(line_no) if line_no > 0 else "—"
        snippet_clean = snippet.replace("|", "\\|")
        rows.append(f"| `{rel_path}` | {line_cell} | {classification} | {snippet_clean} | `{proposed}` |")

    body = [
        "# Dashboard panel audit — PLA-0005 / story 00250",
        "",
        f"_Generated: {today} — `npm run audit:dashboard`_",
        "",
        "## Summary",
        "",
        f"- Panel-shaped elements found: **{panel_count}**",
        f"- Total rows: **{len(candidates)}**",
        "",
        "Each row below is a candidate for `<Panel name=…>` (or `<Table>`/",
        "`<Navigation>`) when story 00251 flips `/dashboard` to strict mode.",
        "",
        "## Inventory",
        "",
        "| File | Line | Classification | Snippet | Proposed name |",
        "|---|---|---|---|---|",
        *rows,
        "",
        "## Notes",
        "",
        "- `panel` rows are heading-led blocks that should each be wrapped",
        "  in `<Panel name=…>` so the heading becomes the panel title and",
        "  the following grid/table is the panel body.",
        "- `chart-without-frame` is a roll-up count — individual",
        "  `<ChartWidget>` instances stay inside their parent panel and",
        "  are not separately addressable.",
        "- `table` rows belong inside their nearest panel; the table",
        "  itself becomes `<Table name=…>` for runtime address coverage.",
        "",
    ]
    return "\n".join(body) + "\n"


def main():
    if not DASHBOARD_PAGE.exists():
        print(f"ERROR: dashboard page not found at {DASHBOARD_PAGE}", file=sys.stderr)
        return 2

    candidates = find_candidates(DASHBOARD_PAGE)
    rel_path = str(DASHBOARD_PAGE.relative_to(REPO_ROOT))
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(render_report(rel_path, candidates))

    panel_count = sum(1 for _, c, _, _ in candidates if c == "panel")
    print(f"audit:dashboard  panels={panel_count}  rows={len(candidates)}  → {REPORT_PATH.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
