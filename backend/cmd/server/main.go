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

	"github.com/mmffdev/vector-backend/internal/logger"
	"github.com/mmffdev/vector-backend/internal/addressables"
	"github.com/mmffdev/vector-backend/internal/alerting"
	"github.com/mmffdev/vector-backend/internal/apikeys"
	"github.com/mmffdev/vector-backend/internal/cspreport"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/geo"
	"github.com/mmffdev/vector-backend/internal/bootstatus"
	"github.com/mmffdev/vector-backend/internal/custompages"
	"github.com/mmffdev/vector-backend/internal/db"
	"github.com/mmffdev/vector-backend/internal/errorsreport"
	"github.com/mmffdev/vector-backend/internal/fields"
	"github.com/mmffdev/vector-backend/internal/flows"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/libraryreleases"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/nav"
	"github.com/mmffdev/vector-backend/internal/pageaccess"
	"github.com/mmffdev/vector-backend/internal/topology"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/roles"
	"github.com/mmffdev/vector-backend/internal/search"
	"github.com/mmffdev/vector-backend/internal/searchworker"
	"github.com/mmffdev/vector-backend/internal/portfolio"
	"github.com/mmffdev/vector-backend/internal/portfoliomodels"
	"github.com/mmffdev/vector-backend/internal/ranking"
	"github.com/mmffdev/vector-backend/internal/realtime"
	"github.com/mmffdev/vector-backend/internal/security"
	"github.com/mmffdev/vector-backend/internal/tenantmasterrecord"
	"github.com/mmffdev/vector-backend/internal/workspacemasterrecord"
	"github.com/mmffdev/vector-backend/internal/usertaborder"
	"github.com/mmffdev/vector-backend/internal/users"
	"github.com/mmffdev/vector-backend/internal/timeboxreleases"
	"github.com/mmffdev/vector-backend/internal/timeboxsprints"
	"github.com/mmffdev/vector-backend/internal/webhooks"
	"github.com/mmffdev/vector-backend/internal/artefactitems"
	"github.com/mmffdev/vector-backend/internal/artefactpriorities"
	"github.com/mmffdev/vector-backend/internal/artefacttypes"
	"github.com/mmffdev/vector-backend/internal/transport"
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
	logger.Init()

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
		logger.Warn("APP_ENV relaxed — DO NOT run in production", "app_env", appEnv)
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
		logger.Warn("permissions parity FAILED — RBAC-gated routes will deny by default until fixed", "err", err)
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

	// audit_log moved to vector_artefacts 2026-05-13 (mmff_vector → VA consolidation P1).
	// Constructed early with `pool` so service constructors can capture the reference;
	// repointed to vaPool below via SetPool once vaPool is initialised. If
	// VECTOR_ARTEFACTS_DB_URL is unset (legacy path), writes continue against pool.
	auditLog := audit.New(pool)
	// B16.8 P5 — audit-event alerting. NewWebhook reads
	// AUDIT_ALERT_{WEBHOOK_URL,ACTIONS,SECRET}; returns a disabled
	// Webhook (no-op) unless both URL and allowlist are set. Wired
	// before any service starts firing audit rows so the alerter is
	// live from the first request.
	alertWebhook := alerting.NewWebhook()
	auditLog.SetAlerter(alertWebhook)
	log.Printf("audit-alerting: %s", alertWebhook.String())
	mailer := email.NewFromEnv()

	authSvc := auth.NewService(pool, auditLog, mailer)
	authSvc.Resolver = permResolver
	// TD-SEC-SESSION-ANOMALY — geo resolver. Loads GeoLite2-City +
	// GeoLite2-ASN .mmdb files from GEOIP_CITY_DB / GEOIP_ASN_DB env
	// paths. Non-fatal if missing: drift detection silently no-ops
	// until the .mmdb files are provisioned (see backend/data/geoip/
	// README.md). Closed on server shutdown by the geoResolver.Close
	// in the signal handler below.
	geoResolver := geo.NewResolver()
	defer func() { _ = geoResolver.Close() }()
	authSvc.Geo = geoResolver
	authH := auth.NewHandler(authSvc)

	// TD-SEC-DPOP-BINDING Phase 3 — background cleanup of expired
	// DPoP proof JTIs. Every authenticated request reserves a jti
	// in the dpop_jti_cache table for replay-prevention (RFC 9449
	// § 4.3 item 11); without periodic eviction the table grows
	// unbounded. 10-minute cadence is well within the 60s + 120s
	// freshness window — any reservation older than 3 min is safely
	// purgeable. Errors are logged but don't block other work.
	go func() {
		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				n, err := authSvc.JTICache.CleanupExpired(ctx)
				if err != nil {
					log.Printf("dpop_jti_cache cleanup: %v", err)
					continue
				}
				if n > 0 {
					log.Printf("dpop_jti_cache cleanup: pruned %d expired", n)
				}
			}
		}
	}()

	apiKeysSvc := apikeys.New(pool)
	apiKeysH := apikeys.NewHandler(apiKeysSvc)

	// Seed dev API key for local testing (story 00443).
	// Only in development; logs the key once for curl testing.
	if err := apikeys.SeedDevKey(ctx, pool, appEnv, os.Getenv("DEV_API_KEY")); err != nil {
		log.Fatalf("seed dev api key: %v", err)
	}

	usersSvc := users.New(pool, auditLog, mailer)
	usersH := users.NewHandler(usersSvc, permResolver)

	// TD-SEC-CSP-NONCES-SRI Phase 2 — browser-side CSP violation reporting.
	// Mounted unauthenticated below; service writes to mmff_vector.csp_reports
	// (mig 209). Per-IP rate limit is the only DoS protection.
	cspReportH := cspreport.NewHandler(cspreport.NewService(pool))

	// Roles HTTP surface (PLA-0007 G3). Service is sole writer for
	// roles + role_permissions; the handler is a thin translation layer.
	rolesSvc := roles.New(pool, auditLog)
	rolesSvc.Resolver = permResolver
	// PLA-0049: resolve the seven grp_* system role UUIDs at boot. Random
	// gen_random_uuid() values mean we can't use compile-time constants;
	// LoadSystemRoles populates Service.SystemRoles once. Failure here is
	// fatal — every downstream gate keys off these UUIDs.
	if err := rolesSvc.LoadSystemRoles(ctx); err != nil {
		log.Fatalf("roles: load system role ids: %v", err)
	}
	rolesH := roles.NewHandler(rolesSvc, permResolver)

	// Page registry: cached DB-backed catalogue. 60s TTL trades a tiny
	// window of staleness after an admin change for near-zero read cost.
	// Prime at startup; on failure record degraded state and continue.
	// nav.CachedRegistry.Get refreshes on demand, so the first nav request
	// after the DB recovers will populate the cache without a restart.
	navRegistry := nav.NewCachedRegistry(pool, 60*time.Second)
	if _, err := navRegistry.Load(ctx); err != nil {
		logger.Warn("nav registry initial load failed — will retry on first request", "err", err)
		bootstatus.Set("nav_registry", false, err.Error())
	} else {
		bootstatus.Set("nav_registry", true, "")
	}
	navSvc := nav.New(pool, navRegistry)
	navBookmarks := nav.NewBookmarks(pool, navRegistry, navSvc)
	navPageBookmarks := nav.NewPageBookmarks(pool, navRegistry, navSvc)
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
	navH := nav.NewHandler(navSvc, navBookmarks, navPageBookmarks, customPagesSvc)
	navEntitiesSvc := nav.NewEntitiesService(pool)
	navEntitiesH := nav.NewEntitiesHandler(navEntitiesSvc)
	navGrantsAdminH := nav.NewGrantsAdminHandler(pool, navRegistry, rolesSvc, auditLog)

	// PLA-0049 Phase 0.5: page-access resolver + handler. The resolver
	// caches the global pages_access_version (1s in-process) and a
	// per-user key_enum access set (re-fetched on version mismatch).
	// auth.RequirePageAccess(keyEnum) middleware reads from this same
	// instance so the cache is shared across all gated routes.
	pageAccessResolver := pageaccess.New(pool, 1*time.Second)
	pageAccessH := pageaccess.NewHandler(pageAccessResolver, func(ctx context.Context) (uuid.UUID, bool) {
		u := auth.UserFromCtx(ctx)
		if u == nil {
			return uuid.Nil, false
		}
		return u.ID, true
	})

	// Per-user, per-page tab ordering for SecondaryNavigation reorder mode (PLA-0014).
	// Sole writer for users_tab_order; mounted at /api/user/tab-order below.
	userTabOrderSvc := usertaborder.New(pool)
	userTabOrderH := usertaborder.NewHandler(userTabOrderSvc)

	// PLA-0039 / Story 00530: portfoliomodels.Service hosts all DB I/O
	// for the package. vaPool is wired further down — pmSvc is rebound
	// after the vaPool block so workspace-layers reads see the live pool.
	portfolioModelsSvc := portfoliomodels.NewService(libPools.RO, pool, nil)
	portfolioModelsH := portfoliomodels.NewHandler(portfolioModelsSvc)
	// vaPool is wired below; nil = legacy-only adoption path. The
	// orchestrator skips PLA-0026 dual-writes when nil.
	// Constructed AFTER the vaPool block so the handler picks up the
	// pool when VECTOR_ARTEFACTS_DB_URL is set.
	// PLA-0026 / Story 00501 (B12): adoption-state handler ALSO waits
	// for vaPool — it now reads master_record_portfolios + artefacts_types
	// from vector_artefacts and degrades to notStarted when vaPool is nil.
	var portfolioAdoptionStateH *portfoliomodels.AdoptionStateHandler
	var portfolioAdoptH *portfoliomodels.AdoptHandler
	var portfolioAdoptStreamH *portfoliomodels.AdoptStreamHandler
	// devResetH is constructed after the vaPool block so MasterReset can
	// target vector_artefacts. See below.
	var devResetH *portfoliomodels.DevResetHandler
	// Library release-notification channel (Phase 3 of mmff_library plan, §12).
	// Reconciler maintains a per-subscription badge-count cache; ticker
	// floor is 15m by default (LIBRARY_RECONCILER_INTERVAL to override).
	// On-login hook warms the cache so the first badge poll after sign-in
	// returns instantly. Cache is invalidated on every successful ack.
	//
	// library_acknowledgements moved to vector_artefacts 2026-05-13
	// (PLA-0023 P1). Early-bound on `pool`; SetAcksPool below swaps to
	// vaPool once it is initialised. Same pattern as audit.Logger.
	libReleasesRec := libraryreleases.NewReconciler(libPools.RO, pool)
	libReleasesRec.Start(ctx)
	defer libReleasesRec.Stop()
	libReleasesSvc := libraryreleases.NewService(libPools.RO, pool, pool)
	libReleasesH := libraryreleases.NewHandler(libReleasesSvc, auditLog, libReleasesRec)

	// Realtime hub + Postgres LISTEN bridge. The hub is in-memory; the
	// bridge runs LISTEN rank_changed on a dedicated connection and
	// fans NOTIFY payloads (emitted by the notify_rank_changed trigger
	// in db/mmff_vector/schema/069) to subscribed clients.
	//
	// Constructed early so other services can inject it as a notifier
	// (e.g. topology GrantNotifier for story 00283 handoff inbox).
	// B16.8.12 — share one SessionRegistry between the hub (which
	// registers WS connections on accept) and the sweeper (which evicts
	// revoked/idle sessions every WS_SESSION_CHECK_INTERVAL). Without
	// the shared handle, the sweeper would walk an empty map and the WS
	// session enforcement contract would silently break.
	rtRegistry := realtime.NewSessionRegistry()
	rtHub := realtime.NewHubWithRegistry(rtRegistry)
	realtime.StartRankListener(context.Background(), pool, rtHub)
	realtime.StartSessionSweeper(context.Background(), pool, rtRegistry)

	// Topology / federated org canvas (PLA-0006). topology is the SOLE
	// writer for topology_nodes, topology_role_grants, and
	// topology_view_state — see backend/internal/topology/boundary_test.go
	// for the CI gate.
	//
	// M6.2.7 cutover: those three tables now live in vector_artefacts,
	// so topology needs vaPool. Construction is deferred until after
	// the vaPool block runs (further down this file). orgDesignSvc /
	// orgDesignH are declared here so handler wiring can reference them.
	var orgDesignSvc *topology.Service
	var orgDesignH *topology.Handler

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
	// B21 (PLA-0037): two handler instances on the same artefactitems
	// codebase — workItemsV2H mounted at /samantha/v2/work-items with
	// scope="work" (legacy compat), portfolioItemsV2H mounted at
	// /samantha/v2/portfolio-items with scope="strategy" (new in B21).
	// Both share vaPool/pool; the only difference is the scope literal
	// each Service binds for `at.scope = $N` filtering.
	var workItemsV2H *artefactitems.Handler
	var portfolioItemsV2H *artefactitems.Handler
	var webhookSvc *webhooks.Service
	// v2ScopeAttach is captured inside the vaPool branch below so the
	// PLA-0043 scope clamp can be wired onto both v2 services once
	// orgDesignSvc is constructed further down. Nil when v2 is stubbed
	// (no vaPool) — scope reads then fall through to ErrInvalidInput
	// inside the service.
	var v2ScopeAttach func(artefactitems.TopologyScopeResolver)
	makeStubHandlers := func() {
		workItemsV2H = artefactitems.NewHandler(artefactitems.NewService(nil, nil, "work"))
		portfolioItemsV2H = artefactitems.NewHandler(artefactitems.NewService(nil, nil, "strategy"))
	}
	if vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL"); vaURL != "" {
		vaCfg, vaErr := pgxpool.ParseConfig(vaURL)
		if vaErr != nil {
			logger.Warn("vector_artefacts pool config error — v2 artefact-items will return empty", "err", vaErr)
			makeStubHandlers()
		} else {
			vaCfg.MinConns = 2
			vaCfg.MaxConnIdleTime = 5 * time.Minute
			p, vaErr := pgxpool.NewWithConfig(ctx, vaCfg)
			if vaErr != nil {
				logger.Warn("vector_artefacts pool connect failed — v2 artefact-items will return empty", "err", vaErr)
				makeStubHandlers()
			} else if vaErr = p.Ping(ctx); vaErr != nil {
				logger.Warn("vector_artefacts pool ping failed — v2 artefact-items will return empty", "err", vaErr)
				p.Close()
				makeStubHandlers()
			} else {
				vaPool = p
				defer vaPool.Close()
				// PLA-0023 / mmff_vector → vector_artefacts consolidation (P1):
				// audit_log lives on vaPool from 2026-05-13. Repoint the
				// early-bound Logger so every service that captured it now
				// writes against vector_artefacts.
				auditLog.SetPool(vaPool)
				// library_acknowledgements moved to vaPool 2026-05-13
				// (PLA-0023 P1). Swap the early-bound pool on both the
				// reconciler (writes refresh-time recounts) and the
				// service (writes acks). libRO + subscriptions stays put.
				libReleasesRec.SetAcksPool(vaPool)
				libReleasesSvc.SetAcksPool(vaPool)
				// Mask password in log: strip :password@ from the URL.
				maskedURL := vaURL
				if i := strings.Index(vaURL, "@"); i > 0 {
					if j := strings.LastIndex(vaURL[:i], ":"); j > 0 {
						maskedURL = vaURL[:j+1] + "***" + vaURL[i:]
					}
				}
				logger.Info("vector_artefacts pool connected", "url", maskedURL)
				webhookSvc = webhooks.New(vaPool)
				notifier := webhooks.NewNotifier(webhookSvc)
				wiSvc := artefactitems.NewService(vaPool, pool, "work")
				wiSvc.WithNotifier(notifier)
				workItemsV2H = artefactitems.NewHandler(wiSvc)
				piSvc := artefactitems.NewService(vaPool, pool, "strategy")
				piSvc.WithNotifier(notifier)
				portfolioItemsV2H = artefactitems.NewHandler(piSvc)
				// PLA-0043 — defer wiring orgDesignSvc until after it is
				// constructed below; assign back through closures so the
				// scope clamp is available on both v2 services.
				v2ScopeAttach = func(t artefactitems.TopologyScopeResolver) {
					wiSvc.WithTopologyResolver(t)
					piSvc.WithTopologyResolver(t)
				}
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
		logger.Warn("VECTOR_ARTEFACTS_DB_URL unset — v2 artefact-items will return empty pages")
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
	orgDesignSvc = topology.New(pool, vaPool).WithNotifier(topology.HubNotifier{Hub: rtHub})
	orgDesignH = topology.NewHandler(orgDesignSvc).WithAudit(auditLog)

	// Wire topology seeder so every new workspace gets a root topology node.
	workspacesSvc.WithTopologySeeder(orgDesignSvc)

	// PLA-0043 — attach the topology resolver to the v2 work/portfolio
	// services so ?scope=<id> on /work-items can resolve to "this node
	// + every descendant" and emit 403 when the caller has no grant.
	// v2ScopeAttach is nil when vaPool is unset (stub handlers) — scope
	// reads then fall through to ErrInvalidInput inside the service.
	if v2ScopeAttach != nil {
		v2ScopeAttach(orgDesignSvc)
	}

	// Portfolio adopt handler — wired AFTER vaPool so PLA-0026 dual-
	// writes target vector_artefacts when the pool is available.
	// PLA-0026 / Story 00495 (B6): master-record-portfolio service is
	// constructed only when vaPool is live; the saga's finalize step
	// is a no-op when masterRecordSvc is nil (orphan-sub fixtures and
	// VA-disabled environments).
	var masterRecordSvc *portfolio.Service
	if vaPool != nil {
		// PLA-0039 / Story 00530: Service holds both pools so the
		// handler can be DB-free. WithVectorPool wires mmff_vector for
		// the read authz path (CanReadMasterRecord).
		masterRecordSvc = portfolio.NewService(vaPool).WithVectorPool(pool)
	}
	portfolioAdoptH = portfoliomodels.NewAdoptHandler(libPools.RO, pool, vaPool, masterRecordSvc)
	portfolioAdoptStreamH = portfoliomodels.NewAdoptStreamHandler(portfolioAdoptH.Orchestrator)

	// PLA-0026 / Story 00501 (B12): adoption-state reads from the new
	// substrate (master_record_portfolios + artefacts_types) via vaPool.
	// vectorPool is still required to resolve subscription_id →
	// workspace_id; vaPool may be nil (handler returns notStarted).
	portfolioAdoptionStateH = portfoliomodels.NewAdoptionStateHandler(pool, vaPool)

	// Dev reset handler — constructed here (after vaPool) so MasterReset
	// can target both mmff_vector (pool) and vector_artefacts (vaPool).
	// vaPool may be nil; MasterReset skips the VA leg gracefully when nil.
	devResetH = portfoliomodels.NewDevResetHandler(pool, vaPool, orgDesignSvc)

	// Tenant settings (master_record_workspaces — renamed from
	// master_record_tenants by migration 067 on 2026-05-15). M2: reads/writes
	// vector_artefacts (mig 036). Falls back to mmff_vector pool until 036 is
	// applied on dev.
	workspaceSettingsPool := pool
	if vaPool != nil {
		workspaceSettingsPool = vaPool
	}
	workspaceSettingsSvc := workspacemasterrecord.New(workspaceSettingsPool)
	workspaceSettingsH := workspacemasterrecord.NewHandler(workspaceSettingsSvc)

	// Tenant settings (master_record_tenants in vector_artefacts —
	// subscription-keyed, PLA-0050). Reuses the same pool fallback
	// pattern as workspace-settings above.
	tenantSettingsPool := pool
	if vaPool != nil {
		tenantSettingsPool = vaPool
	}
	tenantSettingsSvc := tenantmasterrecord.New(tenantSettingsPool)
	tenantSettingsH := tenantmasterrecord.NewHandler(tenantSettingsSvc)

	// PLA-0051 Story 3.5 — wire tenant→workspace inheritance read-path.
	// SubscriptionResolver reads fdw_workspaces in vector_artefacts to
	// resolve workspace_id → subscription_id; TenantDefaultsReader
	// reads master_record_tenants with pointer types so NULLs survive
	// the scan (the merge in workspacemasterrecord.Service uses NULL
	// to mean "fall through to schema default"). Both share the
	// workspace-settings pool which is vaPool when available.
	//
	// Both pools land in the same DB (vector_artefacts) but the wiring
	// is intentionally conservative: if vaPool is nil (test env / pool
	// fallback to mmff_vector), the resolver would fail on fdw_workspaces
	// — Service.mergeInheritance treats that as "no tenant tier" and
	// falls to schema defaults, so the surface degrades gracefully
	// rather than crashes.
	if vaPool != nil {
		workspaceSettingsSvc.WithInheritance(
			workspacemasterrecord.NewFDWSubscriptionResolver(workspaceSettingsPool),
			workspacemasterrecord.NewPGTenantDefaultsReader(workspaceSettingsPool),
		)
		// TD-WS-001 pay-down — handler resolves the active workspace_id
		// from the caller's subscription via FDWActiveWorkspaceResolver.
		// No URL params, no client involvement. The user never sees a
		// workspace UUID.
		// See: .claude/memory/project_workspace_scope_invisible.md
		workspaceSettingsH.WithResolver(
			workspacemasterrecord.NewFDWActiveWorkspaceResolver(workspaceSettingsPool),
		)
	}

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
	portfolioMasterRecordH := portfolio.NewHandler(masterRecordSvc)

	// PLA-0026 / Story 00500 (B11): GET /api/workspace/{id}/fields —
	// returns the admitted field set for one workspace, computed by
	// the same admit/deny rules the per-field resolver uses (R047 §5).
	// vectorPool is required (membership + tenancy lookups); vaPool
	// may be nil — in that case the handler returns an empty fields
	// slice after the auth gate succeeds (mirrors v2 work-items).
	fieldsSvc := fields.NewService(pool, vaPool)
	fieldsH := fields.NewHandler(fieldsSvc)

	// PLA-0026 / Story 00499 (B10): workspace-scoped successor to the
	// legacy GET /api/subscription/layers. Reads strategy artefacts_types
	// from vector_artefacts; legacy handler stays live until F3 (per
	// R047 §9). vaPool may be nil — handler returns 503 in that case.
	// PLA-0039 / Story 00530: pmSvc was constructed up-top with vaPool=nil
	// (before VA boot). Now that vaPool is known, attach it so workspace-
	// layers reads see the live pool.
	portfolioModelsSvc.WithVAPool(vaPool)
	workspaceLayersH := portfoliomodels.NewWorkspaceLayersHandler(portfolioModelsSvc)

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
			ScopeColumn: "artefacts_id_timebox_sprint",
			Permissions: ranking.PermissionCheckerFunc(func(ctx context.Context, subscriptionID, rowID uuid.UUID) (bool, error) {
				return true, nil
			}),
		})
		rankH = ranking.NewHandler(ranking.New(vaPool))
	}

	// Artefact-types settings handler (Customisation page).
	// Serves GET + PATCH for name/prefix/description/colour on all live types.
	artefactTypesSvc := artefacttypes.NewService(vaPool)
	workspacesSvc.WithArtefactTypeSeeder(artefactTypesSvc)
	artefactTypesH := artefacttypes.NewHandler(artefactTypesSvc)
	artefactPrioritiesH := artefactpriorities.NewHandler(artefactpriorities.NewService(vaPool))

	// PLA-0053 / story 00578: hoist the workspace-clamp lookup once so
	// every route group that needs the JWT-anchored workspace clamp
	// reuses the same adapter (topology, artefact-types, work-items,
	// portfolio-items). Backed by the mmff_vector pool because the
	// `master_record_workspaces` + `users_roles_workspaces` tables live
	// there (per docs/c_c_db_routing.md). The middleware itself reads
	// auth.User.WorkspaceID (the JWT claim) for the workspace; the
	// lookup runs the HasActiveRole check and the legacy-token
	// FirstLiveWorkspace fallback.
	workspaceLookup := topology.PoolWorkspaceLookup{Pool: pool}

	// B7.2: search query handler — fulltext via tsvector (plainto_tsquery).
	// Only available when vaPool is up (vector_artefacts has the search columns).
	var searchH *search.Handler
	if vaPool != nil {
		searchH = search.NewHandler(search.New(vaPool))
	}

	// Generic error reporter: any authenticated role can POST a
	// {code, context} pair; we validate the code against the cross-DB
	// mmff_library.error_codes catalogue and append-only insert into
	// vector_artefacts.error_events (moved from mmff_vector 2026-05-13,
	// PLA-0023 P1). Falls back to `pool` when vaPool is unavailable so
	// pre-cutover environments keep working.
	errorsReportPool := pool
	if vaPool != nil {
		errorsReportPool = vaPool
	}
	errorsReportH := errorsreport.NewHandler(errorsreport.NewService(libPools.RO, errorsReportPool))

	authSvc.OnLogin = append(authSvc.OnLogin, func(ctx context.Context, u *roletypes.User) {
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
	r.Use(logger.HTTPLogger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   strings.Split(os.Getenv("FRONTEND_ORIGIN"), ","),
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-CSRF-Token", "DPoP"},
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

	// /csp-report — TD-SEC-CSP-NONCES-SRI Phase 2.
	// Unauthenticated AND CSRF-exempt: the browser POSTs these on the
	// user's behalf with no session cookie. Per-IP rate limit is the
	// only DoS protection. Accepts both legacy application/csp-report
	// and modern application/reports+json wire formats; service drops
	// browser-extension noise before persisting.
	r.With(httprate.LimitByIP(120, time.Minute)).Post("/csp-report", cspReportH.Report)

	// /auth
	r.Route("/auth", func(r chi.Router) {
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/login", authH.Login)
		r.Post("/refresh", authH.Refresh)
		r.Post("/logout", authH.Logout)
		r.With(httprate.LimitByIP(3, time.Hour)).Post("/password-reset", authH.PasswordReset)
		// TD-SEC-RESET-TOKEN-FRAGMENT — email links hit /redeem which
		// validates the raw token, sets a 5-min HttpOnly handoff cookie,
		// and 302s to /login/reset/confirm. /state is the frontend's
		// "is my cookie alive?" probe. /confirm reads the cookie and
		// (back-compat) still accepts a raw token in the body for
		// non-browser callers.
		r.With(httprate.LimitByIP(20, time.Minute)).Get("/password-reset/redeem", authH.PasswordResetRedeem)
		r.With(httprate.LimitByIP(60, time.Minute)).Get("/password-reset/state", authH.PasswordResetState)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/password-reset/confirm", authH.PasswordResetConfirm)

		// Login continuation handoff (TD-SEC-LOGIN-REDIRECT-COOKIE).
		// Replaces /login?redirect=<path>. /login-required is the
		// redirect target the Next.js middleware bounces unauthenticated
		// users to; it validates the path, mints a 10-min HttpOnly
		// cookie carrying the signed path, 302s to a plain /login.
		// /login-continuation is the post-auth probe — returns 200 +
		// { path } if a valid cookie is present (and clears it
		// atomically), 204 otherwise.
		r.With(httprate.LimitByIP(120, time.Minute)).Get("/login-required", authH.LoginRequired)
		r.With(httprate.LimitByIP(60, time.Minute)).Get("/login-continuation", authH.LoginContinuation)

		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Post("/change-password", authH.ChangePassword)
		})

		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Get("/me", authH.Me)
			// PLA-0053 / story 00576.5 — re-mint JWT with a new
			// workspace_id claim. Mounted alongside /me so the
			// auth+fresh-password gates already on this group apply.
			r.Post("/switch-workspace", authH.SwitchWorkspace)
		})

		// B16.8.3 — MFA verify (unauthenticated — accepts challenge_token)
		r.With(httprate.LimitByIP(10, time.Minute)).Post("/mfa/verify", authH.MFAVerify)

		// B16.8.4 — MFA management (requires full authentication)
		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Post("/mfa/enroll", authH.MFAEnroll)
			r.Post("/mfa/confirm", authH.MFAConfirm)
			r.Delete("/mfa", authH.MFADisable)
		})

		// B16.8.10 — active sessions UI + per-action step-up reauth.
		// Rate-limited because Reauth burns a password verify per call;
		// 20/min is generous enough for legitimate UX (modal retries)
		// while capping brute-force attempts against the password.
		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.With(httprate.LimitByIP(20, time.Minute)).Post("/reauth", authH.Reauth)
			r.Route("/sessions", func(r chi.Router) {
				r.Get("/", authH.ListSessions)
				r.Post("/revoke-others", authH.RevokeOtherSessions)
				r.Delete("/{id}", authH.RevokeSession)
			})
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

		r.Get("/active-scope", usersH.GetActiveScope)
		r.Put("/active-scope", usersH.SetActiveScope)

		// Per-user namespaced preferences (mig 208).
		// Replaces URL-bar query state for filter chips, sort, tab —
		// see TD-URL-FILTER-CHIPS / TD-URL-TAB-STATE in c_tech_debt.md.
		r.Get("/preferences/{key}", usersH.GetPreference)
		r.Put("/preferences/{key}", usersH.SetPreference)
		r.Delete("/preferences/{key}", usersH.DeletePreference)

		// PLA-0049 Phase 0.5.3: per-user page-access set + global version.
		// Drives usePageAccess() in the frontend; client polls/re-fetches
		// when the version bumps.
		r.Get("/page-access", pageAccessH.MeAccess)
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
		r.Post("/reset", navH.ResetAll)
		r.Get("/start-page", navH.StartPage)
		r.Post("/bookmark", navH.PinBookmark)
		r.Delete("/bookmark", navH.UnpinBookmark)
		r.Get("/bookmark/check", navH.CheckBookmark)
		r.Post("/page-bookmark", navH.PinPageBookmark)
		r.Delete("/page-bookmark", navH.UnpinPageBookmark)
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

	// /admin/page-grants — gadmin-only matrix at /user-management/permissions.
	// Grants and revokes (page × role) rows in users_roles_pages. The
	// {role_id} URL param is rejected for grp_global inside the handler so
	// this surface can never strip gadmin's universal page access.
	//
	// PLA-0049 Phase 0.5.6: also gated by RequirePageAccess("um-permissions")
	// so a hand-typed URL or stale bookmark from a user whose grant on
	// the page-permissions page has been revoked is denied at the API
	// layer — not just rendered as a blank UI.
	r.Route("/admin/page-grants", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequirePermission(permResolver, permissions.RolesAssignPermissions))
		r.Use(auth.RequirePageAccess(pageAccessResolver, "um-permissions"))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Get("/", navGrantsAdminH.List)
		r.Put("/{page_id}/{role_id}", navGrantsAdminH.Grant)
		r.Delete("/{page_id}/{role_id}", navGrantsAdminH.Revoke)
		// PLA-0049 Phase 1.2: bucket-row toggle. Body: {"checked": bool}.
		// Atomic grant/revoke for every system page in the named bucket.
		r.Put("/bucket/{tag_enum}/{role_id}", navGrantsAdminH.BucketToggle)
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

		// B16.8.10 — DELETE /workspaces/{id} is the one sensitive action
		// in this group that doesn't already self-gate on inline password
		// reauth (change-password and disable-mfa both take a password in
		// the body and re-verify). Register the gated DELETE BEFORE
		// workspacesH.Mount so chi resolves it ahead of Mount's own
		// DELETE handler. The unique action_key "delete-workspace" must
		// match what the frontend's useStepUpAction hook submits to
		// /auth/reauth.
		r.With(authSvc.RequireStepUpReauth("delete-workspace")).Delete("/{id}", workspacesH.Delete)
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
				permissions.UsersCreateGrpGlobal,
				permissions.UsersCreateGrpPortfolio,
				permissions.UsersCreateGrpProduct,
				permissions.UsersCreateGrpTeamLead,
				permissions.UsersCreateGrpTeamMember,
				permissions.UsersCreateGrpStakeholder,
				permissions.UsersCreateGrpExternal,
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
				r.Post("/dev/master-reset", devResetH.MasterReset)
				r.Post("/dev/seed-risks", devResetH.SeedRisks)
				r.Post("/dev/seed-workspace", devResetH.SeedWorkspace)
			})
		})

		r.Group(func(r chi.Router) {
			r.Use(auth.RequirePermission(permResolver, permissions.UsersList))
			r.Post("/api-keys/issue", apiKeysH.Issue)
			r.Get("/api-keys", apiKeysH.List)
			r.Post("/api-keys/revoke", apiKeysH.Revoke)
		})
	})

	// /timeboxes/sprints + /timeboxes/releases (B22.23)
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
	}
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
	}

	// /portfolio + /workspace/{id}/portfolio/layers (B22.19)
	// Portfolio master record + workspace layer reads — site-only BFF surfaces.
	r.Route("/portfolio", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		portfolioMasterRecordH.Mount(r)
	})
	r.Route("/workspaces/{id}/portfolio", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		r.Get("/layers", workspaceLayersH.GetWorkspaceLayers)
		r.Patch("/layers/batch", workspaceLayersH.PatchWorkspaceLayers)
	})

	// /flows (B22.20) — site-only; padmin-managed workflow definitions.
	if flowsH != nil {
		r.Route("/flows", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(auth.RequirePermission(permResolver, permissions.FlowsManage))
			r.Use(topology.WorkspaceClampMiddleware(workspaceLookup))
			r.Use(httprate.LimitByIP(60, time.Minute))
			r.Get("/", flowsH.List)
			// Per-flow state + transition management.
			r.Route("/{flowId}/states", func(r chi.Router) {
				r.Post("/", flowsH.CreateFlowState)
			})
			r.Route("/{flowId}/transitions", func(r chi.Router) {
				r.Post("/", flowsH.CreateTransition)
				r.Delete("/", flowsH.DeleteTransition)
			})
			// Reset to factory-default snapshot — diff/preview, then apply.
			r.Post("/reset/preview", flowsH.ResetPreview)
			r.Post("/reset/apply", flowsH.ResetApply)
		})
		// Flow state mutations — no flows.manage gate so padmin/gadmin can use.
		r.Route("/flow-states", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Patch("/{id}", flowsH.PatchFlowState)
			r.Delete("/{id}", flowsH.DeleteFlowState)
			// Per-state exit-rule checklist (FE-GOV-0003).
			r.Get("/{id}/exit-rules", flowsH.ListExitRules)
			r.Post("/{id}/exit-rules", flowsH.CreateExitRule)
		})
		// Single exit-rule mutations (FE-GOV-0003).
		r.Route("/flow-state-exit-rules", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Patch("/{id}", flowsH.PatchExitRule)
			r.Delete("/{id}", flowsH.DeleteExitRule)
		})
	}

	// /workspace/{id}/fields (B22.21) — admitted field set per workspace.
	r.Route("/workspaces/{id}/fields", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Get("/", fieldsH.List)
	})

	// /work-items + /portfolio-items + /rank (B22.17, B22.18, B22.22)
	// These are BFF-only: the ObjectTree, WorkItemDetailPanel, and
	// artefact-items tree are all staff/site surfaces. The same
	// artefactitems handlers (and rate limits) are reused.
	if workItemsV2H != nil {
		readLimit17 := httprate.LimitByIP(600, time.Minute)
		writeLimit17 := httprate.LimitByIP(120, time.Minute)
		mountArtefactSite := func(r chi.Router, h *artefactitems.Handler) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			// PLA-0053 / story 00578: workspace clamp via JWT claim.
			// Runs after auth so middleware has u.WorkspaceID populated.
			r.Use(topology.WorkspaceClampMiddleware(workspaceLookup))
			r.With(readLimit17).Get("/", h.List)
			r.With(writeLimit17, userWriteLimiter).Post("/", h.Create)
			r.With(writeLimit17, userWriteLimiter).Post("/bulk", h.Bulk)
			r.With(readLimit17).Get("/summary", h.Summary)
			r.With(readLimit17).Get("/flow-states", h.ListFlowStates)
			r.With(readLimit17).Get("/{id}", h.Get)
			r.With(writeLimit17, userWriteLimiter).Patch("/{id}", h.Patch)
			r.With(writeLimit17, userWriteLimiter).Delete("/{id}", h.Archive)
			r.With(readLimit17).Get("/{id}/children", h.ListChildren)
			r.With(readLimit17).Get("/{id}/field-values", h.ListFieldValues)
			r.With(writeLimit17, userWriteLimiter).Put("/{id}/field-values", h.UpsertFieldValues)
			r.With(writeLimit17, userWriteLimiter).Delete("/{id}/field-values/{field_library_id}", h.DeleteFieldValue)
		}
		r.Route("/work-items", func(r chi.Router) { mountArtefactSite(r, workItemsV2H) })
		r.Route("/portfolio-items", func(r chi.Router) { mountArtefactSite(r, portfolioItemsV2H) })
		// PLA-0052 Story 10 — Risk summary endpoint. Severity × likelihood
		// aggregator for the /risk page header. Reuses workItemsV2H (scope=work)
		// since Risk is a work-scope artefact type. Public surface (/samantha/v2)
		// deferred until n8n needs it.
		r.Route("/risks", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.With(readLimit17).Get("/summary", workItemsV2H.RisksSummary)
		})
	}
	if rankH != nil {
		r.Route("/rank", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(240, time.Minute))
			r.Use(userWriteLimiter)
			r.Post("/move", rankH.Move)
		})
	}

	// /topology (B22.16 — /_site mirror of /samantha/v2/topology)
	// All topology I/O is internal-only (staff + padmin); there is no
	// public customer surface for org-design operations.
	r.Route("/topology", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)

		r.Group(func(r chi.Router) {
			// PLA-0053 / story 00578: reuses the hoisted workspaceLookup
			// (was inline PoolWorkspaceLookup pre-00578).
			r.Use(topology.WorkspaceClampMiddleware(workspaceLookup))

			r.Get("/tree", orgDesignH.Tree)
			r.Get("/nodes/{id}/ancestors", orgDesignH.Ancestors)
			r.Get("/nodes/{id}/archived-descendants", orgDesignH.ArchivedDescendants)
			r.Get("/preview-move", orgDesignH.PreviewMove)
			r.Get("/disconnected", orgDesignH.Disconnected)
			r.Get("/commit", orgDesignH.CommitStatus)
			r.Put("/view-state", orgDesignH.ViewState)
		})

		// PLA-0042 — scope picker. Not workspace-clamped: a user's
		// grants may span workspaces inside their subscription.
		r.Get("/grants/me", orgDesignH.MyGrants)

		// PLA-0046 / B6.8 — admin-pivot grant listing for the
		// Topology Permissions page. Not workspace-clamped: target
		// user's grants may span workspaces inside the subscription.
		r.With(auth.RequirePermission(permResolver, permissions.TopologyGrantsManageOthers)).
			Get("/users/{userId}/grants", orgDesignH.ListGrantsByUser)

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

	// Artefact-types settings: GET (list all) + PATCH /{id} (name/prefix/description/colour).
	// No permission gate beyond auth — every authenticated user can read types;
	// writes require workspace.archive (padmin+), enforced client-side and tightened later.
	//
	// PLA-0053 / story 00578: mounted under WorkspaceClampMiddleware so
	// every read clamps to the JWT-resolved workspace. The middleware
	// runs after RequireAuth + RequireFreshPassword per its contract.
	r.Route("/artefact-types", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(topology.WorkspaceClampMiddleware(workspaceLookup))
		artefactTypesH.Mount(r)
	})

	// PLA-0055 / story 00596 — per-workspace priorities CRUD. Same
	// auth/clamp shape as /artefact-types: every read narrows to the
	// JWT-resolved workspace via WorkspaceClampMiddleware.
	r.Route("/artefact-priorities", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(topology.WorkspaceClampMiddleware(workspaceLookup))
		artefactPrioritiesH.Mount(r)
	})

	// ---- /portfolio-models ----
	r.Route("/portfolio-models", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		r.With(auth.RequirePermission(permResolver, permissions.PortfolioList)).
			Get("/", portfolioModelsH.List)
		r.With(
			auth.RequirePermission(permResolver, permissions.PortfolioList),
			topology.WorkspaceClampMiddleware(workspaceLookup),
		).Get("/adoption-state", portfolioAdoptionStateH.GetAdoptionState)
		r.Get("/{family}/latest", portfolioModelsH.GetLatestByFamily)
		r.Get("/{id}", portfolioModelsH.GetByModelID)
		r.With(
			auth.RequirePermission(permResolver, permissions.PortfolioList),
			topology.WorkspaceClampMiddleware(workspaceLookup),
		).Post("/{id}/adopt", portfolioAdoptH.Adopt)
		r.With(
			auth.RequirePermission(permResolver, permissions.PortfolioList),
			topology.WorkspaceClampMiddleware(workspaceLookup),
		).Get("/{id}/adopt/stream", portfolioAdoptStreamH.Stream)
	})

	// ---- /workspace-settings ----
	r.Route("/workspace-settings", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		workspaceSettingsH.Mount(r)
	})

	// ---- /tenant-settings (PLA-0050) ----
	// Subscription-tier defaults editor. va-tenant-settings page-access row
	// is seeded by story 00572 in the `pages` table; RequirePageAccess gates
	// the API on the same grant the UI uses, so a hand-typed URL or stale
	// bookmark from a user whose grant has been revoked is denied at the API
	// layer — not just rendered as a blank UI. PLA-0050 AC7 verification:
	// non-gadmin users 403 here.
	r.Route("/tenant-settings", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequirePageAccess(pageAccessResolver, "va-tenant-settings"))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Use(userWriteLimiter)
		tenantSettingsH.Mount(r)
	})

	} // end mountSiteRoutes

	// tagSite middleware annotates the request context with transport.Site so
	// audit.Logger and any per-transport logic can read it without coupling to
	// mount paths (PLA-0039 / B22.11).
	tagSite := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(transport.WithSiteContext(req.Context())))
		})
	}

	// Canonical BFF mount: every site-only route lives under /_site.
	// Frontend uses apiSite() (formerly apiInfra) to reach these.
	r.Route("/_site", func(r chi.Router) {
		r.Use(tagSite)
		mountSiteRoutes(r)
	})

	// Back-compat shim: mount the same routes at root with a Deprecation
	// header pointing callers at /_site. Removed after ≤2 release cycles
	// once apiSite() codemod has landed and gateway rules are in place.
	// PLA-0039 / B22.1.
	r.Group(func(r chi.Router) {
		r.Use(tagSite)
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				w.Header().Set("Deprecation", "true")
				w.Header().Set("Link", `</_site>; rel="successor-version"`)
				next.ServeHTTP(w, req)
			})
		})
		mountSiteRoutes(r)
	})

	// ---- /samantha/v2 — feature-gated v2 routes ----
	r.Route("/samantha/v2", func(r chi.Router) {
		r.Use(func(next http.Handler) http.Handler {
			return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				next.ServeHTTP(w, req.WithContext(transport.WithPublicContext(req.Context())))
			})
		})
		r.Use(apikeys.Middleware(apiKeysSvc))

		// ---- /work-items + /portfolio-items (B21 / PLA-0037) ----
		// Both groups share the artefactitems handler; the only
		// difference is each Service's bound `at.scope` value (see
		// the construction block above). The route shape is identical;
		// any new endpoint added to /work-items must be added to
		// /portfolio-items in the same edit (no scope-leak between groups).
		if os.Getenv("WORK_ITEMS_V2") == "true" {
			// Reads use a higher cap (600/min) so expandAll tree fetches don't
			// exhaust the limit; writes keep the conservative 120/min + per-user gate.
			readLimit := httprate.LimitByIP(600, time.Minute)
			writeLimit := httprate.LimitByIP(120, time.Minute)
			mountArtefactRoutes := func(r chi.Router, h *artefactitems.Handler) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				// PLA-0053 / story 00578: workspace clamp via JWT claim
				// on the /samantha/v2 surface too (parity with /_site).
				r.Use(topology.WorkspaceClampMiddleware(workspaceLookup))
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
		// Per-workspace read of master_record_portfolios (vector_artefacts).
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
		r.Route("/workspaces/{id}/fields", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Get("/", fieldsH.List)
		})

		// ---- /workspace/{id}/portfolio/layers (PLA-0026 B10 / PLA-0030 T3) ----
		// Strategy artefacts_types (scope='strategy') for one workspace.
		// Auth + tenancy + membership gating inside the handler.
		r.Route("/workspaces/{id}/portfolio", func(r chi.Router) {
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
		// topology.Service. Registered on v2 because all topology I/O now
		// targets vector_artefacts via vaPool (M6.2.7).
		r.Route("/topology", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Use(userWriteLimiter)

			// Workspace clamp: every list-style read narrows to one
			// workspace resolved from the JWT workspace_id claim
			// (PLA-0053 / story 00576 dropped the ?ws= URL surface;
			// story 00578 hoisted workspaceLookup to top-level).
			// Middleware stashes workspace_id on context; service reads
			// splice it into WHERE.
			r.Group(func(r chi.Router) {
				r.Use(topology.WorkspaceClampMiddleware(workspaceLookup))

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

			// PLA-0042 — scope picker. Not workspace-clamped: a user's
			// grants may span workspaces inside their subscription.
			r.Get("/grants/me", orgDesignH.MyGrants)

			// PLA-0046 / B6.8 — admin-pivot grant listing for the
			// Topology Permissions page. Not workspace-clamped: target
			// user's grants may span workspaces inside the subscription.
			r.With(auth.RequirePermission(permResolver, permissions.TopologyGrantsManageOthers)).
				Get("/users/{userId}/grants", orgDesignH.ListGrantsByUser)

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
		logger.Warn("searchworker: vaPool not available — search indexing disabled")
		logger.Warn("webhooks/worker: vaPool not available — webhook delivery disabled")
	}

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("listening", "port", port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}
	}()

	select {
	case err := <-serverErr:
		log.Fatalf("server error: %v", err)
	case <-shutdownCtx.Done():
		logger.Info("shutdown signal received, draining")
		drainCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := srv.Shutdown(drainCtx); err != nil {
			log.Printf("graceful shutdown failed: %v", err)
		}
	}
}
