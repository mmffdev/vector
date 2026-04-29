---
name: Claude Code portability system
description: Three-layer config system for syncing Claude Code across machines and projects
type: project
originSessionId: b4d83f67-968e-4e16-9bbe-ba9b25ff8d50
---
## Overview

Built a portable Claude Code configuration system for consistency across primary workstation and MacBook Pro.

**Why:** Need consistent Claude Code protocols, commands, and memories across multiple machines while working on various projects.

**Solution:** Three-layer architecture with init/sync scripts.

---

## Layers

| Layer | Location | Checked In? | Scope | Purpose |
|-------|----------|-------------|-------|---------|
| **Global Template** | `~/.claude/` | No | Machine-specific | Personal protocols, commands, memories for all projects |
| **Project Config** | `.claude/` | Yes | Project-specific | Project overrides, custom protocols, project memory |
| **Memories** | `~/.claude/memory/` + `.claude/memory/` | Split | Both | Global (machine-agnostic) + project-scoped facts |

---

## Scripts

### `claude-init.sh` — New Project Setup
- **Usage:** `bash .claude/setup/claude-init.sh /path/to/new-project`
- **What it does:**
  1. Copies CLAUDE.md, c_*.md protocols from template to target project
  2. Creates blank memory skeleton (.claude/memory/MEMORY.md)
  3. Optionally copies .claude/checks/ utilities
  4. Runs `git add .claude/` to stage files
  5. Prints next-step instructions

- **Idempotent:** Safe to run multiple times (skips if files exist)

### `claude-sync.sh` — Sync After Git Pull
- **Usage:** `bash .claude/setup/claude-sync.sh`
- **What it does:**
  1. Detects newer project protocols; suggests syncing to global
  2. Pulls new protocols from global template to project
  3. Updates CLAUDE.md if global version is newer
  4. Reports on memory sync opportunities
  5. Stages synced files to git

- **Direction:** One-way (global → project), plus bidirectional memory awareness
- **Non-destructive:** Never overwrites project edits without warning

---

## Workflow

### Adding a new protocol to share across machines

1. **On MacBook:** Create/edit `~/.claude/c_newskill-protocol.md`
2. **When stable:** Copy to project version `.claude/c_newskill-protocol.md`
3. **Commit:** `git add .claude/c_newskill-protocol.md && git commit ...`
4. **Push:** `git push`
5. **On workstation:** `git pull && bash .claude/setup/claude-sync.sh`

### Using mmff-Ops as a template for new project

```bash
# Create new project
mkdir /path/to/newproject
cd /path/to/newproject
git init

# Initialize Claude Code from mmff-Ops template
bash /Users/rick/Documents/MMFFDev-Projects/mmff-Ops/.claude/setup/claude-init.sh .

# Customize for the new project
vi .claude/CLAUDE.md  # Remove mmff-Ops-specific rules

# Commit
git add .claude/
git commit -m 'init: Add Claude Code config template'
```

---

## Key Design Decisions

**Why not merge global into project or vice versa?**
- Global contains machine-personal settings (shouldn't travel)
- Project configs must be in git for team consistency
- Sync scripts allow selective pull-in of updates

**Why "layer 3" memories split?**
- Global memory (`~/.claude/projects/<hash>/memory/`) lives on each machine, persists across your sessions
- Project memory (`.claude/memory/`) is in git, shared at pull time
- Both indexable via MEMORY.md

**Why init.sh copies, not symlinks?**
- Git can't track symlinks reliably across machines
- Copying gives each project independence to customize

**Why sync.sh is pull-only (not push)?**
- Prevents accidental pollution of global template
- Project configs are the source of truth (they're in git)
- Updates flow: global template → project (one direction) + bidirectional memory awareness

---

## File Locations

```
~/.claude/
├── CLAUDE.md                              # Global default
├── c_addpaper-protocol.md                 # Shared by all projects
├── c_mstories-protocol.md
├── ... (other protocols)
└── projects/
    └── -Users-rick-Documents-...mmff-Ops/
        └── memory/
            ├── MEMORY.md                  # Index
            ├── project_architecture.md    # mmff-Ops facts
            └── ... (other memory files)

.claude/                                   # This project, in git
├── CLAUDE.md                              # Project override
├── c_*.md                                 # Project-specific protocols
├── memory/                                # Project memory, in git
│   ├── MEMORY.md                          # Index
│   ├── database_schema_reference.md       # mmff-Ops DB schemas
│   └── ...
└── setup/                                 # Sync/init scripts
    ├── claude-init.sh                     # Executable
    ├── claude-sync.sh                     # Executable
    └── README.md                          # Full guide
```

---

## Testing the System

**Test init.sh:**
```bash
mkdir /tmp/test-project
bash .claude/setup/claude-init.sh /tmp/test-project
ls -la /tmp/test-project/.claude/
# Should see: CLAUDE.md, c_*.md, memory/MEMORY.md
```

**Test sync.sh after pull:**
```bash
git pull origin main
bash .claude/setup/claude-sync.sh
git status
# Should show synced files staged
git diff --cached
# Review changes before commit
```

---

## Rules

1. **Always run sync after `git pull`** — keeps ~/.claude/ in sync
2. **Project edits override global** — edit `.claude/`, not `~/.claude/`, for project-specific changes
3. **Keep global lean** — only put things that apply to all projects in ~/.claude/
4. **Memory is bidirectional** — check both ~/.claude/projects/... and .claude/memory/
5. **Init.sh is idempotent** — safe to re-run when setting up new machines
