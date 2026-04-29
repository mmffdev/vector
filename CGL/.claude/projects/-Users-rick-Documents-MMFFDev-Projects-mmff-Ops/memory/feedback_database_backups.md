---
name: Database backups required for schema changes
description: Major DB schema changes require versioned backups committed to git
type: feedback
originSessionId: 3ee21391-2fe7-4ece-97d7-ffcf7701969c
---
**Rule:** Every major database schema change must trigger a backup.

**How to apply:**
- Before committing schema migrations (ALTER TABLE, new tables, etc.)
- Create timestamped backups: `backend/data/backups/ops.db.YYYY-MM-DD-HHmm`
- Also commit: a plain `backend/data/ops.db` (current state)
- Both files go to git alongside the schema change commit
- This creates a recoverable point if the migration fails or needs to roll back

**Why:**
- Reproducible state across machines (schema + data snapshot)
- Safe fallback if a migration breaks something
- Clear git history of "what the DB looked like at this commit"
- Remote machines can recover to a known good state
