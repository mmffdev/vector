# Backend dev pipeline — one command per task. Both humans and the
# Vector Launcher invoke these targets so behaviour is identical
# whether you ran `make dev` in a terminal or clicked Start in the
# launcher. This file is the single source of truth for "how do I
# start/stop/restart the backend".

AIR := $(shell go env GOPATH)/bin/air
BIN := /tmp/vector-backend
SRV_PORT := 5100

.PHONY: dev run build clean install-air kill help

help:
	@echo "make dev          — live-reload via air (recommended)"
	@echo "make run          — one-shot compile + run (legacy launcher path)"
	@echo "make build        — compile only, no run"
	@echo "make kill         — kill anything on :$(SRV_PORT)"
	@echo "make install-air  — install the air binary into GOPATH/bin"

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
