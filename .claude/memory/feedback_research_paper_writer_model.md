---
name: Research-paper writer agent uses Sonnet; investigators use Opus
description: When producing a research paper that synthesises sub-agent findings, route the WRITER (paper authoring + JSON file write) to Sonnet, and keep upstream INVESTIGATOR sub-agents on Opus.
type: feedback
originSessionId: 1c78088f-5e4b-44b3-a787-05861b3b8995
---
When the user asks for a research paper (e.g. `<addpaper>`, `/research --page`) that requires upstream scan/investigation agents:

- **Investigator sub-agents** (code scans, security audits, orphaned-file sweeps, web-research crawlers) → run on **Opus**. They need depth and judgment over many files.
- **Writer sub-agent** (the one that synthesises findings, builds the heat-mapped table, and writes the `RNNN.json` file) → run on **Sonnet**. Writing structured output is Sonnet's strength and saves Opus budget for the harder reasoning.

**Why:** User asked explicitly on 2026-05-04 during the R035 honey-trap-style audit task. They want Opus reserved for analysis, Sonnet reserved for authoring/formatting.

**How to apply:**
- When spawning the writer agent via the Agent tool, pass `model: "sonnet"`.
- When spawning investigator agents, omit the `model` param (inherits Opus from parent) or set `model: "opus"` explicitly.
- This applies to ALL multi-stage research-paper workflows, not just R035.
