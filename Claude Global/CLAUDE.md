# Global Claude Instructions

**RULE: All skills, commands, and project-specific guidance MUST live in project `.claude/CLAUDE.md` files only. Nothing belongs here.**

This file is a redirect only. Check the relevant project's `.claude/CLAUDE.md` for its working practices, skills, commands, and documentation.

---

## Project CLAUDE.md Files

- [MMFFDev - PM](../Documents/MMFFDev-Projects/MMFFDev%20-%20PM/.claude/CLAUDE.md)
- [Other projects](../Documents/MMFFDev-Projects/) — each has its own `.claude/CLAUDE.md`

---

## MCP Configuration

All MCP servers, tool configurations, and integrations are defined **in project scope only**. Do not add global MCP definitions.

**Hard rule:** If you are about to write a skill, command, or tool binding, check the project's `.claude/` directory first. It lives there, not here.

---

## Documentation Principles (Global)

When working in any project:

1. **Keep files lean.** Remove redundancy. Every line must justify its existence.
2. **Use lazy loading.** Split content across child files loaded only when needed.

### Naming Convention

Child files follow a depth-indicating pattern using `c_` prefixes:

| Depth | Pattern | Example |
|---|---|---|
| Level 1 | `c_xxx.md` | `c_security.md` |
| Level 2 | `c_c_xxx.md` | `c_c_authentication.md` |
| Level 3 | `c_c_c_xxx.md` | `c_c_c_saml_config.md` |

**Rule:** Each additional `c_` indicates one level deeper.

---

## Model Selection Governance

Recommend a model switch ONLY when ≥80% confident the current model is mismatched to the task ahead. Otherwise stay silent.

**Tiers:**
1. **Opus** — architecture, cross-file refactors, debugging, security review, schema/migration design
2. **Sonnet** — feature implementation, single-file refactors, tests, code review, documentation
3. **Haiku** — lookups, status checks, file reads, trivial edits, simple fixes

**Format when triggered:**
> "This looks like <tier> work (reason: <one phrase>). Currently on <current model>. Switch before I start?"

---

## Quick Reference

For project-specific commands (`<stories>`, `<backlog>`, `<npm>`, etc.), see your project's `.claude/CLAUDE.md`.
