# Handover — RabbitMQ + Notifications System (B11.4)

**Built:** 2026-05-20, late night.
**Scope refs:** B11.4 (notifications runner — done), B11.5 (@-mentions — done previous session).
**State at handover:** end-to-end pipeline alive and verified. Backend running on `:5100` (PID was 24981 at smoke test time), RabbitMQ up on the dev swarm, transactional outbox + relay + 3 dispatchers running, mentions producer wired through. Stubs documented below — none of them block dogfooding the bell.

> If you've just opened a fresh session, **start by reading [Vector_Scope.md](Vector_Scope.md) B11.4 + B11.5** — the entries are the canonical summary. This doc is the operator's brief: where the seams are, what's still half-built, and exactly where to pick up.

---

## What's working right now

You can fire a mention (when a resolver is registered — see stubs below) or hand-inject an outbox row, and the full pipeline runs:

```
producer tx
  ├── INSERT users_mentions               (mentions.Service.Create)
  └── INSERT notifications_outbox         (DBNotifier.EnqueueTx — same tx)
COMMIT
  → pg_notify('notifications_outbox_inserted')
  → Relay LISTEN wakes up
  → UPDATE ... RETURNING (claim batch, SKIP LOCKED)
  → RabbitMQ Publish × 3 routing keys (kind.in_app | kind.email | kind.sse)
  → UPDATE outbox SET delivered_at = now()

RabbitMQ topic exchange "notifications"
  ├── *.in_app → queue notifications.in_app
  │     → InApp dispatcher → INSERT users_notifications
  ├── *.email  → queue notifications.email
  │     → Email dispatcher → users.email lookup → mailer.SendUserUpdate
  └── *.sse    → queue notifications.sse
        → SSE dispatcher → realtime.Hub.Publish("notifications:<user_id>")
```

**Smoke-tested 2026-05-20:** synthetic outbox row → full round-trip → `users_notifications` row landed with the mention template rendered correctly (`"You were mentioned in DE-101 — Smoke test mention"` + body). Queues drained, attempts=0, last_error=NULL. See the smoke-test command in [§ Quick health check](#quick-health-check) below — re-run any time you want to confirm.

---

## Infrastructure cheat sheet

| Thing | Where | Notes |
|---|---|---|
| Broker | RabbitMQ 3.13.7 on swarm `vector-dev` | Container `vector-dev_rabbitmq`. Persistent volume `rmqdata`. |
| AMQP port | `localhost:5672` (via SSH tunnel) | Forwarded by `~/.ssh/config` Host `vector-dev-pg`. |
| Management UI | `http://localhost:15673` | **Local port shifted from 15672** because the prod tunnel binds 15672. Login `mmff_dev` + the password from `backend/.env.dev`'s `AMQP_URL`. |
| Broker password | docker secret `rabbitmq_password` on swarm + cleartext in `AMQP_URL` env var | Rotate both together. Recipe in [infra/swarm/README.md](infra/swarm/README.md) § "First-time rabbitmq setup". |
| Backend env | `backend/.env.dev` → `AMQP_URL` | Empty value = falls back to NoopNotifier (rest of backend still boots). |
| Stack file | [infra/swarm/vector-dev-stack.yml](infra/swarm/vector-dev-stack.yml) | Deploy from manager: `scp` + `docker stack deploy`. |
| SSH config | `~/.ssh/config` Host `vector-dev-pg` | Add `LocalForward 5672 localhost:5672` + `LocalForward 15673 localhost:15672` (already done). |

### Why the entrypoint wrapper (read before touching the stack file)

`rabbitmq:3.13+` hard-deprecates `RABBITMQ_DEFAULT_PASS_FILE`. The "use a config file" advice in the broker's error message is **also wrong** — `default_pass_file` is not a valid `rabbitmq.conf` key (cuttlefish rejects it). The only supported bootstrap path is the `RABBITMQ_DEFAULT_PASS` env var with cleartext, which we can't ship in git. Solution: override the entrypoint with a tiny bash wrapper that reads the docker-secret file at container start and exports `RABBITMQ_DEFAULT_PASS` before exec'ing the real entrypoint.

```yaml
entrypoint: ["/bin/bash", "-c"]
command:
  - 'export RABBITMQ_DEFAULT_USER=mmff_dev && export RABBITMQ_DEFAULT_PASS=$(cat /run/secrets/rabbitmq_password) && exec docker-entrypoint.sh rabbitmq-server'
```

If you redeploy and rabbitmq won't start, **check this block first** — modern rabbit versions sometimes shift what they accept.

**Tech debt: `TD-RMQ-PASS-FILE`** — when convenient, migrate to a docker-config-templated `rabbitmq.conf` mounted at `/etc/rabbitmq/rabbitmq.conf`. The conf file would need to live in a docker config object, not in the stack file. We tried this once; it failed because we used a non-existent setting. Future attempt should use `RABBITMQ_LOAD_DEFINITIONS` (JSON definitions file with pre-seeded user/vhost/perms) instead of trying to inline `default_pass`.

---

## File map

### Backend

```
backend/internal/notifications/
├── notifier.go              — Notifier interface + TxNotifier interface (for transactional outbox)
├── dbnotifier.go            — DBNotifier (production). Satisfies TxNotifier.
├── relay.go                 — Outbox drainer. LISTEN/NOTIFY + 30s tick safety net.
├── templates.go             — Kind → (title, body) registry. RegisterMentionDefault is wired.
├── prefs.go                 — Per-user per-channel pref cache (default-on)
├── service.go               — Read service for the bell (list, unread-count, mark-read, mark-all-read, prefs)
├── handler.go               — HTTP handler (dual-mounted)
├── dto.go                   — MapPublicUserNotification (PLA-0039 seam)
├── errors.go                — ErrNotFound, ErrInvalidInput
├── sql.go                   — All SQL constants. SqlInsertUserNotificationFromEvent + SqlSelectUserEmail are exported for the dispatchers package.
├── broker/
│   ├── broker.go            — Broker interface + Envelope struct
│   ├── rabbit.go            — RabbitBroker impl. Topic exchange "notifications", durable queues, manual ack, prefetch 16.
│   └── noop.go              — NoopBroker fallback (used when AMQP_URL is empty or dial fails)
└── dispatchers/
    ├── inapp.go             — Writes users_notifications. Consumes *.in_app.
    ├── email.go             — Calls messaging/email.Service.SendUserUpdate. Consumes *.email.
    └── sse.go               — realtime.Hub.Publish on topic "notifications:<user_id>". Consumes *.sse.
```

### Schema

| File | Tables / changes |
|---|---|
| [db/mmff_vector/schema/230_notifications.sql](db/mmff_vector/schema/230_notifications.sql) | `notifications_outbox`, `users_notifications`, `users_notifications_prefs`, `notifications_outbox_notify()` trigger function, `notifications_outbox_after_insert` trigger |
| DOWN counterpart | Drops all of the above |

### Wire-up

| File | What |
|---|---|
| [backend/cmd/server/main.go](backend/cmd/server/main.go) ~L595-L650 | Construction of `notifPrefs` / `notifTemplates` / `notifBroker` / `notifier` / mentionsSvc / `notifSvc` / `notifH`. Relay + 3 dispatcher goroutines spawned here. |
| main.go ~L1311 (`/_site`) and ~L1840 (`/samantha/v2`) | `/notifications` routes |
| [backend/internal/mentions/service.go](backend/internal/mentions/service.go) `Create()` | Type-asserts `notifier.(notifications.TxNotifier)` and calls `EnqueueTx` inside its own tx — true transactional outbox. Falls back to post-commit `Enqueue` for NoopNotifier. |
| [dev/registries/public_transport_packages.json](dev/registries/public_transport_packages.json) | `notifications` registered (PLA-0039 lint) |

### Frontend

| File | What |
|---|---|
| [app/lib/apiSite/index.ts](app/lib/apiSite/index.ts) | `notifications` registry block at bottom of file (`list / unreadCount / markRead / markAllRead / listPrefs / upsertPref`). Types `UserNotification` and `NotificationPref` exported. |
| [app/components/NotificationBell.tsx](app/components/NotificationBell.tsx) | Bell button + dropdown + unread badge + mark-all-read. Polls `unreadCount` every 60s; calls `useNotificationsStream` for real-time nudges; refetches the list on dropdown-open. CSS classes follow `notification-bell__Panel_List_item` root-block convention — **no CSS file yet**, will look unstyled until classes are defined. |
| [app/hooks/useNotificationsStream.ts](app/hooks/useNotificationsStream.ts) | **Stub.** Currently a no-op. See "Where to pick up" below. |

---

## Stubs / known incomplete

Listed roughly in order of "how soon you'll trip on this":

### 1. Mention context resolvers (mentions still 400s)
**Problem:** `POST /_site/mentions` currently returns `400 context_kind: unresolved` because no `mentions.Service.RegisterContextResolver(...)` calls have been wired. Each artefact kind (defect, story, comment, etc.) needs to register a resolver that turns `{kind: "defect", id: "DE-101"}` into a human label.

**Fix:** in `main.go`, after `mentionsSvc` is constructed, call `mentionsSvc.RegisterContextResolver("defect", ...)` for each kind. The resolver is `func(rctx mentions.ResolveCtx, contextID string) (label string, err error)` — it gets the subscription/workspace context and the ID, looks up the artefact, returns its title.

**Where to look:**
- The artefactitems package owns the artefacts table; its service has lookup methods.
- The label format the mention template expects is `"DE-101 — Login fails on Safari"` (id + ` — ` + title).
- Resolver registry lives in `backend/internal/mentions/service.go` `RegisterContextResolver`.

**Verify when done:** `curl -X POST /_site/mentions -d '{...defect...}'` returns 201 with persisted rows, not 400.

### 2. SSE / real-time wire-up for the bell
**Problem:** The SSE dispatcher publishes nudges to `realtime.Hub` on topic `notifications:<user_id>`, but **no frontend subscriber exists yet**. The bell falls back to 60s polling.

**Two pieces missing:**

**(a) Backend SSE endpoint** — `GET /_site/notifications/stream` is referenced in the bell's `useNotificationsStream` hook but the route doesn't exist in `main.go`. Either:
   - Add a chi route that opens an SSE connection, subscribes to the user's topic, and forwards `Hub.Publish` calls as `data: <json>\n\n` lines, OR
   - Reuse the existing realtime WebSocket route (look at `backend/internal/realtime/`) and have the frontend subscribe there.

**(b) Frontend hook implementation** — `app/hooks/useNotificationsStream.ts` is a no-op. Once the backend stream exists, this hook should open an EventSource (or attach to the WS client), filter messages for `type: "notification.created"`, and call the callback. **Resolve to a no-op without error when the stream can't connect** — the bell relies on the polling fallback.

**Verify when done:** create a mention, open the bell, watch the count update within ~1s instead of waiting up to 60s for the next poll.

### 3. Rich-text editor host
The `MentionPicker` + `MentionToolbarButton` scaffold exists but **isn't placed in any editor**. When the rich-text editor is chosen (TipTap, Lexical, ProseMirror, etc.), wire the toolbar button into its toolbar and have `onMention(selected)` insert mention chips/tokens at the cursor.

### 4. NotificationBell not placed in the chrome
The component renders correctly but isn't mounted anywhere. Drop it into the top-right of the page shell or the user avatar menu when the visual layout is decided. CSS classes also need to be defined (see file map note).

### 5. Bell preferences UI
`apiSite.notifications.listPrefs / upsertPref` work, but there's no settings page that calls them. Build under `app/(user)/account/notifications/page.tsx` or similar — a matrix of (kind × channel) checkboxes, default-on for unset cells.

### 6. `notifBroker` not closed at shutdown
`main.go` has `_ = notifBroker` because there's no graceful-shutdown hook. The relay + dispatcher goroutines exit on ctx cancellation, but the AMQP connection itself isn't explicitly `Close()`d. Low priority — connection is heartbeat-managed; broker tolerates abrupt disconnects.

### 7. Team-scope mention SQL
Already documented under B11.5. Waits on `users_teams_members`. Service degrades to tenant scope on query error.

### 8. Homepage swarm service
Pre-existing crash-loop on `mkdir '/app/config/logs'`. Not caused by this work. Three weeks stale. Address out-of-band.

---

## Quick health check

Run this any time to confirm the pipeline is alive:

```bash
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
  PW=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) && \
  AMQP_PASS=$(grep '^AMQP_URL=' backend/.env.dev | sed 's/^AMQP_URL=amqp:\/\/mmff_dev://; s/@.*//') && \
  echo "=== broker reachable ===" && \
  curl -sS -u "mmff_dev:$AMQP_PASS" http://localhost:15673/api/whoami | python3 -m json.tool && \
  echo "=== queues + consumers ===" && \
  curl -sS -u "mmff_dev:$AMQP_PASS" "http://localhost:15673/api/queues/%2F" | \
    python3 -c "import sys,json; d=json.load(sys.stdin); [print(f'  {q[\"name\"]}: consumers={q[\"consumers\"]}, messages={q[\"messages\"]}') for q in d]" && \
  echo "=== outbox depth ===" && \
  PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -c \
    "SELECT COUNT(*) FILTER (WHERE delivered_at IS NULL) AS undelivered,
            COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) AS delivered,
            COUNT(*) FILTER (WHERE attempts >= 5) AS parked
     FROM notifications_outbox
       AS o(id, sub, rec, kind, payload, created_at, claimed_at, delivered_at, attempts, last_error);"
```

Expected:
- `whoami` returns `mmff_dev` + `[administrator]`
- 3 queues, each with `consumers=1` and `messages=0` (queues drain instantly)
- `undelivered=0`, `parked=0`. (If `undelivered>0`, the relay isn't running or can't reach the broker.)

### Fire a test event

```bash
# Inject one outbox row → relay should pick it up within ~1 second.
cd "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector" && \
  PW=$(grep '^DB_PASSWORD=' backend/.env.dev | cut -d= -f2-) && \
  PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -c "
    INSERT INTO notifications_outbox (
      notifications_outbox_id_subscription,
      notifications_outbox_id_user_recipient,
      notifications_outbox_kind,
      notifications_outbox_payload
    ) VALUES (
      '00000000-0000-0000-0000-000000000001',
      (SELECT id FROM users WHERE email='claude_2_test@mmffdev.com' LIMIT 1),
      'mention',
      jsonb_build_object(
        'Kind', 'mention',
        'SubscriptionID', '00000000-0000-0000-0000-000000000001',
        'WorkspaceID',    '00000000-0000-0000-0000-000000000001',
        'AuthorUserID',   (SELECT id FROM users WHERE email='claude_1_test@mmffdev.com' LIMIT 1),
        'RecipientUserID',(SELECT id FROM users WHERE email='claude_2_test@mmffdev.com' LIMIT 1),
        'ContextKind',    'defect',
        'ContextID',      'DE-101',
        'ContextLabel',   'DE-101 — Smoke test',
        'Snippet',        'Test event from handover_rmq.md'
      )
    );"
sleep 1
PGPASSWORD="$PW" /opt/homebrew/opt/libpq/bin/psql -h localhost -p 5435 -U mmff_dev -d mmff_vector -c \
  "SELECT users_notifications_title, users_notifications_body
   FROM users_notifications ORDER BY users_notifications_created_at DESC LIMIT 1;"
```

If the second query returns the test event, the pipeline is healthy. If not, check:
1. Is the backend running? `lsof -ti :5100`
2. Did the backend log a rabbit dial failure on boot? Look for `notifications.broker: rabbit connected` in stdout.
3. Is the broker up? `docker service ls --filter name=vector-dev_rabbitmq` on `vector-dev-pg` should show 1/1.
4. Is the tunnel up? `nc -z localhost 5672` should succeed.

---

## Troubleshooting

### "Broker is down / unreachable"
- Check the swarm: `ssh vector-dev-pg 'docker service ls --filter name=vector-dev_rabbitmq'` → expect `1/1`
- If 0/1, check logs: `ssh vector-dev-pg 'docker service logs --tail 50 vector-dev_rabbitmq'`
- 99% of failures here are the entrypoint wrapper — see "Why the entrypoint wrapper" above

### "Backend won't connect to RMQ"
- Check `AMQP_URL` is set in `backend/.env.dev` and uncommented
- Check the tunnel: `nc -z localhost 5672`. If not, the dev SSH tunnel (PID found via `ps -ef | grep "ssh -N.*vector-dev-pg"`) needs to be restarted. The tunnel reads from `~/.ssh/config` Host `vector-dev-pg` which now forwards 5672 + 15673.
- Restart the backend after fixing — it dials once at boot

### "Outbox rows aren't being drained"
- Relay should LISTEN; if it dropped, the 30s tick is the safety net
- Check `notifications_outbox` for `claimed_at IS NULL AND attempts < 5` — if relay is alive these stay there for <1s

### "Outbox row stuck with attempts >= 5"
- Partial index excludes them. The relay won't retry.
- To force a retry: `UPDATE notifications_outbox SET attempts = 0, claimed_at = NULL, last_error = NULL WHERE id = '...';`

### "Email dispatcher not sending"
- Dev has `EMAIL_MODE=console` — emails print to backend stdout instead of going via SMTP. That's correct for dev.
- Dispatcher consumes the message and ack's regardless of whether the mailer actually sent — see comment in `dispatchers/email.go`. Don't expect bounce errors on dev.

### "rabbitmq_password rotation"
1. `ssh vector-dev-pg` and create a new secret: `docker secret create rabbitmq_password_v2 -`
2. Update the stack file's `secrets:` block to reference `rabbitmq_password_v2`
3. Update `AMQP_URL` in `backend/.env.dev`
4. Redeploy + restart backend
5. Remove old secret: `docker secret rm rabbitmq_password`

---

## Architectural decisions worth remembering

**Why the outbox stayed when we added RabbitMQ.** Cleartext from the conversation: "this is the canonical transactional-outbox pattern — guarantees no notification is silently lost if RMQ is down when a mention fires. SOC 2 auditors love it." If RMQ is unreachable when a mention commits, the row sits in the outbox until the relay catches up. We deliberately did NOT switch to publish-directly-to-RMQ.

**Why nudge-only on SSE.** The dispatcher sends `{type: "notification.created"}` with no body. The frontend refetches from `/_site/notifications` on each nudge. One write (InApp), one nudge (SSE), one source of truth (the read model). Dual-write skew is impossible by construction.

**Why a Broker interface even though we only have one impl.** `Broker` lets `RabbitBroker` and `NoopBroker` coexist — backend boots cleanly in environments without RMQ (CI, ephemeral test rigs, dev machines that haven't pulled the broker yet). Swapping in Kafka or NATS later is a same-day refactor.

**Why `TxNotifier` is a separate interface from `Notifier`.** `NoopNotifier` doesn't need a tx (it logs and returns). `DBNotifier` needs the producer's tx to make the outbox write atomic with the producer's domain write. The mentions service type-asserts: if the notifier supports `EnqueueTx`, use it inside the tx; otherwise post-commit Enqueue. Clean fallback.

**Why default-on for prefs.** Users who never visit the settings page get notifications. Inverse policy (default-off until opt-in) feels respectful but kills adoption. We can always tighten later.

**Why 5-attempt cap.** Defence-in-depth against a producer that's permanently un-deliverable (e.g. a recipient who was deleted between mention and dispatch). The partial index drops rows at attempts=5 so the relay doesn't busy-loop. Rows are still queryable for diagnostics; the `last_error` column tells you why.

---

## What I'd build next, in order

1. **Mention resolvers** — without these, the @-mention surface still 400s. Single small wire-up in main.go per artefact kind.
2. **SSE handler + hook implementation** — completes the real-time loop. Bell goes from 60s polling to instant.
3. **Place the bell in the chrome** — it's a feature once it's visible.
4. **Bell prefs UI** — the matrix already works server-side, just needs a page.
5. **Then** consider extending kinds — watchers (`kind: "watcher.activity"`), digest emails (`kind: "daily_digest"`), library-release announcements (`kind: "library.release"`).

---

## Commits this session

```
(uncommitted as of handover write)
```

All work is on `main`, uncommitted. The user has not yet committed this session — when you're ready, the scope of work spans:

- `infra/swarm/vector-dev-stack.yml` + `infra/swarm/README.md` (RabbitMQ added)
- `backend/.env.dev` (AMQP_URL set; gitignored, won't be in the commit)
- `~/.ssh/config` (LocalForward 5672 + 15673; outside the repo, won't be in the commit)
- `db/mmff_vector/schema/230_notifications.sql` + DOWN
- `backend/internal/notifications/` (everything new under here)
- `backend/internal/mentions/service.go` (TxNotifier swap-in)
- `backend/cmd/server/main.go` (wiring)
- `backend/go.mod` + `go.sum` (amqp091-go dep)
- `dev/registries/public_transport_packages.json` (notifications added)
- `app/lib/apiSite/index.ts` (notifications block)
- `app/components/NotificationBell.tsx` + `app/hooks/useNotificationsStream.ts`
- `Vector_Scope.md` + `.claude/scope-refs.map` (B11.4 / B11.5 entries)
- `handover_rmq.md` (this file)

Suggested commit message style (matching the repo's convention):

```
feat(notifications): B11.4 RabbitMQ-backed notifications runner

- Add RabbitMQ to vector-dev swarm (mig deps + entrypoint wrapper)
- Migration 230: notifications_outbox + users_notifications + prefs + NOTIFY trigger
- broker.Broker interface (RabbitBroker + NoopBroker)
- DBNotifier (TxNotifier) — transactional outbox writes
- Relay: LISTEN/NOTIFY + 30s tick, claim-batch SKIP-LOCKED, 5-attempt cap
- Three dispatchers: InApp, Email, SSE
- Handler + dual-mount on /_site + /samantha/v2
- Mentions producer swapped to DBNotifier (outbox inside its own tx)
- Frontend: apiSite.notifications + NotificationBell + useNotificationsStream stub

Smoke test: outbox insert → relay → broker → InApp → users_notifications
round-trip verified end-to-end.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

---

**Authored:** 2026-05-20 by Claude during the session that built it. If anything in this doc contradicts the code, trust the code and patch this file.
