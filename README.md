# Vector PM

Enterprise agile / portfolio management platform. Private repo, Mac-only dev.

## Bring-up on a fresh Mac

**Prereqs:** Node 20+, Go 1.22+ (only if rebuilding the backend binary), Docker Desktop (only if running E2E tests), SSH key `~/.ssh/id_ed25519` with access to `mmffdev.com`.

```bash
git clone git@github.com:mmffdev/vector.git "MMFFDev - PM"
cd "MMFFDev - PM"
npm install
```

Env files (`backend/.env.local`) are committed — no manual setup.

### Quickest path: the launcher

Double-click `MMFF Vector Dev.app` — it brings up all three local services in one go: SSH tunnel (`localhost:5434` → remote Postgres), Go backend (`:5100`), Next.js frontend (`:5101`). See [`docs/c_dev-launcher.md`](docs/c_dev-launcher.md).

### Manual path

```bash
# 1. SSH tunnel to Postgres (one-off setup adds an `mmffdev-pg` alias)
./dev/scripts/ssh_manager.sh        # appends SSH config + opens tunnel
# subsequent sessions:
ssh -N -f mmffdev-pg                # localhost:5434 → remote :5432

# 2. Frontend (new terminal, repo root)
npm run dev                          # http://localhost:5101

# 3. Backend (new terminal)
cd backend
./server                             # tracked arm64 binary — http://localhost:5100
# or rebuild from source:
go build -o server ./cmd/server && ./server
```

If macOS blocks the tracked binary on first run: `xattr -dr com.apple.quarantine backend/server`.

### Optional: E2E tests

Selenium runs in a Docker container that drives a real browser against the live dev server.

```bash
docker run -d --name Selenium-Vector \
  -p 4444:4444 -p 7900:7900 \
  --shm-size 2g \
  selenium/standalone-all-browsers:nightly

npm run e2e                          # node:test runner; specs in e2e/
```

Watch the browser live at `http://localhost:7900` (password `secret`); Grid UI at `http://localhost:4444/ui/`. See [`docs/c_selenium.md`](docs/c_selenium.md) and [`dev/planning/plan_selenium_e2e.md`](dev/planning/plan_selenium_e2e.md).

## Project docs

See [`.claude/CLAUDE.md`](.claude/CLAUDE.md) for the full topic index.
