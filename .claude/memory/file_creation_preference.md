---
name: File Creation in Paths with Spaces
description: Use Bash for files in directories with spaces in the name
type: feedback
originSessionId: b3e8cf55-4b99-492a-8686-3ecd102e7b51
---
**Rule:** When creating files in paths containing spaces (e.g., "MMFFDev - PM"), use Bash `cat > file << 'EOF'` instead of the Write tool.

**Why:** The Write tool sometimes has path encoding issues with spaces; Bash is more reliable.

**How to apply:** For any Write operations in `/Users/rick/Documents/MMFFDev-Projects/MMFFDev - PM`, use Bash with heredoc syntax instead.
