# Backend dev pipeline — one command per task. Both humans and the
# Vector Launcher invoke these targets so behaviour is identical
# whether you ran `make dev` in a terminal or clicked Start in the
# launcher. This file is the single source of truth for "how do I
# start/stop/restart the backend".

AIR  := $(shell go env GOPATH)/bin/air
BIN  := /tmp/vector-backend
SRV_PORT := 5100
PSQL := /opt/homebrew/Cellar/libpq/18.3/bin/psql
TEST_ENV := .env.local

.PHONY: dev run build clean install-air kill help test-db-reset

help:
	@echo "make dev            — live-reload via air (recommended)"
	@echo "make run            — one-shot compile + run (legacy launcher path)"
	@echo "make build          — compile only, no run"
	@echo "make kill           — kill anything on :$(SRV_PORT)"
	@echo "make install-air    — install the air binary into GOPATH/bin"
	@echo "make test-db-reset  — drop & recreate test mmff_vector + mmff_library, replay migrations 001..N"

# Live-reload. air recompiles on .go save and restarts in-place.
# The launcher invokes this as `make dev` from BackendManager.
dev: install-air
	@$(AIR) -c .air.toml

# Single-shot — compile and run once, no watcher. Mirrors the
# launcher's pre-air spawn pattern; kept for headless/CI use.
run: build
	@$(BIN)

build:
	@go build -o $(BIN) ./cmd/server

# Free :5100 — clears any stale listener so `make dev` can bind.
kill:
	@lsof -ti tcp:$(SRV_PORT) | xargs -r kill -9 2>/dev/null || true

clean:
	@rm -rf /tmp/air-vector-backend $(BIN)

install-air:
	@if [ ! -x "$(AIR)" ]; then \
	  echo "installing air..."; \
	  go install github.com/air-verse/air@latest; \
	fi

# Drop and recreate the test cluster's databases, then replay every
# top-level migration in db/mmff_vector/schema/ and db/mmff_library/schema/. Idempotent:
# running it twice produces identical state (DROP IF EXISTS + CREATE,
# then a fresh schema_migrations replay from 001..N).
#
# Targets the cluster described by backend/.env.local (test cluster on
# the tunnel that file configures — currently :5434). Dev (:5435),
# staging, and production are NEVER touched by this target.
#
# Hard requirement: the role in .env.local must be a superuser on the
# test cluster (it is, by setup) so it can DROP DATABASE.
test-db-reset:
	@if [ ! -f "$(TEST_ENV)" ]; then echo "missing $(TEST_ENV) — copy from .env.example"; exit 1; fi
	@if [ ! -x "$(PSQL)" ]; then echo "missing $(PSQL) — brew install libpq"; exit 1; fi
	@DB_HOST=$$(grep -E '^DB_HOST=' $(TEST_ENV) | cut -d= -f2-); \
	 DB_PORT=$$(grep -E '^DB_PORT=' $(TEST_ENV) | cut -d= -f2-); \
	 DB_USER=$$(grep -E '^DB_USER=' $(TEST_ENV) | cut -d= -f2-); \
	 DB_PASS=$$(grep -E '^DB_PASSWORD=' $(TEST_ENV) | cut -d= -f2-); \
	 DB_NAME=$$(grep -E '^DB_NAME=' $(TEST_ENV) | cut -d= -f2-); \
	 LIB_NAME=$$(grep -E '^LIBRARY_DB_NAME=' $(TEST_ENV) | cut -d= -f2-); \
	 if [ "$$DB_PORT" = "5435" ]; then echo "REFUSING: $(TEST_ENV) points at dev (:5435). test-db-reset MUST run against the test cluster."; exit 1; fi; \
	 if [ "$$DB_PORT" = "5432" ] || [ "$$DB_PORT" = "5433" ]; then echo "REFUSING: $(TEST_ENV) points at port $$DB_PORT (not the test tunnel). aborting."; exit 1; fi; \
	 echo "→ resetting test cluster $$DB_HOST:$$DB_PORT (user=$$DB_USER) — dbs: $$DB_NAME, $$LIB_NAME"; \
	 PGPASSWORD="$$DB_PASS" $(PSQL) -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('$$DB_NAME','$$LIB_NAME') AND pid <> pg_backend_pid();" >/dev/null || exit 1; \
	 PGPASSWORD="$$DB_PASS" $(PSQL) -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $$DB_NAME;"        || exit 1; \
	 PGPASSWORD="$$DB_PASS" $(PSQL) -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $$LIB_NAME;"       || exit 1; \
	 PGPASSWORD="$$DB_PASS" $(PSQL) -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $$DB_NAME OWNER $$DB_USER;"  || exit 1; \
	 PGPASSWORD="$$DB_PASS" $(PSQL) -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $$LIB_NAME OWNER $$DB_USER;" || exit 1; \
	 PGPASSWORD="$$DB_PASS" $(PSQL) -h "$$DB_HOST" -p "$$DB_PORT" -U "$$DB_USER" -d "$$LIB_NAME" -v ON_ERROR_STOP=1 -c "CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()); INSERT INTO schema_migrations (filename) VALUES ('001_init_library.sql') ON CONFLICT DO NOTHING;" >/dev/null || exit 1
	@echo "→ replaying migrations from db/mmff_vector/schema and db/mmff_library/schema"
	@go run ./cmd/migrate -env "$(TEST_ENV)" -dir "$(CURDIR)/.." -db both
	@echo "✓ test-db-reset done"
