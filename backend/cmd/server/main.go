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
	"github.com/mmffdev/vector-backend/internal/search"
	"github.com/mmffdev/vector-backend/internal/searchworker"
	"github.com/mmffdev/vector-backend/internal/portfolio"
	"github.com/mmffdev/vector-backend/internal/portfoliomodels"
	"github.com/mmffdev/vector-backend/internal/ranking"
	"github.com/mmffdev/vector-backend/internal/realtime"
	"github.com/mmffdev/vector-backend/internal/security"
	"github.com/mmffdev/vector-backend/internal/tenantsettings"
	"github.com/mmffdev/vector-backend/internal/usertaborder"
	"github.com/mmffdev/vector-backend/internal/users"
	"github.com/mmffdev/vector-backend/internal/timeboxreleases"
	"github.com/mmffdev/vector-backend/internal/timeboxsprints"
	"github.com/mmffdev/vector-backend/internal/webhooks"
	"github.com/mmffdev/vector-backend/internal/artefactitemsv2"
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
	authSvc.Resolver = permResolver
	authH := auth.NewHandler(authSvc)

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
	rolesSvc.Resolver = permResolver
	rolesH := roles.NewHandler(rolesSvc, permResolver)

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
	libReleasesH := libraryreleases.NewHandler(libraryreleases.NewService(libPools.RO, pool), auditLog, libReleasesRec)

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
	// writer for topology_nodes, topology_role_grants, and
	// topology_view_state — see backend/internal/orgdesign/boundary_test.go
	// for the CI gate.
	//
	// M6.2.7 cutover: those three tables now live in vector_artefacts,
	// so orgdesign needs vaPool. Construction is deferred until after
	// the vaPool block runs (further down this file). orgDesignSvc /
	// orgDesignH are declared here so handler wiring can reference them.
	var orgDesignSvc *orgdesign.Service
	var orgDesignH *orgdesign.Handler

	// Workspaces (PLA-0006 / story 00377). workspaces is the SOLE
	// writer for the workspaces and workspace_roles tables — see
	// backend/internal/workspaces/service.go for the boundary contract
	// and dev/scripts/lint_writer_boundary.py for the CI gate. The
	// service holds its own permission resolver so /api/workspaces
	// routes only need RequireAuth + RequireFreshPassword at the
	// router; per-route gating happens inside Service.requirePermission.
	workspacesSvc := workspaces.New(pool, auditLog, permResolver)
	workspacesH := workspaces.NewHandler(workspacesSvc)

	// vector_artefacts pool — reads/writes the cutover DB. Shared by
	// v2 work-items (PLA-0023) AND portfolio adoption dual-writes
	// (PLA-0026). VECTOR_ARTEFACTS_DB_URL is optional; absent = v2
	// route returns empty pages AND adoption falls back to legacy-only
	// (no PLA-0026 dual-writes).
	var vaPool *pgxpool.Pool
	// B21 (PLA-0037): two handler instances on the same artefactitemsv2
	// codebase — workItemsV2H mounted at /samantha/v2/work-items with
	// scope="work" (legacy compat), portfolioItemsV2H mounted at
	// /samantha/v2/portfolio-items with scope="strategy" (new in B21).
	// Both share vaPool/pool; the only difference is the scope literal
	// each Service binds for `at.scope = $N` filtering.
	var workItemsV2H *artefactitemsv2.Handler
	var portfolioItemsV2H *artefactitemsv2.Handler
	var webhookSvc *webhooks.Service
	makeStubHandlers := func() {
		workItemsV2H = artefactitemsv2.NewHandler(artefactitemsv2.NewService(nil, nil, "work"))
		portfolioItemsV2H = artefactitemsv2.NewHandler(artefactitemsv2.NewService(nil, nil, "strategy"))
	}
	if vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL"); vaURL != "" {
		vaCfg, vaErr := pgxpool.ParseConfig(vaURL)
		if vaErr != nil {
			log.Printf("⚠ vector_artefacts pool config error — v2 artefact-items will return empty: %v", vaErr)
			makeStubHandlers()
		} else {
			vaCfg.MinConns = 2
			vaCfg.MaxConnIdleTime = 5 * time.Minute
			p, vaErr := pgxpool.NewWithConfig(ctx, vaCfg)
			if vaErr != nil {
				log.Printf("⚠ vector_artefacts pool connect failed — v2 artefact-items will return empty: %v", vaErr)
				makeStubHandlers()
			} else if vaErr = p.Ping(ctx); vaErr != nil {
				log.Printf("⚠ vector_artefacts pool ping failed — v2 artefact-items will return empty: %v", vaErr)
				p.Close()
				makeStubHandlers()
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
				webhookSvc = webhooks.New(vaPool)
				notifier := webhooks.NewNotifier(webhookSvc)
				wiSvc := artefactitemsv2.NewService(vaPool, pool, "work")
				wiSvc.WithNotifier(notifier)
				workItemsV2H = artefactitemsv2.NewHandler(wiSvc)
				piSvc := artefactitemsv2.NewService(vaPool, pool, "strategy")
				piSvc.WithNotifier(notifier)
				portfolioItemsV2H = artefactitemsv2.NewHandler(piSvc)
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
		log.Printf("⚠ VECTOR_ARTEFACTS_DB_URL unset — v2 artefact-items will return empty pages")
		makeStubHandlers()
	}

	// Topology service (PLA-0006 / M6.2.7). Constructed here, after
	// the vaPool block, because every topology read/write goes through
	// vector_artefacts. The legacy `pool` (mmff_vector) is retained on
	// the service for membership/auth lookups (PoolWorkspaceLookup) and
	// for the subscriptions.topology_committed_* checkpoint columns
	// which still live in mmff_vector.
	//
	// vaPool may be nil (no VECTOR_ARTEFACTS_DB_URL): the handler is
	// still wired so the routes return 5xx-with-context rather than
	// 404, but every topology read/write will fail at the first SQL
	// call until vaPool is provisioned. WithNotifier wires the
	// realtime hub so a fresh role grant publishes a per-user
	// "topology-handoff" event (story 00283).
	orgDesignSvc = orgdesign.New(pool, vaPool).WithNotifier(orgdesign.HubNotifier{Hub: rtHub})
	orgDesignH = orgdesign.NewHandler(orgDesignSvc).WithAudit(auditLog)

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

	// Tenant settings (master_record_tenant). M2: reads/writes vector_artefacts
	// (mig 036). Falls back to mmff_vector pool until 036 is applied on dev.
	tenantSettingsPool := pool
	if vaPool != nil {
		tenantSettingsPool = vaPool
	}
	tenantSettingsSvc := tenantsettings.New(tenantSettingsPool)
	tenantSettingsH := tenantsettings.NewHandler(tenantSettingsSvc)

	// Webhooks (B9). Requires vector_artefacts (mig 037).
	// webhookSvc is created in the vaPool block above when vaPool != nil.
	var webhooksH *webhooks.Handler
	if vaPool != nil {
		webhooksH = webhooks.NewHandler(webhookSvc)
	}

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
	fieldsSvc := fields.NewService(pool, vaPool)
	fieldsH := fields.NewHandler(fieldsSvc)

	// PLA-0026 / Story 00499 (B10): workspace-scoped successor to the
	// legacy GET /api/subscription/layers. Reads strategy artefact_types
	// from vector_artefacts; legacy handler stays live until F3 (per
	// R047 §9). vaPool may be nil — handler returns 503 in that case.
	workspaceLayersH := portfoliomodels.NewWorkspaceLayersHandler(pool, vaPool)

	// PLA-0027 / Story 00514: timebox sprints REST handler.
	// Uses the same vaPool as v2 work-items; gracefully degrades when nil.
	var sprintH *timeboxsprints.Handler
	if vaPool != nil {
		sprintSvc := timeboxsprints.NewService(vaPool)
		sprintSvc.WithNotifier(webhooks.NewNotifier(webhookSvc))
		sprintH = timeboxsprints.NewHandler(sprintSvc)
	}

	// timebox releases REST handler — mirrors sprints, no adjacency rule.
	var releaseH *timeboxreleases.Handler
	if vaPool != nil {
		releaseH = timeboxreleases.NewHandler(timeboxreleases.NewService(vaPool))
	}

	var flowsH *flows.Handler
	if vaPool != nil {
		flowsH = flows.NewHandler(flows.New(vaPool, pool))
	}

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

	// B7.2: search query handler — fulltext via tsvector (plainto_tsquery).
	// Only available when vaPool is up (vector_artefacts has the search columns).
	var searchH *search.Handler
	if vaPool != nil {
		searchH = search.NewHandler(search.New(vaPool))
	}

	// Generic error reporter: any authenticated role can POST a
	// {code, context} pair; we validate the code against the cross-DB
	// mmff_library.error_codes catalogue and append-only insert into
	// mmff_vector.error_events.
	errorsReportH := errorsreport.NewHandler(errorsreport.NewService(libPools.RO, pool))

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

	// ---- Site (BFF) routes — PLA-0039 / B22 ----
	// Closure mounts every site-only route (auth/me/nav/user/tab-order/
	// custom-pages/addressables/page-help/library/releases/errors/workspaces/
	// admin/roles). Mounted twice:
	//   • r.Route("/_site", mountSiteRoutes)   — canonical BFF prefix
	//   • mountSiteRoutes(r) at root           — back-compat shim with
	//     Deprecation: site=/_site header (≤2 release cycles, then removed)
	// Customer/public traffic stays under /samantha/v2 below; never inside
	// this closure. The apikeys middleware is NOT applied — site routes
	// authenticate via JWT only (API keys are a data-plane concept on
	// /samantha/v2).
	mountSiteRoutes := func(r chi.Router) {

	// /auth
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

	// /me
	r.Route("/me", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/theme-pack", usersH.GetThemePack)
		r.Put("/theme-pack", usersH.SetThemePack)
	})

	// /nav
	r.Route("/nav", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
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

		r.Get("/profiles", navH.ListProfiles)
		r.Post("/profiles", navH.CreateProfile)
		r.Put("/profiles/order", navH.ReorderProfiles)
		r.Put("/profiles/active", navH.SetActiveProfile)
		r.Patch("/profiles/{id}", navH.RenameProfile)
		r.Delete("/profiles/{id}", navH.DeleteProfile)
		r.Get("/profiles/{id}/groups", navH.ListProfileGroups)
		r.Put("/profiles/{id}/groups", navH.SetProfileGroups)
	})

	// /user/tab-order
	r.Route("/user/tab-order", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/{pageId}", userTabOrderH.Get)
		r.Put("/{pageId}", userTabOrderH.Put)
		r.Delete("/{pageId}", userTabOrderH.Delete)
	})

	// /custom-pages
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

	// /addressables + /page-help (PLA-0005)
	r.Post("/addressables/build-reconcile", addressablesH.BuildReconcile)
	r.Post("/addressables/register", addressablesH.Register)
	r.Get("/addressables/snapshot", addressablesH.Snapshot)
	r.Get("/page-help/{addressable_id}", addressablesH.PageHelp)
	r.Route("/page-help/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
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
		r.Use(auth.RequirePermission(permResolver, permissions.MenuAdminView))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		r.Patch("/{id}/helpable", addressablesH.AdminUpdateHelpable)
	})

	// /library/releases
	r.Route("/library/releases", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequirePermission(permResolver, permissions.MenuAdminView))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/", libReleasesH.List)
		r.Get("/count", libReleasesH.Count)
		r.Post("/{id}/ack", libReleasesH.Ack)
	})

	// /errors
	r.Route("/errors", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Post("/report", errorsReportH.Report)
	})

	// /workspaces (PLA-0006)
	r.Route("/workspaces", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		workspacesH.Mount(r)

		// /workspaces/{workspaceId}/webhooks (B9)
		if webhooksH != nil {
			r.Route("/{workspaceId}/webhooks", func(r chi.Router) {
				webhooksH.Mount(r)
			})
		}
	})

	// /admin
	r.Route("/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)

		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireFreshPassword)

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

			r.With(auth.RequirePermission(permResolver, permissions.UsersList)).
				Get("/users", usersH.List)

			r.Group(func(r chi.Router) {
				r.Use(auth.RequirePermission(permResolver, permissions.PortfolioList))
				r.Post("/dev/adoption-reset", devResetH.ResetAdoptionState)
			})
		})

		r.Group(func(r chi.Router) {
			r.Use(auth.RequirePermission(permResolver, permissions.UsersList))
			r.Post("/api-keys/issue", apiKeysH.Issue)
			r.Get("/api-keys", apiKeysH.List)
			r.Post("/api-keys/revoke", apiKeysH.Revoke)
		})
	})

	// /roles (PLA-0007 G3)
	r.Route("/roles", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)

		r.With(auth.RequirePermission(permResolver, permissions.RolesList)).
			Get("/", rolesH.List)
		r.With(auth.RequirePermission(permResolver, permissions.RolesList)).
			Get("/creatable", rolesH.Creatable)
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

	} // end mountSiteRoutes

	// Canonical BFF mount: every site-only route lives under /_site.
	// Frontend uses apiSite() (formerly apiInfra) to reach these.
	r.Route("/_site", func(r chi.Router) { mountSiteRoutes(r) })

	// Back-compat shim: mount the same routes at root with a Deprecation
	// header pointing callers at /_site. Removed after ≤2 release cycles
	// once apiSite() codemod has landed and gateway rules are in place.
	// PLA-0039 / B22.1.
	r.Group(func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Deprecation", "true")
				w.Header().Set("Link", `</_site>; rel="successor-version"`)
				next.ServeHTTP(w, req)
			})
		})
		mountSiteRoutes(r)
	})

	// ---- /samantha/v1 — data routes (infra moved to root above) ----
	r.Route("/samantha/v1", func(r chi.Router) {
		// API key validation middleware (story 00443).
		// Validates Bearer token API keys; falls through to JWT auth if not present.
		r.Use(apikeys.Middleware(apiKeysSvc))

		// PLA-0030 Task 9: Deprecation + Sunset headers on every v1 response.
		// Sunset date = 2026-08-07 (90 days from 2026-05-09 cutover start).
		// RFC 8594 Sunset header uses IMF-fixdate format.
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Deprecation", "true")
				w.Header().Set("Sunset", "Fri, 07 Aug 2026 00:00:00 GMT")
				w.Header().Set("Link", `</samantha/v2>; rel="successor-version"`)
				next.ServeHTTP(w, req)
			})
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

	}) // end /samantha/v1

	// ---- /samantha/v2 — feature-gated v2 routes ----
	r.Route("/samantha/v2", func(r chi.Router) {
		r.Use(apikeys.Middleware(apiKeysSvc))

		// ---- /work-items + /portfolio-items (B21 / PLA-0037) ----
		// Both groups share the artefactitemsv2 handler; the only
		// difference is each Service's bound `at.scope` value (see
		// the construction block above). The route shape is identical;
		// any new endpoint added to /work-items must be added to
		// /portfolio-items in the same edit (no scope-leak between groups).
		if os.Getenv("WORK_ITEMS_V2") == "true" {
			// Reads use a higher cap (600/min) so expandAll tree fetches don't
			// exhaust the limit; writes keep the conservative 120/min + per-user gate.
			readLimit := httprate.LimitByIP(600, time.Minute)
			writeLimit := httprate.LimitByIP(120, time.Minute)
			mountArtefactRoutes := func(r chi.Router, h *artefactitemsv2.Handler) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.With(readLimit).Get("/", h.List)
				r.With(writeLimit, userWriteLimiter).Post("/", h.Create)
				r.With(writeLimit, userWriteLimiter).Post("/bulk", h.Bulk)
				r.With(readLimit).Get("/summary", h.Summary)
				r.With(readLimit).Get("/flow-states", h.ListFlowStates)
				r.With(readLimit).Get("/{id}", h.Get)
				r.With(writeLimit, userWriteLimiter).Patch("/{id}", h.Patch)
				r.With(writeLimit, userWriteLimiter).Delete("/{id}", h.Archive)
				r.With(readLimit).Get("/{id}/children", h.ListChildren)
				r.With(readLimit).Get("/{id}/field-values", h.ListFieldValues)
				r.With(writeLimit, userWriteLimiter).Put("/{id}/field-values", h.UpsertFieldValues)
				r.With(writeLimit, userWriteLimiter).Delete("/{id}/field-values/{field_library_id}", h.DeleteFieldValue)
			}
			r.Route("/work-items", func(r chi.Router) { mountArtefactRoutes(r, workItemsV2H) })
			r.Route("/portfolio-items", func(r chi.Router) { mountArtefactRoutes(r, portfolioItemsV2H) })
		} else {
			r.Get("/work-items", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "v2 work-items not enabled", http.StatusServiceUnavailable)
			})
			r.Get("/portfolio-items", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "v2 portfolio-items not enabled", http.StatusServiceUnavailable)
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

		// ---- /search (B7.2) ----
		if searchH != nil {
			r.Route("/search", func(r chi.Router) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.Use(httprate.LimitByIP(60, time.Minute))
				r.Post("/", searchH.Search)
			})
		} else {
			r.Post("/search", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "search not available", http.StatusServiceUnavailable)
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
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Post("/{id}/start", sprintH.Start)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Post("/{id}/close", sprintH.Close)
			})
		} else {
			r.Get("/timeboxes/sprints", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "timebox sprints not enabled", http.StatusServiceUnavailable)
			})
		}

		// ---- /timeboxes/releases ----
		if releaseH != nil {
			r.Route("/timeboxes/releases", func(r chi.Router) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.Use(httprate.LimitByIP(120, time.Minute))

				r.Get("/", releaseH.List)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Post("/", releaseH.Create)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Post("/bulk-create", releaseH.BulkCreate)
				r.Get("/{id}", releaseH.Get)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Put("/{id}", releaseH.Update)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Delete("/{id}", releaseH.Delete)
			})
		} else {
			r.Get("/timeboxes/releases", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "timebox releases not enabled", http.StatusServiceUnavailable)
			})
		}

		// ---- /portfolio/master_record (PLA-0026 B9 / PLA-0030 T4a) ----
		// Per-workspace read of master_record_portfolio (vector_artefacts).
		// mmff_vector used only for tenancy/membership gate inside handler.
		r.Route("/portfolio", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Use(userWriteLimiter)
			portfolioMasterRecordH.Mount(r)
		})

		// ---- /workspace/{id}/fields (PLA-0026 B11 / PLA-0030 T3) ----
		// Admitted field set for one workspace. Auth + tenancy + membership
		// gating happens inside the handler (404 for cross-tenant probes).
		r.Route("/workspace/{id}/fields", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Get("/", fieldsH.List)
		})

		// ---- /workspace/{id}/portfolio/layers (PLA-0026 B10 / PLA-0030 T3) ----
		// Strategy artefact_types (scope='strategy') for one workspace.
		// Auth + tenancy + membership gating inside the handler.
		r.Route("/workspace/{id}/portfolio", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Use(userWriteLimiter)
			r.Get("/layers", workspaceLayersH.GetWorkspaceLayers)
		})

		// ---- /topology (PLA-0006 / M6.1.1) ----
		// Federated organisational canvas. All authenticated roles can read
		// the tree (clamp predicate trims what each user sees at consuming
		// endpoints). Mutations require padmin OR an admin grant on the
		// affected node; node-grant authorisation is checked inside
		// orgdesign.Service. Registered on v2 because all topology I/O now
		// targets vector_artefacts via vaPool (M6.2.7).
		r.Route("/topology", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Use(userWriteLimiter)

			// Workspace clamp: every list-style read narrows to one
			// workspace resolved from ?ws=<slug|uuid>. Middleware stashes
			// workspace_id on context; service reads splice it into WHERE.
			wsLookup := orgdesign.PoolWorkspaceLookup{Pool: pool}
			r.Group(func(r chi.Router) {
				r.Use(orgdesign.WorkspaceClampMiddleware(wsLookup))

				r.Get("/tree", orgDesignH.Tree)
				r.Get("/nodes/{id}/ancestors", orgDesignH.Ancestors)
				r.Get("/nodes/{id}/archived-descendants", orgDesignH.ArchivedDescendants)
				r.Get("/preview-move", orgDesignH.PreviewMove)
				r.Get("/disconnected", orgDesignH.Disconnected)
				r.Get("/commit", orgDesignH.CommitStatus)

				// View-state is per-(workspace, user) canvas viewport;
				// workspace_id comes from WorkspaceClampMiddleware context.
				r.Put("/view-state", orgDesignH.ViewState)
			})

			// Writes
			r.Post("/nodes", orgDesignH.Create)
			r.Patch("/nodes/{id}", orgDesignH.Patch)
			r.Delete("/nodes/{id}", orgDesignH.Archive)
			r.Post("/nodes/{id}/disconnect", orgDesignH.Disconnect)
			r.Post("/nodes/{id}/duplicate", orgDesignH.Duplicate)
			r.Post("/nodes/{id}/restore", orgDesignH.Restore)
			r.Post("/nodes/bulk-position", orgDesignH.BulkPosition)
			r.Post("/nodes/{id}/roles", orgDesignH.GrantRole)
			r.Delete("/roles/{grant_id}", orgDesignH.RevokeRole)
			r.Post("/commit", orgDesignH.Commit)
			r.Post("/reset", orgDesignH.Reset)
		})

		// ---- /flows (PLA-0031 / M1) ----
		// Per-subscription workflow definitions. Reads from vector_artefacts.
		// mmff_vector pool retained in service for tenancy gate only.
		if flowsH != nil {
			r.Route("/flows", func(r chi.Router) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.Use(auth.RequirePermission(permResolver, permissions.FlowsManage))
				r.Use(httprate.LimitByIP(60, time.Minute))
				r.Get("/", flowsH.List)
			})
		} else {
			r.Get("/flows", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "flows service not available", http.StatusServiceUnavailable)
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

	// Start search index outbox worker — requires vector_artefacts pool (B7.1.1).
	// Reads artefacts_search_outbox in vector_artefacts (migration 035).
	if vaPool != nil {
		swCfg := searchworker.Config{
			OllamaURL:   os.Getenv("OLLAMA_URL"),
			OllamaModel: os.Getenv("OLLAMA_MODEL"),
		}
		if swCfg.OllamaURL == "" {
			swCfg.OllamaURL = "http://localhost:11434"
		}
		go searchworker.New(vaPool, swCfg).Run(shutdownCtx)
		// Start webhook delivery worker (B9). Reads webhook_deliveries (migration 037).
		go webhooks.NewWorker(vaPool).Run(shutdownCtx)
	} else {
		log.Println("searchworker: vaPool not available — search indexing disabled")
		log.Println("webhooks/worker: vaPool not available — webhook delivery disabled")
	}

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
