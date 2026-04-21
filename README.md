# Vector PM

Enterprise agile / portfolio management platform. Private repo, Mac-only dev.

## Bring-up on a fresh Mac

Prereqs: Node 20+, Go 1.22+ (only if rebuilding the backend binary), SSH key `~/.ssh/id_ed25519` with access to `mmffdev.com`.

```bash
git clone git@github.com:mmffdev/vector.git
cd vector

# 1. SSH tunnel to Postgres (keep this terminal open)
ssh -N -L 5434:localhost:5432 root@mmffdev.com

# 2. Frontend (new terminal, repo root)
npm install
npm run dev                 # http://localhost:3000

# 3. Backend (new terminal)
cd backend
./server                    # tracked arm64 binary; see note below
# or rebuild from source:
go build -o server ./cmd/server && ./server
```

If macOS blocks the tracked binary on first run: `xattr -dr com.apple.quarantine backend/server`.

Env files (`backend/.env.local`) are committed — no manual setup.

See [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for project docs index.
