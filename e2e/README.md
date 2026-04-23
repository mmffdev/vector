# E2E tests

Selenium-driven end-to-end tests for Vector PM.

See [`dev/planning/plan_selenium_e2e.md`](../dev/planning/plan_selenium_e2e.md)
for the rollout plan.

## Prerequisites

- Selenium hub running at `localhost:4444` — use `<seleniumup>` to open the UI
  and verify, or see [`docs/c_selenium.md`](../docs/c_selenium.md).
- Next.js dev server running on `:5101` — use `<npm>`.

## Run

```
npm run e2e
```

Override targets via env vars (see `config.mjs`):

```
BASE_URL=http://host.docker.internal:5101 \
SELENIUM_URL=http://localhost:4444/wd/hub \
npm run e2e
```

## Watch tests run live

Open http://localhost:7900 (password `secret`) — noVNC viewer streaming the
container's browser session.
