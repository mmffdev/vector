package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/addressables"
	"github.com/mmffdev/vector-backend/internal/apikeys"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/bootstatus"
	"github.com/mmffdev/vector-backend/internal/custompages"
	"github.com/mmffdev/vector-backend/internal/db"
	"github.com/mmffdev/vector-backend/internal/defects"
	"github.com/mmffdev/vector-backend/internal/errorsreport"
	"github.com/mmffdev/vector-backend/internal/fields"
	"github.com/mmffdev/vector-backend/internal/flows"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/libraryreleases"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/nav"
	"github.com/mmffdev/vector-backend/internal/orgdesign"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/roles"
	"github.com/mmffdev/vector-backend/internal/searchworker"
	"github.com/mmffdev/vector-backend/internal/portfolio"
	"github.com/mmffdev/vector-backend/internal/portfolioitems"
	"github.com/mmffdev/vector-backend/internal/portfoliomodels"
	"github.com/mmffdev/vector-backend/internal/ranking"
	"github.com/mmffdev/vector-backend/internal/realtime"
	"github.com/mmffdev/vector-backend/internal/security"
	"github.com/mmffdev/vector-backend/internal/tenantsettings"
	"github.com/mmffdev/vector-backend/internal/userstories"
	"github.com/mmffdev/vector-backend/internal/usertaborder"
	"github.com/mmffdev/vector-backend/internal/users"
	"github.com/mmffdev/vector-backend/internal/timeboxsprints"
	"github.com/mmffdev/vector-backend/internal/workitemsv2"
	"github.com/mmffdev/vector-backend/internal/workspaces"
)

// Build-time identity. Set via -ldflags "-X main.Commit=… -X main.BuildTime=…"
// so /healthz can prove which binary is actually serving traffic. Defaults
// keep tests and ad-hoc `go run` builds working.
var (
	Commit    = "dev"
	BuildTime = "unknown"
)

var processStartedAt = time.Now().UTC()

func main() {
	envFile := ".env.local"
	if e := os.Getenv("BACKEND_ENV"); e != "" {
		envFile = ".env." + e
	}
	_ = godotenv.Load(envFile)

	// Prod safety: APP_ENV MUST be set explicitly. In production,
	// COOKIE_SECURE MUST be true and FRONTEND_ORIGIN MUST be https://.
	appEnv := os.Getenv("APP_ENV")
	switch appEnv {
	case "":
		log.Fatal("APP_ENV must be set explicitly (development|staging|production)")
	case "production":
		if os.Getenv("COOKIE_SECURE") != "true" {
			log.Fatal("APP_ENV=production requires COOKIE_SECURE=true")
		}
		if origin := os.Getenv("FRONTEND_ORIGIN"); !strings.HasPrefix(origin, "https://") {
			log.Fatal("APP_ENV=production requires FRONTEND_ORIGIN to start with https://")
		}
	case "staging", "development":
		log.Printf("⚠ APP_ENV=%s — cookie/origin guards relaxed; DO NOT run this in production", appEnv)
	default:
		log.Fatalf("APP_ENV=%q invalid; must be development, staging, or production", appEnv)
	}

	ctx := context.Background()
	pool, err := db.New(ctx)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()
	bootstatus.Set("db", true, "")

	// PLA-0007: parity check between the Go catalogue and the DB. Drift
	// (or a missing `permissions` table when migrations are behind on the
	// active env) is loud-but-not-fatal: the resolver already denies on
	// any DB error, so RBAC-gated routes fail-safe (403). We log loudly
	// so the operator sees it, but the server still boots — otherwise
	// switching env to one that lacks migration 088 makes the backend
	// unstartable, which is the worst possible failure mode for a launcher.
	if err := permissions.VerifyParity(ctx, pool); err != nil {
		log.Printf("⚠ permissions parity FAILED — RBAC-gated routes will deny by default until fixed: %v", err)
		bootstatus.Set("permissions_parity", false, err.Error())
	} else {
		bootstatus.Set("permissions_parity", true, "")
	}

	// PLA-0007: process-local resolver caching effective permission set
	// per user. 60s TTL keeps cross-process drift bounded; explicit
	// Invalidate hooks fire from roles/users mutations within this process.
	// Consumed by auth.RequirePermission middleware on every route below.
	permResolver := permissions.NewResolver(pool, 60*time.Second)

	// Library DB pools (mmff_library). Phase 3 only consumes RO; the
	// publish + ack pools are wired the moment a handler needs them.
	// Required env vars are documented in librarydb/db.go.
	//
	// Still fatal on failure: ~10 handler ctors take libPools.RO directly,
	// so a nil pool would propagate as nil-deref panics deep in handlers.
	// If this ever becomes a real availability problem we'll add a no-op
	// pool fallback in librarydb itself; for now, fail loud.
	libPools, err := librarydb.New(ctx)
	if err != nil {
		log.Fatalf("librarydb: %v", err)
	}
	bootstatus.Set("library_db", true, "")
	defer libPools.Close()

	auditLog := audit.New(pool)
	mailer := email.NewFromEnv()

	authSvc := auth.NewService(pool, auditLog, mailer)
	authH := auth.NewHandler(authSvc, permResolver, pool)

	apiKeysSvc := apikeys.New(pool)
	apiKeysH := apikeys.NewHandler(apiKeysSvc)

	// Seed dev API key for local testing (story 00443).
	// Only in development; logs the key once for curl testing.
	if err := apikeys.SeedDevKey(ctx, pool, appEnv, os.Getenv("DEV_API_KEY")); err != nil {
		log.Fatalf("seed dev api key: %v", err)
	}

	usersSvc := users.New(pool, auditLog, mailer)
	usersH := users.NewHandler(usersSvc, permResolver)

	// Roles HTTP surface (PLA-0007 G3). Service is sole writer for
	// roles + role_permissions; the handler is a thin translation layer.
	rolesSvc := roles.New(pool, auditLog)
	rolesH := roles.NewHandler(rolesSvc, permResolver, pool)

	// Page registry: cached DB-backed catalogue. 60s TTL trades a tiny
	// window of staleness after an admin change for near-zero read cost.
	// Prime at startup; on failure record degraded state and continue.
	// nav.CachedRegistry.Get refreshes on demand, so the first nav request
	// after the DB recovers will populate the cache without a restart.
	navRegistry := nav.NewCachedRegistry(pool, 60*time.Second)
	if _, err := navRegistry.Load(ctx); err != nil {
		log.Printf("⚠ nav registry initial load failed — nav routes will retry on first request: %v", err)
		bootstatus.Set("nav_registry", false, err.Error())
	} else {
		bootstatus.Set("nav_registry", true, "")
	}
	navSvc := nav.New(pool, navRegistry)
	navBookmarks := nav.NewBookmarks(pool, navRegistry)
	customPagesSvc := custompages.New(pool)
	customPagesH := custompages.NewHandler(customPagesSvc)

	// Universal addressables registry (PLA-0005). Service is the SOLE
	// writer for page_addressables / page_help. Handler fronts four
	// endpoints — see backend/internal/addressables/handler.go for the
	// auth contract (CI token gate on /build-reconcile, prod gate on
	// /register).
	addressablesSvc := addressables.New(pool, appEnv == "production")
	addressablesH := addressables.NewHandler(
		addressablesSvc,
		os.Getenv("CI_SERVICE_TOKEN"),
		os.Getenv("CUSTOM_APP_TOKEN"),
	)
	navH := nav.NewHandler(navSvc, navBookmarks, customPagesSvc)
	navEntitiesSvc := nav.NewEntitiesService(pool)
	navEntitiesH := nav.NewEntitiesHandler(navEntitiesSvc)

	// Per-user, per-page tab ordering for SecondaryNavigation reorder mode (PLA-0014).
	// Sole writer for user_tab_order; mounted at /api/user/tab-order below.
	userTabOrderSvc := usertaborder.New(pool)
	userTabOrderH := usertaborder.NewHandler(userTabOrderSvc)

	portfolioModelsH := portfoliomodels.NewHandler(libPools.RO)
	// vaPool is wired below; nil = legacy-only adoption path. The
	// orchestrator skips PLA-0026 dual-writes when nil.
	// Constructed AFTER the vaPool block so the handler picks up the
	// pool when VECTOR_ARTEFACTS_DB_URL is set.
	// PLA-0026 / Story 00501 (B12): adoption-state handler ALSO waits
	// for vaPool — it now reads master_record_portfolio + artefact_types
	// from vector_artefacts and degrades to notStarted when vaPool is nil.
	var portfolioAdoptionStateH *portfoliomodels.AdoptionStateHandler
	var portfolioAdoptH *portfoliomodels.AdoptHandler
	var portfolioAdoptStreamH *portfoliomodels.AdoptStreamHandler
	devResetH := portfoliomodels.NewDevResetHandler(pool)
	layersBatchH := portfoliomodels.NewLayersBatchHandler(pool)

	// Library release-notification channel (Phase 3 of mmff_library plan, §12).
	// Reconciler maintains a per-subscription badge-count cache; ticker
	// floor is 15m by default (LIBRARY_RECONCILER_INTERVAL to override).
	// On-login hook warms the cache so the first badge poll after sign-in
	// returns instantly. Cache is invalidated on every successful ack.
	libReleasesRec := libraryreleases.NewReconciler(libPools.RO, pool)
	libReleasesRec.Start(ctx)
	defer libReleasesRec.Stop()
	libReleasesH := libraryreleases.NewHandler(libPools.RO, pool, auditLog, libReleasesRec)

	userStoriesSvc := userstories.New(pool)
	userStoriesH := userstories.NewHandler(userStoriesSvc)

	defectsSvc := defects.New(pool)
	defectsH := defects.NewHandler(defectsSvc)

	portfolioItemsSvc := portfolioitems.New(pool)
	portfolioItemsH := portfolioitems.NewHandler(portfolioItemsSvc)

	// Realtime hub + Postgres LISTEN bridge. The hub is in-memory; the
	// bridge runs LISTEN rank_changed on a dedicated connection and
	// fans NOTIFY payloads (emitted by the notify_rank_changed trigger
	// in db/schema/069) to subscribed clients.
	//
	// Constructed early so other services can inject it as a notifier
	// (e.g. orgdesign GrantNotifier for story 00283 handoff inbox).
	rtHub := realtime.NewHub()
	realtime.StartRankListener(context.Background(), pool, rtHub)

	// Topology / federated org canvas (PLA-0006). orgdesign is the SOLE
	// writer for org_nodes, org_node_roles, and org_node_view_state —
	// see backend/internal/orgdesign/boundary_test.go for the CI gate.
	//
	// WithNotifier wires the realtime hub so a fresh role grant
	// publishes a per-user "topology-handoff" event (story 00283).
	orgDesignSvc := orgdesign.New(pool).WithNotifier(orgdesign.HubNotifier{Hub: rtHub})
	orgDesignH := orgdesign.NewHandler(orgDesignSvc).WithAudit(auditLog)

	// Workspaces (PLA-0006 / story 00377). workspaces is the SOLE
	// writer for the workspaces and workspace_roles tables — see
	// backend/internal/workspaces/service.go for the boundary contract
	// and dev/scripts/lint_writer_boundary.py for the CI gate. The
	// service holds its own permission resolver so /api/workspaces
	// routes only need RequireAuth + RequireFreshPassword at the
	// router; per-route gating happens inside Service.requirePermission.
	workspacesSvc := workspaces.New(pool, auditLog, permResolver)
	workspacesH := workspaces.NewHandler(workspacesSvc)

	// Tenant settings (master_record_tenant). One row per subscription;
	// auto-seeded by trigger on subscription INSERT (mig 126). Service
	// handles all validation; handler maps ValidationError → 422.
	tenantSettingsSvc := tenantsettings.New(pool)
	tenantSettingsH := tenantsettings.NewHandler(tenantSettingsSvc)

	// vector_artefacts pool — reads/writes the cutover DB. Shared by
	// v2 work-items (PLA-0023) AND portfolio adoption dual-writes
	// (PLA-0026). VECTOR_ARTEFACTS_DB_URL is optional; absent = v2
	// route returns empty pages AND adoption falls back to legacy-only
	// (no PLA-0026 dual-writes).
	var vaPool *pgxpool.Pool
	var workItemsV2H *workitemsv2.Handler
	if vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL"); vaURL != "" {
		vaCfg, vaErr := pgxpool.ParseConfig(vaURL)
		if vaErr != nil {
			log.Printf("⚠ vector_artefacts pool config error — v2 work-items will return empty: %v", vaErr)
			workItemsV2H = workitemsv2.NewHandler(workitemsv2.NewService(nil, nil))
		} else {
			vaCfg.MinConns = 2
			vaCfg.MaxConnIdleTime = 5 * time.Minute
			p, vaErr := pgxpool.NewWithConfig(ctx, vaCfg)
			if vaErr != nil {
				log.Printf("⚠ vector_artefacts pool connect failed — v2 work-items will return empty: %v", vaErr)
				workItemsV2H = workitemsv2.NewHandler(workitemsv2.NewService(nil, nil))
			} else if vaErr = p.Ping(ctx); vaErr != nil {
				log.Printf("⚠ vector_artefacts pool ping failed — v2 work-items will return empty: %v", vaErr)
				p.Close()
				workItemsV2H = workitemsv2.NewHandler(workitemsv2.NewService(nil, nil))
			} else {
				vaPool = p
				defer vaPool.Close()
				// Mask password in log: strip :password@ from the URL.
				maskedURL := vaURL
				if i := strings.Index(vaURL, "@"); i > 0 {
					if j := strings.LastIndex(vaURL[:i], ":"); j > 0 {
						maskedURL = vaURL[:j+1] + "***" + vaURL[i:]
					}
				}
				log.Printf("vector_artefacts pool connected: %s", maskedURL)
				workItemsV2H = workitemsv2.NewHandler(workitemsv2.NewService(vaPool, pool))
				// PLA-0026 / story 00502 (B13): attach the VA pool to the
				// workspaces service so DELETE /api/workspaces/{id} can
				// scan vector_artefacts for orphan rows BEFORE deletion.
				// Without this attach, workspacesSvc.CheckCrossDBOrphans
				// is a documented no-op (guard disabled).
				workspacesSvc.WithVAPool(vaPool)
				bootstatus.Set("vector_artefacts_db", true, "")
			}
		}
	} else {
		log.Printf("⚠ VECTOR_ARTEFACTS_DB_URL unset — v2 work-items will return empty pages")
		workItemsV2H = workitemsv2.NewHandler(workitemsv2.NewService(nil, nil))
	}

	// Portfolio adopt handler — wired AFTER vaPool so PLA-0026 dual-
	// writes target vector_artefacts when the pool is available.
	// PLA-0026 / Story 00495 (B6): master-record-portfolio service is
	// constructed only when vaPool is live; the saga's finalize step
	// is a no-op when masterRecordSvc is nil (orphan-sub fixtures and
	// VA-disabled environments).
	var masterRecordSvc *portfolio.Service
	if vaPool != nil {
		masterRecordSvc = portfolio.NewService(vaPool)
	}
	portfolioAdoptH = portfoliomodels.NewAdoptHandler(libPools.RO, pool, vaPool, masterRecordSvc)
	portfolioAdoptStreamH = portfoliomodels.NewAdoptStreamHandler(portfolioAdoptH.Orchestrator)

	// PLA-0026 / Story 00501 (B12): adoption-state reads from the new
	// substrate (master_record_portfolio + artefact_types) via vaPool.
	// vectorPool is still required to resolve subscription_id →
	// workspace_id; vaPool may be nil (handler returns notStarted).
	portfolioAdoptionStateH = portfoliomodels.NewAdoptionStateHandler(pool, vaPool)

	// PLA-0026 / Story 00498 (B9): read surface for the persistent
	// portfolio model record. BundleView reads model_name +
	// model_description from here so the frontend never touches
	// mmff_library at runtime.
	portfolioMasterRecordH := portfolio.NewHandler(masterRecordSvc, pool)

	// PLA-0026 / Story 00500 (B11): GET /api/workspace/{id}/fields —
	// returns the admitted field set for one workspace, computed by
	// the same admit/deny rules the per-field resolver uses (R047 §5).
	// vectorPool is required (membership + tenancy lookups); vaPool
	// may be nil — in that case the handler returns an empty fields
	// slice after the auth gate succeeds (mirrors v2 work-items).
	fieldsH := fields.NewHandler(pool, vaPool)

	// PLA-0026 / Story 00499 (B10): workspace-scoped successor to the
	// legacy GET /api/subscription/layers. Reads strategy artefact_types
	// from vector_artefacts; legacy handler stays live until F3 (per
	// R047 §9). vaPool may be nil — handler returns 503 in that case.
	workspaceLayersH := portfoliomodels.NewWorkspaceLayersHandler(pool, vaPool)

	// PLA-0027 / Story 00514: timebox sprints REST handler.
	// Uses the same vaPool as v2 work-items; gracefully degrades when nil.
	var sprintH *timeboxsprints.Handler
	if vaPool != nil {
		sprintH = timeboxsprints.NewHandler(timeboxsprints.NewService(vaPool))
	}

	flowsSvc := flows.New(pool)
	flowsH := flows.NewHandler(flowsSvc)

	// Generic rank service. Backed by vaPool (vector_artefacts) for
	// work items — the rank service writes position directly to artefacts.
	// Falls back gracefully to a no-op handler when vaPool is nil.
	var rankH *ranking.Handler
	if vaPool != nil {
		ranking.Register("work_item", ranking.ResourceConfig{
			Table:       "artefacts",
			ScopeColumn: "timebox_sprint_id",
			Permissions: ranking.PermissionCheckerFunc(func(ctx context.Context, subscriptionID, rowID uuid.UUID) (bool, error) {
				return true, nil
			}),
		})
		rankH = ranking.NewHandler(ranking.New(vaPool))
	}

	// Generic error reporter: any authenticated role can POST a
	// {code, context} pair; we validate the code against the cross-DB
	// mmff_library.error_codes catalogue and append-only insert into
	// mmff_vector.error_events.
	errorsReportH := errorsreport.NewHandler(libPools.RO, pool)

	authSvc.OnLogin = append(authSvc.OnLogin, func(ctx context.Context, u *models.User) {
		var tier string
		if err := pool.QueryRow(ctx,
			`SELECT tier FROM subscriptions WHERE id = $1`, u.SubscriptionID,
		).Scan(&tier); err != nil {
			return // tier lookup failed — reconciler will warm on first poll
		}
		libReleasesRec.Touch(ctx, u.SubscriptionID, tier)
	})

	// PLA-0010 / story 00368 — per-user write-rate limit, layered on
	// top of the existing per-IP limiters. Built ONCE and reused across
	// authenticated route groups so a single user's write quota is
	// shared across the whole authenticated surface (the entire point —
	// otherwise a caller can fan writes across endpoints to evade the
	// cap). Anonymous traffic on routes that mount this falls back to a
	// security.ClientIP-derived key, which honours the trusted-CIDR
	// gate from story 00348.
	userWriteLimiter := security.LimitByUserOnWrites(60, time.Minute, func(req *http.Request) (string, error) {
		if u := auth.UserFromCtx(req.Context()); u != nil {
			return "user:" + u.ID.String(), nil
		}
		return "ip:" + security.ClientIP(req), nil
	})

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	// PLA-0010 / story 00348 — chi's middleware.RealIP rewrites
	// r.RemoteAddr from X-Forwarded-For unconditionally, which makes
	// every downstream consumer trust a header any client can forge.
	// Removed; security.ClientIP is the sole, CIDR-gated point that
	// honours XFF. See backend/internal/security/clientip.go.
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   strings.Split(os.Getenv("FRONTEND_ORIGIN"), ","),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	r.Use(security.Headers)
	r.Use(security.BodyLimit)
	r.Use(security.CSRF)

	// envFromDBPort derives env name + letter from the live DB_PORT.
	// Single source of truth for /healthz and /api/env.
	envFromDBPort := func() (env, letter string) {
		switch os.Getenv("DB_PORT") {
		case "5435":
			return "dev", "D"
		case "5436":
			return "staging", "S"
		case "5434":
			return "production", "P"
		default:
			return "unknown", "?"
		}
	}

	// /api/status/pipeline — single source of truth for the EnvBadge and
	// any external monitor. Aggregates env, build identity, db target, and
	// every component the boot sequence reported on. Public by design: no
	// secrets are leaked (host:port for the active tunnel is already in
	// /api/env), and a degraded backend MUST be observable from the UI
	// even when auth is broken (which is exactly when you most need to
	// see what's wrong). Components reflect bootstatus.All() in real time.
	r.Get("/status/pipeline", func(w http.ResponseWriter, r *http.Request) {
		env, letter := envFromDBPort()
		comps := bootstatus.All()
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"env":        env,
			"letter":     letter,
			"db_host":    os.Getenv("DB_HOST") + ":" + os.Getenv("DB_PORT"),
			"commit":     Commit,
			"build_time": BuildTime,
			"started_at": processStartedAt.Format(time.RFC3339),
			"healthy":    bootstatus.Healthy(),
			"components": comps,
		})
	})

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		env, _ := envFromDBPort()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":     "ok",
			"commit":     Commit,
			"build_time": BuildTime,
			"started_at": processStartedAt.Format(time.RFC3339),
			"env":        env,
		})
	})

	// /env reports which DB the backend is actually connected to.
	// Letter is derived from the live DB_PORT env var (5434=prod tunnel,
	// 5435=dev, 5436=staging) — the truth source the frontend EnvBadge
	// polls so it can never drift from the running backend.
	r.Get("/env", func(w http.ResponseWriter, r *http.Request) {
		env, letter := envFromDBPort()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"env":         env,
			"letter":      letter,
			"db_host":     os.Getenv("DB_HOST") + ":" + os.Getenv("DB_PORT"),
			"backend_env": os.Getenv("BACKEND_ENV"),
		})
	})

	// POST /env/switch — flips backend to the requested env by
	// spawning .claude/bin/switch-server in a detached process group.
	// The script kills this very process and starts a new `go run`
	// with BACKEND_ENV set, so we MUST send the 202 response before
	// the script gets to step 2 (kill). The script's own ~1s setup
	// + tunnel check provides the buffer.
	//
	// Dev-only: refuses when APP_ENV=production. CSRF middleware
	// blocks unauthenticated callers (no csrf cookie → 403 before
	// reaching this handler).
	r.Post("/env/switch", func(w http.ResponseWriter, r *http.Request) {
		if os.Getenv("APP_ENV") == "production" {
			http.Error(w, "env switch disabled in production", http.StatusForbidden)
			return
		}
		var body struct {
			Target string `json:"target"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid body", http.StatusBadRequest)
			return
		}
		switch body.Target {
		case "dev", "staging", "production":
			// ok
		default:
			http.Error(w, "target must be dev|staging|production", http.StatusBadRequest)
			return
		}

		script := "/Users/rick/Documents/MMFFDev - Projects/MMFFDev - Vector/.claude/bin/switch-server"
		if _, err := os.Stat(script); err != nil {
			http.Error(w, "switch-server script missing", http.StatusInternalServerError)
			return
		}

		cmd := exec.Command("/bin/bash", script, body.Target)
		// Detach from this process group so the script survives our
		// imminent SIGTERM.
		cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
		if err := cmd.Start(); err != nil {
			http.Error(w, "spawn failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		// Reap the spawned bash so it doesn't become a zombie before
		// we die. The actual `go run` is a grandchild and is already
		// re-parented to init by Setsid.
		go func() { _ = cmd.Wait() }()

		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": "switching",
			"target": body.Target,
		})
	})

	// ---- /ws ----
	// One WebSocket per connected client; topic-based fan-out via the
	// realtime hub. JWT via Authorization: Bearer or ?access_token= on
	// the upgrade request (browsers cannot set headers on WS upgrade).
	// Stays unversioned — WebSocket framing is versioned via subprotocol,
	// not URL.
	r.Group(func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Get("/ws", realtime.ServeWS(rtHub))
	})

	// ---- /samantha/v1 — all external API routes ----
	// Internal/infra routes (/healthz, /status/pipeline, /env,
	// /env/switch, /ws) are mounted above and stay unversioned.
	r.Route("/samantha/v1", func(r chi.Router) {
		// API key validation middleware (story 00443).
		// Validates Bearer token API keys; falls through to JWT auth if not present.
		r.Use(apikeys.Middleware(apiKeysSvc))

	// ---- /api/auth ----
	r.Route("/auth", func(r chi.Router) {
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/login", authH.Login)
		r.Post("/refresh", authH.Refresh)
		r.Post("/logout", authH.Logout)
		r.With(httprate.LimitByIP(3, time.Hour)).Post("/password-reset", authH.PasswordReset)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/password-reset/confirm", authH.PasswordResetConfirm)

		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Post("/change-password", authH.ChangePassword)
		})

		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Get("/me", authH.Me)
		})
	})

	// ---- /api/me ----
	// Per-user preference surface — small key/value endpoints scoped
	// to the authenticated session. Theme pack persists which
	// /public/themes/<pack>.css the Palette flyout has applied.
	r.Route("/me", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/theme-pack", usersH.GetThemePack)
		r.Put("/theme-pack", usersH.SetThemePack)
	})

	// ---- /api/nav ----
	r.Route("/nav", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// 120 requests/min/IP across all nav routes — comfortably above
		// normal UI churn (load + a handful of PUTs per session), blocks
		// authed-session abuse.
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/catalogue", navH.Catalogue)
		r.Get("/prefs", navH.GetPrefs)
		r.Put("/prefs", navH.PutPrefs)
		r.Delete("/prefs", navH.DeletePrefs)
		r.Get("/start-page", navH.StartPage)
		r.Post("/bookmark", navH.PinBookmark)
		r.Delete("/bookmark", navH.UnpinBookmark)
		r.Get("/bookmark/check", navH.CheckBookmark)
		r.Get("/entities", navEntitiesH.List)

		// Profiles (Phase 5). /order and /active are static segments —
		// register them before /{id} so chi prefers the static path,
		// even though chi's trie does the right thing either way.
		r.Get("/profiles", navH.ListProfiles)
		r.Post("/profiles", navH.CreateProfile)
		r.Put("/profiles/order", navH.ReorderProfiles)
		r.Put("/profiles/active", navH.SetActiveProfile)
		r.Patch("/profiles/{id}", navH.RenameProfile)
		r.Delete("/profiles/{id}", navH.DeleteProfile)
		r.Get("/profiles/{id}/groups", navH.ListProfileGroups)
		r.Put("/profiles/{id}/groups", navH.SetProfileGroups)
	})

	// ---- /api/user/tab-order ----
	// Per-user, per-page tab ordering for SecondaryNavigation reorder mode (PLA-0014).
	// pageId is a stable string catalog key (e.g. "workspace-settings", "theme",
	// "work-items"); not an FK. See db/schema/115_user_tab_order.sql header.
	r.Route("/user/tab-order", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/{pageId}", userTabOrderH.Get)
		r.Put("/{pageId}", userTabOrderH.Put)
		r.Delete("/{pageId}", userTabOrderH.Delete)
	})

	// ---- /api/custom-pages ----
	r.Route("/custom-pages", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/", customPagesH.List)
		r.Post("/", customPagesH.Create)
		r.Get("/{id}", customPagesH.Get)
		r.Patch("/{id}", customPagesH.Patch)
		r.Delete("/{id}", customPagesH.Delete)
	})

	// ---- /api/addressables and /api/page-help/{addressable_id} (PLA-0005) ----
	// build-reconcile: CI service-account token (X-CI-Token).
	// register:        dev unrestricted; prod requires X-Custom-App-Token.
	// snapshot, page-help GET: unauthenticated by design (substrate metadata).
	// page-help admin (list / PUT / DELETE): gadmin-only, story 00253.
	r.Post("/addressables/build-reconcile", addressablesH.BuildReconcile)
	r.Post("/addressables/register", addressablesH.Register)
	r.Get("/addressables/snapshot", addressablesH.Snapshot)
	r.Get("/page-help/{addressable_id}", addressablesH.PageHelp)
	r.Route("/page-help/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// PLA-0007: gadmin-equivalent gate via menu.admin.view (closest existing
		// code). Tech-debt: own code addressables.page_help.admin — see PLA-0007 G3.
		r.Use(auth.RequirePermission(permResolver, permissions.MenuAdminView))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		r.Get("/", addressablesH.PageHelpAdminList)
		r.Put("/{addressable_id}", addressablesH.PageHelpAdminPut)
		r.Delete("/{addressable_id}", addressablesH.PageHelpAdminDelete)
	})
	r.Route("/addressables/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// PLA-0007: gadmin-equivalent gate via menu.admin.view. Tech-debt:
		// own code addressables.admin — see PLA-0007 G3.
		r.Use(auth.RequirePermission(permResolver, permissions.MenuAdminView))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		r.Patch("/{id}/helpable", addressablesH.AdminUpdateHelpable)
	})

	// ---- /api/portfolio-models ----
	// Read-only library bundle surface (Phase 3 of mmff_library plan).
	// Bundle GETs by family/id are open to any authenticated user —
	// MMFF-authored content is implicitly visible across tenants;
	// per-tenant share enforcement lands in Phase 5. List + adoption-state
	// are padmin-only because adoption is a padmin-owned product decision.
	r.Route("/portfolio-models", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		// Padmin-only: list of MMFF-published bundles for the adoption
		// picker. Registered BEFORE /{id} so chi resolves the static
		// path first (defensive — chi's trie prefers static segments
		// anyway).
		r.With(auth.RequirePermission(permResolver, permissions.PortfolioList)).
			Get("/", portfolioModelsH.List)

		// Padmin-only: live adoption state for the caller's subscription.
		// Registered BEFORE /{id} so chi resolves the static path first
		// (defensive — chi's trie prefers static segments anyway).
		r.With(auth.RequirePermission(permResolver, permissions.PortfolioList)).
			Get("/adoption-state", portfolioAdoptionStateH.GetAdoptionState)

		r.Get("/{family}/latest", portfolioModelsH.GetLatestByFamily)
		r.Get("/{id}", portfolioModelsH.GetByModelID)

		// Padmin-only: run the adoption saga for a library model id.
		// Per-step atomic, idempotent on retry — see
		// backend/internal/portfoliomodels/adopt.go for the orchestrator.
		// Registered AFTER /{id} in source order is fine — chi's trie
		// distinguishes by HTTP method anyway.
		// PLA-0007: gated via portfolio.list (closest existing code).
		// Tech-debt: own code portfolio.adopt — see PLA-0007 G3.
		r.With(auth.RequirePermission(permResolver, permissions.PortfolioList)).
			Post("/{id}/adopt", portfolioAdoptH.Adopt)

		// Padmin-only: SSE variant — emits one `event: step` per saga
		// step plus a final `event: done` or `event: fail`. See
		// backend/internal/portfoliomodels/adopt_stream.go.
		r.With(auth.RequirePermission(permResolver, permissions.PortfolioList)).
			Get("/{id}/adopt/stream", portfolioAdoptStreamH.Stream)
	})

	// ---- /api/portfolio (master_record_portfolio) ----
	// PLA-0026 / Story 00498 (B9): per-workspace read surface for the
	// persistent portfolio model record. Reads ONLY vector_artefacts —
	// no live mmff_library look-ups happen here. Auth is enforced at
	// the group; per-workspace membership is checked inside the handler.
	r.Route("/portfolio", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		portfolioMasterRecordH.Mount(r)
	})

	// ---- /api/workspace/{id}/portfolio (PLA-0026 / Story 00499 / B10) ----
	// Workspace-scoped successor to GET /api/subscription/layers. Reads
	// strategy artefact_types from vector_artefacts. The legacy endpoint
	// stays live until F3 frontend cutover (R047 §9). Auth + tenant +
	// workspace-membership enforcement happens INSIDE the handler so we
	// can return 404 for cross-tenant probes (leak-resistant) while
	// returning 403 for in-tenant non-members.
	r.Route("/workspace/{id}/portfolio", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/layers", workspaceLayersH.GetWorkspaceLayers)
	})

	// ---- /api/library/releases ----
	// Release-notification channel (Phase 3, plan §12). Gadmin-only:
	// only the subscription's group admin acknowledges releases on
	// behalf of the tenant. Count endpoint is the cheap badge poll;
	// list endpoint hands back full release rows + actions.
	r.Route("/library/releases", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// PLA-0007: gadmin-equivalent gate via menu.admin.view (closest existing
		// code). Tech-debt: own code library.releases.ack — see PLA-0007 G3.
		r.Use(auth.RequirePermission(permResolver, permissions.MenuAdminView))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/", libReleasesH.List)
		r.Get("/count", libReleasesH.Count)
		r.Post("/{id}/ack", libReleasesH.Ack)
	})

	// ---- /api/subscription ----
	// Subscription-scoped write surface. Padmin-only.
	r.Route("/subscription", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// PLA-0007: padmin-equivalent gate via portfolio.list (closest existing
		// code). Tech-debt: own code subscription.layers.update — see PLA-0007 G3.
		r.Use(auth.RequirePermission(permResolver, permissions.PortfolioList))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		// Subscription layer reads + writes (stories 00062–00065).
		r.Get("/layers", layersBatchH.GetLayers)
		r.Patch("/layers/batch", layersBatchH.PatchLayersBatch)
	})

	// ---- /api/errors ----
	// Generic error reporter — any authenticated user (padmin, gadmin,
	// or user) may report an occurrence. Rate-limited to dampen runaway
	// loops on the client side; cap matches /api/nav.
	r.Route("/errors", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Post("/report", errorsReportH.Report)
	})

	// ---- /api/user-stories ----
	r.Route("/user-stories", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// PLA-0006 / 00273: every list query under here must clamp to
		// the user's visible org_nodes subtree. Middleware seeds the
		// computed clamp into context; consuming queries call
		// orgdesign.ApplyClamp to splice it in. Mounted on the route
		// group rather than per-handler so a new endpoint added later
		// inherits the gate by default.
		r.Use(orgDesignSvc.ClampMiddleware)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Post("/", userStoriesH.Create)
		r.Get("/{id}", userStoriesH.Get)
		r.Patch("/{id}", userStoriesH.Patch)
		r.Delete("/{id}", userStoriesH.Archive)
	})

	// ---- /api/defects ----
	r.Route("/defects", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Post("/", defectsH.Create)
		r.Get("/{id}", defectsH.Get)
		r.Patch("/{id}", defectsH.Patch)
		r.Delete("/{id}", defectsH.Archive)
	})

	// ---- /api/rank ----
	// One generic endpoint serves every registered resource. The
	// resource_type field in the body picks the registry entry; the
	// service enforces tenant isolation by scoping every query by
	// subscription_id from the session (never the body).
	// Requires vaPool; returns 503 when vector_artefacts is unavailable.
	if rankH != nil {
		r.Route("/rank", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(240, time.Minute))
			r.Use(userWriteLimiter)

			r.Post("/move", rankH.Move)
		})
	} else {
		r.Post("/rank/move", func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "rank service not available", http.StatusServiceUnavailable)
		})
	}

	// ---- /api/flows (migration 112) ----
	// Per-tenant flow editor surface. gadmin and padmin both have
	// flows.manage; the page is one shared screen for both roles.
	// Read-only for now — write paths arrive in the next iteration.
	r.Route("/flows", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequirePermission(permResolver, permissions.FlowsManage))
		r.Use(httprate.LimitByIP(60, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/", flowsH.List)
	})

	// ---- /api/topology (PLA-0006) ----
	// Federated organisational canvas. All authenticated roles can read
	// the tree (clamp predicate trims what each user sees at consuming
	// endpoints — this surface returns the structural shape). Mutations
	// require padmin OR an admin grant on the affected node; node-grant
	// authorisation is checked inside orgdesign.Service via the
	// subscription scope. The single-admin / federated handoff governance
	// gate (story 00288) layers on top of GrantRole.
	r.Route("/topology", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		// Workspace clamp (PLA-0006 / story 00378): every list-style
		// read narrows to one workspace, resolved per-request from
		// `?ws=<slug>` (absent → actor's first live workspace; missing
		// slug → 404; in-tenant but no role → 403). The middleware
		// stashes workspace_id on the request context; service-layer
		// reads (Subtree / ListDisconnected / ArchivedDescendants /
		// TenantRootID) splice it into their WHERE clauses through
		// orgdesign.WorkspaceIDFromCtx. Mounted on a read-only sub-
		// router so write paths (which already constrain by
		// subscription_id + per-node role inside orgdesign.Service)
		// are not affected.
		wsLookup := orgdesign.PoolWorkspaceLookup{Pool: pool}
		r.Group(func(r chi.Router) {
			r.Use(orgdesign.WorkspaceClampMiddleware(wsLookup))

			r.Get("/tree", orgDesignH.Tree)
			r.Get("/nodes/{id}/ancestors", orgDesignH.Ancestors)
			r.Get("/nodes/{id}/archived-descendants", orgDesignH.ArchivedDescendants)
			r.Get("/preview-move", orgDesignH.PreviewMove)
			r.Get("/disconnected", orgDesignH.Disconnected)
			r.Get("/levels", orgDesignH.ListLevels)
			r.Get("/commit", orgDesignH.CommitStatus)
		})

		// Writes
		r.Post("/nodes", orgDesignH.Create)
		r.Patch("/nodes/{id}", orgDesignH.Patch)
		r.Delete("/nodes/{id}", orgDesignH.Archive)
		r.Post("/nodes/{id}/disconnect", orgDesignH.Disconnect)
		r.Post("/nodes/{id}/duplicate", orgDesignH.Duplicate)
		r.Post("/nodes/{id}/restore", orgDesignH.Restore)
		r.Post("/nodes/bulk-position", orgDesignH.BulkPosition)
		r.Put("/nodes/{id}/view-state", orgDesignH.ViewState)
		r.Post("/nodes/{id}/roles", orgDesignH.GrantRole)
		r.Delete("/roles/{grant_id}", orgDesignH.RevokeRole)
		r.Post("/levels", orgDesignH.CreateLevel)
		r.Patch("/levels/{id}", orgDesignH.RenameLevel)
		r.Post("/commit", orgDesignH.Commit)
		r.Post("/reset", orgDesignH.Reset)
	})

	// ---- /api/workspaces (PLA-0006 / story 00377) ----
	// Workspaces are the top-level tenant container above org_nodes.
	// Reads return the live workspaces in the caller's tenant; mutations
	// gate inside workspaces.Service via the workspace.* permission
	// codes (catalogue lives in internal/permissions/catalogue.go;
	// migration 100 seeds the role grid). Non-gadmin callers get 403
	// on archive/restore because only the gadmin grid carries those
	// codes in MVP.
	r.Route("/workspaces", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		workspacesH.Mount(r)
	})

	// ---- /api/workspace/{id}/fields (PLA-0026 / Story 00500, B11) ----
	// Returns the admitted field set for one workspace. Auth + fresh-
	// password gates at the router edge; per-row tenancy + membership
	// gating happens inside the handler (404 / 403 / 200).
	r.Route("/workspace/{id}/fields", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Get("/", fieldsH.List)
	})

	// ---- /api/tenant-settings (master_record_tenant) ----
	// One row per subscription; reads + writes scoped to the caller's
	// tenant via auth context. Auth + fresh-password gate is the only
	// guard — there's no per-row permission catalogue.
	r.Route("/tenant-settings", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		tenantSettingsH.Mount(r)
	})

	// ---- /api/portfolio-items ----
	r.Route("/portfolio-items", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// PLA-0006 / 00273: clamp predicate middleware. See the
		// /api/user-stories block above for the rationale.
		r.Use(orgDesignSvc.ClampMiddleware)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Post("/", portfolioItemsH.Create)
		r.Get("/{id}", portfolioItemsH.Get)
		r.Patch("/{id}", portfolioItemsH.Patch)
		r.Delete("/{id}", portfolioItemsH.Archive)
	})

	// ---- /api/admin ----
	r.Route("/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)

		// Require fresh password for most admin routes
		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireFreshPassword)

			// Users — per-route permission codes (PLA-0007).
			// POST creates the actor's chosen target role; the handler is
			// responsible for self-elevation guard against the actor's grid,
			// so the gate at the route level is the union of creator-matrix
			// codes (any one is enough to enter the route — handler discriminates).
			r.With(auth.RequireAnyPermission(permResolver,
				permissions.UsersCreateGadmin,
				permissions.UsersCreatePadmin,
				permissions.UsersCreateTeamLead,
				permissions.UsersCreateUser,
				permissions.UsersCreateExternal,
			)).Post("/users", usersH.Create)
			r.With(auth.RequirePermission(permResolver, permissions.UsersUpdateProfile)).
				Patch("/users/{id}", usersH.Patch)
			r.With(auth.RequirePermission(permResolver, permissions.UsersArchive)).
				Delete("/users/{id}", usersH.Delete)
			r.With(auth.RequirePermission(permResolver, permissions.UsersIssueReset)).
				Post("/users/{id}/password-reset", usersH.IssueReset)

			// List users — direct mapping to users.list.
			r.With(auth.RequirePermission(permResolver, permissions.UsersList)).
				Get("/users", usersH.List)

			// Dev tools — gadmin or padmin (reset is scoped to caller's subscription).
			// PLA-0007: gated via portfolio.list (closest existing code).
			// Tech-debt: own code dev.adoption_reset — see PLA-0007 G3.
			r.Group(func(r chi.Router) {
				r.Use(auth.RequirePermission(permResolver, permissions.PortfolioList))
				r.Post("/dev/adoption-reset", devResetH.ResetAdoptionState)
			})
		})

		// API keys (story 00443 — PLA-0019) — no RequireFreshPassword (programmatic access).
		// Tech-debt: PLA-0007 gate via api_keys.manage permission.
		r.Group(func(r chi.Router) {
			r.Use(auth.RequirePermission(permResolver, permissions.UsersList)) // Temp gate; should be api_keys.manage
			r.Post("/api-keys/issue", apiKeysH.Issue)
			r.Get("/api-keys", apiKeysH.List)
			r.Post("/api-keys/revoke", apiKeysH.Revoke)
		})

	})

	// ---- /api/roles (PLA-0007 G3) ----
	r.Route("/roles", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)

		r.With(auth.RequirePermission(permResolver, permissions.RolesList)).
			Get("/", rolesH.List)
		r.With(auth.RequirePermission(permResolver, permissions.RolesList)).
			Get("/creatable", rolesH.Creatable)
		// /admin/roles UI consumes this to render the assignment grid.
		r.With(auth.RequirePermission(permResolver, permissions.RolesList)).
			Get("/permissions/catalogue", rolesH.ListPermissionsCatalogue)
		r.With(auth.RequirePermission(permResolver, permissions.RolesRead)).
			Get("/{id}", rolesH.Get)
		r.With(auth.RequirePermission(permResolver, permissions.RolesCreate)).
			Post("/", rolesH.Create)
		r.With(auth.RequirePermission(permResolver, permissions.RolesUpdate)).
			Patch("/{id}", rolesH.Update)
		r.With(auth.RequirePermission(permResolver, permissions.RolesArchive)).
			Delete("/{id}", rolesH.Archive)
		r.With(auth.RequirePermission(permResolver, permissions.RolesRead)).
			Get("/{id}/permissions", rolesH.ListPermissions)
		r.With(auth.RequirePermission(permResolver, permissions.RolesAssignPermissions)).
			Post("/{id}/permissions", rolesH.AssignPermissions)
		r.With(auth.RequirePermission(permResolver, permissions.RolesRevokePermissions)).
			Delete("/{id}/permissions", rolesH.RevokePermissions)
	})

	}) // end /samantha/v1

	// ---- /samantha/v2 — feature-gated v2 routes ----
	r.Route("/samantha/v2", func(r chi.Router) {
		r.Use(apikeys.Middleware(apiKeysSvc))

		// ---- /work-items (PLA-0023 / 00469 + 00471) ----
		if os.Getenv("WORK_ITEMS_V2") == "true" {
			r.Route("/work-items", func(r chi.Router) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.Use(httprate.LimitByIP(120, time.Minute))
				r.Get("/", workItemsV2H.List)
				r.Post("/", workItemsV2H.Create)
				r.Post("/bulk", workItemsV2H.Bulk)
				r.Get("/summary", workItemsV2H.Summary)
				r.Get("/flow-states", workItemsV2H.ListFlowStates)
				r.Get("/{id}", workItemsV2H.Get)
				r.Patch("/{id}", workItemsV2H.Patch)
				r.Delete("/{id}", workItemsV2H.Archive)
				r.Get("/{id}/children", workItemsV2H.ListChildren)
				r.Get("/{id}/field-values", workItemsV2H.ListFieldValues)
				r.Put("/{id}/field-values", workItemsV2H.UpsertFieldValues)
				r.Delete("/{id}/field-values/{field_library_id}", workItemsV2H.DeleteFieldValue)
			})
		} else {
			r.Get("/work-items", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "v2 work-items not enabled", http.StatusServiceUnavailable)
			})
		}

		// ---- /rank (mirrors v1; required for v2 WorkItemsTree DnD) ----
		if rankH != nil {
			r.Route("/rank", func(r chi.Router) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.Use(httprate.LimitByIP(240, time.Minute))
				r.Use(userWriteLimiter)

				r.Post("/move", rankH.Move)
			})
		} else {
			r.Post("/rank/move", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "rank service not available", http.StatusServiceUnavailable)
			})
		}

		// ---- /timeboxes/sprints (PLA-0027 / 00514) ----
		if sprintH != nil {
			r.Route("/timeboxes/sprints", func(r chi.Router) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.Use(httprate.LimitByIP(120, time.Minute))

				r.Get("/", sprintH.List)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Post("/", sprintH.Create)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Post("/bulk-create", sprintH.BulkCreate)
				r.Get("/{id}", sprintH.Get)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Put("/{id}", sprintH.Update)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Delete("/{id}", sprintH.Delete)
			})
		} else {
			r.Get("/timeboxes/sprints", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "timebox sprints not enabled", http.StatusServiceUnavailable)
			})
		}
	})

	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "5100"
	}

	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	shutdownCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Start search index outbox worker.
	swCfg := searchworker.Config{
		OllamaURL:   os.Getenv("OLLAMA_URL"),
		OllamaModel: os.Getenv("OLLAMA_MODEL"),
	}
	if swCfg.OllamaURL == "" {
		swCfg.OllamaURL = "http://localhost:11434"
	}
	go searchworker.New(pool, swCfg).Run(shutdownCtx)

	serverErr := make(chan error, 1)
	go func() {
		log.Printf("listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		log.Fatalf("server error: %v", err)
	case <-shutdownCtx.Done():
		log.Println("shutdown signal received, draining...")
		drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(drainCtx); err != nil {
			log.Printf("graceful shutdown failed: %v", err)
		}
	}
}
