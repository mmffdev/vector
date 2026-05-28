package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"log/slog"
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
	"github.com/mmffdev/vector-backend/internal/cache"
	"github.com/mmffdev/vector-backend/internal/custompages"
	"github.com/mmffdev/vector-backend/internal/db"
	"github.com/mmffdev/vector-backend/internal/devreports"
	"github.com/mmffdev/vector-backend/internal/erd"
	"github.com/mmffdev/vector-backend/internal/errorsreport"
	"github.com/mmffdev/vector-backend/internal/fields"
	"github.com/mmffdev/vector-backend/internal/flows"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/libraryreleases"
	"github.com/mmffdev/vector-backend/internal/mentions"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/notifications"
	"github.com/mmffdev/vector-backend/internal/notifications/broker"
	"github.com/mmffdev/vector-backend/internal/notifications/dispatchers"
	notifresolvers "github.com/mmffdev/vector-backend/internal/notifications/resolvers"
	notifrules "github.com/mmffdev/vector-backend/internal/notifications/rules"
	notifv2pipeline "github.com/mmffdev/vector-backend/internal/notifications/v2/pipeline"
	notifv2relay "github.com/mmffdev/vector-backend/internal/notifications/v2/relay"
	notifv2rules "github.com/mmffdev/vector-backend/internal/notifications/v2/rules"
	notifv2templates "github.com/mmffdev/vector-backend/internal/notifications/v2/templates"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/mmffdev/vector-backend/internal/savedviews"
	"github.com/mmffdev/vector-backend/internal/nav"
	"github.com/mmffdev/vector-backend/internal/pageaccess"
	"github.com/mmffdev/vector-backend/internal/sentinel"
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
	"github.com/mmffdev/vector-backend/internal/lookups"
	"github.com/mmffdev/vector-backend/internal/timeboxmilestones"
	"github.com/mmffdev/vector-backend/internal/timeboxreleases"
	"github.com/mmffdev/vector-backend/internal/timeboxsprints"
	"github.com/mmffdev/vector-backend/internal/webhooks"
	"github.com/mmffdev/vector-backend/internal/artefactitems"
	"github.com/mmffdev/vector-backend/internal/artefactpriorities"
	"github.com/mmffdev/vector-backend/internal/costcentres"
	"github.com/mmffdev/vector-backend/internal/artefacttypes"
	"github.com/mmffdev/vector-backend/internal/flowboard"
	"github.com/mmffdev/vector-backend/internal/transport"
	"github.com/mmffdev/vector-backend/internal/workspaces"
	"github.com/mmffdev/vector-backend/internal/workspaceresolver"
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

	// Pillar 3 step 3 (refactorDB, 2026-05-26): mmff_vector is retired.
	// The legacy `pool` opened above from $DB_NAME now points at
	// vector_artefacts — same DB as vaPool. Option A: both pools survive
	// (~2 extra connections, smallest possible diff). Collapsing to a
	// single pool is a TD follow-up, NOT this wave.
	//
	// Pillar 3 step 1 history: vector_artefacts is the canonical home
	// for every former mmff_vector table (users, sessions, pages, nav_*,
	// roles, permissions, workspaces, master_record_workspaces,
	// subscriptions, audit_logs, cost_centres, csp_reports, etc.).
	//
	// VECTOR_ARTEFACTS_DB_URL is optional — when unset (legacy /
	// pre-cutover envs), vaPool is nil and we fall back to the legacy
	// `pool` for the services that historically read mmff_vector. v2
	// artefact-items + topology + sprints/releases continue to
	// stub-degrade in that mode (pre-existing behaviour).
	var vaPool *pgxpool.Pool
	if vaURL := os.Getenv("VECTOR_ARTEFACTS_DB_URL"); vaURL != "" {
		vaCfg, vaErr := pgxpool.ParseConfig(vaURL)
		if vaErr != nil {
			logger.Warn("vector_artefacts pool config error — falling back to legacy DB_NAME pool", "err", vaErr)
		} else {
			vaCfg.MinConns = 2
			vaCfg.MaxConnIdleTime = 5 * time.Minute
			p, vaErr := pgxpool.NewWithConfig(ctx, vaCfg)
			if vaErr != nil {
				logger.Warn("vector_artefacts pool connect failed — falling back to legacy DB_NAME pool", "err", vaErr)
			} else if vaErr = p.Ping(ctx); vaErr != nil {
				logger.Warn("vector_artefacts pool ping failed — falling back to legacy DB_NAME pool", "err", vaErr)
				p.Close()
			} else {
				vaPool = p
				defer vaPool.Close()
				maskedURL := vaURL
				if i := strings.Index(vaURL, "@"); i > 0 {
					if j := strings.LastIndex(vaURL[:i], ":"); j > 0 {
						maskedURL = vaURL[:j+1] + "***" + vaURL[i:]
					}
				}
				logger.Info("vector_artefacts pool connected", "url", maskedURL)
				bootstatus.Set("vector_artefacts_db", true, "")
			}
		}
	} else {
		logger.Warn("VECTOR_ARTEFACTS_DB_URL unset — services will fall back to legacy DB_NAME pool")
	}

	// servicePool is the pool every "moved-table" service takes after
	// Pillar 3 step 1. It is vaPool when available; otherwise we fall
	// back to `pool` so pre-cutover envs still boot. Refer to
	// docs/c_c_db_routing.md for the post-cutover wiring.
	servicePool := pool
	if vaPool != nil {
		servicePool = vaPool
	}

	// PLA-0007: parity check between the Go catalogue and the DB. Drift
	// (or a missing `permissions` table when migrations are behind on the
	// active env) is loud-but-not-fatal: the resolver already denies on
	// any DB error, so RBAC-gated routes fail-safe (403). We log loudly
	// so the operator sees it, but the server still boots — otherwise
	// switching env to one that lacks migration 088 makes the backend
	// unstartable, which is the worst possible failure mode for a launcher.
	if err := permissions.VerifyParity(ctx, servicePool); err != nil {
		logger.Warn("permissions parity FAILED — RBAC-gated routes will deny by default until fixed", "err", err)
		bootstatus.Set("permissions_parity", false, err.Error())
	} else {
		bootstatus.Set("permissions_parity", true, "")
	}

	// PLA-0007: process-local resolver caching effective permission set
	// per user. 60s TTL keeps cross-process drift bounded; explicit
	// Invalidate hooks fire from roles/users mutations within this process.
	// Consumed by auth.RequirePermission middleware on every route below.
	permResolver := permissions.NewResolver(servicePool, 60*time.Second)

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

	// audit_log lives in vector_artefacts post-Pillar-3 step 1
	// (mmff_vector → VA consolidation, refactorDB). Constructed against
	// servicePool which is vaPool when available; SetPool below also
	// pins vaPool explicitly for back-compat with the early-bound
	// reference pattern. If VECTOR_ARTEFACTS_DB_URL is unset (legacy
	// path), writes continue against the mmff_vector pool fallback.
	auditLog := audit.New(servicePool)
	// B16.8 P5 — audit-event alerting. NewWebhook reads
	// AUDIT_ALERT_{WEBHOOK_URL,ACTIONS,SECRET}; returns a disabled
	// Webhook (no-op) unless both URL and allowlist are set. Wired
	// before any service starts firing audit rows so the alerter is
	// live from the first request.
	alertWebhook := alerting.NewWebhook()
	auditLog.SetAlerter(alertWebhook)
	log.Printf("audit-alerting: %s", alertWebhook.String())
	mailer := email.NewFromEnv()

	authSvc := auth.NewService(servicePool, auditLog, mailer)
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

	apiKeysSvc := apikeys.New(servicePool)
	apiKeysH := apikeys.NewHandler(apiKeysSvc, auditLog)

	// Seed dev API key for local testing (story 00443).
	// Only in development; logs the key once for curl testing.
	if err := apikeys.SeedDevKey(ctx, servicePool, appEnv, os.Getenv("DEV_API_KEY")); err != nil {
		log.Fatalf("seed dev api key: %v", err)
	}

	usersSvc := users.New(servicePool, auditLog, mailer)
	usersH := users.NewHandler(usersSvc, permResolver)

	// TD-SEC-CSP-NONCES-SRI Phase 2 — browser-side CSP violation reporting.
	// Mounted unauthenticated below; service writes to csp_reports in
	// vector_artefacts (post-Pillar-3 step 1). Per-IP rate limit is the
	// only DoS protection.
	cspReportH := cspreport.NewHandler(cspreport.NewService(servicePool))

	// Roles HTTP surface (PLA-0007 G3). Service is sole writer for
	// roles + role_permissions; the handler is a thin translation layer.
	rolesSvc := roles.New(servicePool, auditLog)
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
	navRegistry := nav.NewCachedRegistry(servicePool, 60*time.Second)
	if _, err := navRegistry.Load(ctx); err != nil {
		logger.Warn("nav registry initial load failed — will retry on first request", "err", err)
		bootstatus.Set("nav_registry", false, err.Error())
	} else {
		bootstatus.Set("nav_registry", true, "")
	}
	navSvc := nav.New(servicePool, navRegistry)
	navPageBookmarks := nav.NewPageBookmarks(servicePool, navRegistry, navSvc)
	customPagesSvc := custompages.New(servicePool)
	customPagesH := custompages.NewHandler(customPagesSvc)

	// Universal addressables registry (PLA-0005). Service is the SOLE
	// writer for page_addressables / page_help. Handler fronts four
	// endpoints — see backend/internal/addressables/handler.go for the
	// auth contract (CI token gate on /build-reconcile, prod gate on
	// /register).
	addressablesSvc := addressables.New(servicePool, appEnv == "production")
	addressablesH := addressables.NewHandler(
		addressablesSvc,
		os.Getenv("CI_SERVICE_TOKEN"),
		os.Getenv("CUSTOM_APP_TOKEN"),
	)
	navH := nav.NewHandler(navSvc, navPageBookmarks, customPagesSvc)
	navGrantsAdminH := nav.NewGrantsAdminHandler(servicePool, navRegistry, rolesSvc, auditLog)

	// PLA-0049 Phase 0.5: page-access resolver + handler. The resolver
	// caches the global pages_access_version (1s in-process) and a
	// per-user key_enum access set (re-fetched on version mismatch).
	// auth.RequirePageAccess(keyEnum) middleware reads from this same
	// instance so the cache is shared across all gated routes.
	pageAccessResolver := pageaccess.New(servicePool, 1*time.Second)
	pageAccessH := pageaccess.NewHandler(pageAccessResolver, func(ctx context.Context) (uuid.UUID, bool) {
		u := auth.UserFromCtx(ctx)
		if u == nil {
			return uuid.Nil, false
		}
		return u.ID, true
	})

	// Per-user, per-page tab ordering for SecondaryNavigation reorder mode (PLA-0014).
	// Sole writer for users_tab_order; mounted at /api/user/tab-order below.
	userTabOrderSvc := usertaborder.New(servicePool)
	userTabOrderH := usertaborder.NewHandler(userTabOrderSvc)

	// PLA-0039 / Story 00530: portfoliomodels.Service hosts all DB I/O
	// for the package. vaPool is wired further down — pmSvc is rebound
	// after the vaPool block so workspace-layers reads see the live pool.
	// The middle pool ("vectorPool" historically) reads subscriptions /
	// users / master_record_workspaces — all in vector_artefacts post
	// Pillar 3 step 1, so it takes servicePool now.
	portfolioModelsSvc := portfoliomodels.NewService(libPools.RO, servicePool, nil)
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
	var portfolioResyncH *portfoliomodels.ResyncHandler
	// devResetH is constructed after the vaPool block so MasterReset can
	// target vector_artefacts. See below.
	var devResetH *portfoliomodels.DevResetHandler
	// Library release-notification channel (Phase 3 of mmff_library plan, §12).
	// Reconciler maintains a per-subscription badge-count cache; ticker
	// floor is 15m by default (LIBRARY_RECONCILER_INTERVAL to override).
	// On-login hook warms the cache so the first badge poll after sign-in
	// returns instantly. Cache is invalidated on every successful ack.
	//
	// library_acknowledgements + subscriptions both live in
	// vector_artefacts post Pillar 3 step 1. Reconciler + Service take
	// servicePool (which is vaPool when configured) for the vectorPool
	// slot; SetAcksPool below still pins vaPool explicitly for back-
	// compat with the early-bound pattern.
	libReleasesRec := libraryreleases.NewReconciler(libPools.RO, servicePool)
	libReleasesRec.Start(ctx)
	defer libReleasesRec.Stop()
	libReleasesSvc := libraryreleases.NewService(libPools.RO, servicePool, servicePool)
	libReleasesH := libraryreleases.NewHandler(libReleasesSvc, auditLog, libReleasesRec)

	// Realtime hub + Postgres LISTEN bridge. The hub is in-memory; the
	// bridge runs LISTEN rank_changed on a dedicated connection and
	// fans NOTIFY payloads (emitted by the notify_rank_changed trigger
	// on the artefacts table — vector_artefacts) to subscribed clients.
	// The session sweeper polls users_sessions, also in vector_artefacts
	// after Pillar 3 step 1.
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
	realtime.StartRankListener(context.Background(), servicePool, rtHub)
	realtime.StartSessionSweeper(context.Background(), servicePool, rtRegistry)

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
	workspacesSvc := workspaces.New(servicePool, auditLog, permResolver)
	workspacesH := workspaces.NewHandler(workspacesSvc)

	// vector_artefacts pool — initialised at the top of main so every
	// "moved-table" service can take it via servicePool. The remaining
	// vaPool-only wiring (v2 artefact-items handlers, webhook service,
	// audit/libreleases pool swap, workspaces VA guard) happens below.
	// vaPool is nil only when VECTOR_ARTEFACTS_DB_URL is unset (legacy);
	// in that case v2 routes return stub handlers — pre-cutover behaviour.
	//
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
	// v2RuleHookAttach — same late-binding dance as v2ScopeAttach,
	// for the notification-rules engine. Wired after the rules
	// engine + notifier are constructed further down. Nil when v2
	// is stubbed or when the rules engine isn't initialised.
	var v2RuleHookAttach func(notifrules.RuleHook)
	if vaPool != nil {
		// audit_log + library_acknowledgements moved to vaPool 2026-05-13
		// (PLA-0023 P1). Swap the early-bound pool on the audit Logger,
		// the libreleases reconciler, and the libreleases service so
		// downstream callers that captured these references write into
		// vector_artefacts. libRO stays on mmff_library.
		auditLog.SetPool(vaPool)
		libReleasesRec.SetAcksPool(vaPool)
		libReleasesSvc.SetAcksPool(vaPool)
		webhookSvc = webhooks.New(vaPool)
		notifier := webhooks.NewNotifier(webhookSvc)
		wiSvc := artefactitems.NewService(vaPool, servicePool, "work")
		wiSvc.WithNotifier(notifier)
		workItemsV2H = artefactitems.NewHandler(wiSvc)
		piSvc := artefactitems.NewService(vaPool, servicePool, "strategy")
		piSvc.WithNotifier(notifier)
		portfolioItemsV2H = artefactitems.NewHandler(piSvc)
		// PLA-0043 — defer wiring orgDesignSvc until after it is
		// constructed below; assign back through closures so the
		// scope clamp is available on both v2 services.
		v2ScopeAttach = func(t artefactitems.TopologyScopeResolver) {
			wiSvc.WithTopologyResolver(t)
			piSvc.WithTopologyResolver(t)
		}
		// Same late-binding pattern for the notification-rules hook
		// (see the v2RuleHookAttach declaration above).
		v2RuleHookAttach = func(h notifrules.RuleHook) {
			wiSvc.WithRuleHook(h)
			piSvc.WithRuleHook(h)
		}
		// PLA-0026 / story 00502 (B13): attach the VA pool to the
		// workspaces service so DELETE /api/workspaces/{id} can
		// scan vector_artefacts for orphan rows BEFORE deletion.
		// Without this attach, workspacesSvc.CheckCrossDBOrphans
		// is a documented no-op (guard disabled).
		workspacesSvc.WithVAPool(vaPool)
	} else {
		workItemsV2H = artefactitems.NewHandler(artefactitems.NewService(nil, nil, "work"))
		portfolioItemsV2H = artefactitems.NewHandler(artefactitems.NewService(nil, nil, "strategy"))
	}
	// Cross-pool workspace re-derivation for auth.Refresh — without this
	// the JWT drops its workspace_id claim on every refresh and the
	// sentinel fallback silently reverts the user to the tenant's
	// earliest-granted workspace.
	//
	// Pillar 3 step 1: both topology_nodes (VA-owned) AND
	// users_roles_workspaces (moved from mmff_vector → VA) now live in
	// vector_artefacts. We still pass two pool arguments because the
	// PoolResolver carries both pools explicitly today (will collapse
	// to one in Pillar 3 step 3 when mmff_vector is dropped); both
	// slots take vaPool now.
	if vaPool != nil {
		authSvc.WorkspaceResolver = workspaceresolver.NewPoolResolver(vaPool, vaPool)
	}

	// mmff_dev pool — holds dev_reports (research/plan/security/retro/code/api).
	// Optional: when MMFF_DEV_DB_URL is unset the service degrades to empty
	// lists / not-found, so /dev/reporting stays reachable without errors.
	// Same pattern as the vaPool block above.
	var devPool *pgxpool.Pool
	devReportsH := devreports.NewHandler(devreports.NewService(nil))
	if devURL := os.Getenv("MMFF_DEV_DB_URL"); devURL != "" {
		devCfg, devErr := pgxpool.ParseConfig(devURL)
		if devErr != nil {
			logger.Warn("mmff_dev pool config error — /dev/reporting will return empty", "err", devErr)
		} else {
			devCfg.MinConns = 1
			devCfg.MaxConnIdleTime = 5 * time.Minute
			p, devErr := pgxpool.NewWithConfig(ctx, devCfg)
			if devErr != nil {
				logger.Warn("mmff_dev pool connect failed — /dev/reporting will return empty", "err", devErr)
			} else if devErr = p.Ping(ctx); devErr != nil {
				logger.Warn("mmff_dev pool ping failed — /dev/reporting will return empty", "err", devErr)
				p.Close()
			} else {
				devPool = p
				defer devPool.Close()
				maskedURL := devURL
				if i := strings.Index(devURL, "@"); i > 0 {
					if j := strings.LastIndex(devURL[:i], ":"); j > 0 {
						maskedURL = devURL[:j+1] + "***" + devURL[i:]
					}
				}
				logger.Info("mmff_dev pool connected", "url", maskedURL)
				devReportsH = devreports.NewHandler(devreports.NewService(devPool))
				bootstatus.Set("mmff_dev_db", true, "")
			}
		}
	} else {
		logger.Warn("MMFF_DEV_DB_URL unset — /dev/reporting will return empty")
	}

	// Topology service (PLA-0006 / M6.2.7). Every topology read/write
	// goes through vector_artefacts. After Pillar 3 step 1 the legacy
	// "pool" slot (used historically for membership/auth lookups +
	// subscriptions.topology_committed_* checkpoints) also points at
	// vector_artefacts — subscriptions moved with the rest of the 37
	// tables — so we pass servicePool for both arguments.
	//
	// vaPool may be nil (no VECTOR_ARTEFACTS_DB_URL): the handler is
	// still wired so the routes return 5xx-with-context rather than
	// 404, but every topology read/write will fail at the first SQL
	// call until vaPool is provisioned. WithNotifier wires the
	// realtime hub so a fresh role grant publishes a per-user
	// "topology-handoff" event (story 00283).
	orgDesignSvc = topology.New(servicePool, vaPool).WithNotifier(topology.HubNotifier{Hub: rtHub})
	orgDesignH = topology.NewHandler(orgDesignSvc).WithAudit(auditLog)

	// Wire topology seeder so every new workspace gets a root topology node.
	workspacesSvc.WithTopologySeeder(orgDesignSvc)

	// FlowBoard (FB1.2.1 / spec: docs/superpowers/specs/2026-05-27-flowboard-design.md).
	// Owns topology_nodes_members, topology_nodes_wip_limits, and
	// users_flowboard_prefs — all three live in vector_artefacts, so the
	// service takes vaPool. Endpoints return 501 until FB1.2.2/2.3/2.4
	// fill them in; the router stub is wired now so main.go compile stays
	// green throughout the implementing stories.
	flowboardSvc := flowboard.NewService(vaPool)
	flowboardH := flowboard.NewHandler(flowboardSvc)

	// PLA-0043 — attach the topology resolver to the v2 work/portfolio
	// services so ?scope=<id> on /work-items can resolve to "this node
	// + every descendant" and emit 403 when the caller has no grant.
	// v2ScopeAttach is nil when vaPool is unset (stub handlers) — scope
	// reads then fall through to ErrInvalidInput inside the service.
	//
	// Wrapped in topologyScopeAdapter so topology.ErrNodeNotFound is
	// translated to artefactitems.ErrScopeNodeNotFound at the seam —
	// the service then uses errors.Is, no string-match sniffing.
	if v2ScopeAttach != nil {
		v2ScopeAttach(topologyScopeAdapter{inner: orgDesignSvc})
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
		// handler can be DB-free. WithVectorPool historically wired
		// mmff_vector for the read authz path (CanReadMasterRecord);
		// post Pillar 3 step 1 that data lives in vaPool too.
		masterRecordSvc = portfolio.NewService(vaPool).WithVectorPool(servicePool)
	}
	portfolioAdoptH = portfoliomodels.NewAdoptHandler(libPools.RO, servicePool, vaPool, masterRecordSvc)
	portfolioAdoptStreamH = portfoliomodels.NewAdoptStreamHandler(portfolioAdoptH.Orchestrator)
	portfolioResyncH = portfoliomodels.NewResyncHandler(libPools.RO, servicePool, vaPool)

	// PLA-0026 / Story 00501 (B12): adoption-state reads from the new
	// substrate (master_record_portfolios + artefacts_types) via vaPool.
	// The "vectorPool" slot resolved subscription_id → workspace_id;
	// post Pillar 3 step 1 that data lives in vaPool too. vaPool may
	// be nil (handler returns notStarted).
	portfolioAdoptionStateH = portfoliomodels.NewAdoptionStateHandler(servicePool, vaPool)

	// Dev reset handler — constructed here (after vaPool) so MasterReset
	// can target both pools. After Pillar 3 step 1 the legacy mmff_vector
	// reset path is a no-op against an empty zombie DB, but we still
	// pass servicePool to keep the existing wiring shape intact until
	// Pillar 3 step 3 collapses to a single pool argument.
	devResetH = portfoliomodels.NewDevResetHandler(servicePool, vaPool, orgDesignSvc)

	// /dev/erd — live + snapshot ERD page (PLA-ERD).
	// vaPool = vector_artefacts (vaPool), libPools.RO = mmff_library.
	// Group taxonomy: dev/audits/erd_groups.yaml (separate from system_areas.yaml
	// which the codegraph audit uses for code-path tagging — different schema).
	erdSvc := erd.NewService(vaPool, libPools.RO, "dev/audits/erd_groups.yaml")
	erdH := erd.NewHandler(erdSvc, "dev/audits")

	// Tenant settings (master_record_workspaces — renamed from
	// master_record_tenants by migration 067 on 2026-05-15). Reads /
	// writes vector_artefacts via servicePool (vaPool when available;
	// mmff_vector fallback only for pre-cutover envs).
	workspaceSettingsSvc := workspacemasterrecord.New(servicePool)
	workspaceSettingsH := workspacemasterrecord.NewHandler(workspaceSettingsSvc)

	// Tenant settings (master_record_tenants in vector_artefacts —
	// subscription-keyed, PLA-0050). Same servicePool wiring.
	tenantSettingsSvc := tenantmasterrecord.New(servicePool)
	tenantSettingsH := tenantmasterrecord.NewHandler(tenantSettingsSvc)

	// PLA-0051 Story 3.5 — wire tenant→workspace inheritance read-path.
	// SubscriptionResolver and ActiveWorkspaceResolver historically read
	// the fdw_workspaces foreign table in vector_artefacts; after
	// Pillar 3 step 1 the source data (master_record_workspaces) lives
	// natively in vector_artefacts, so the resolvers query the local
	// table directly. Both run against servicePool (vaPool when up).
	// TenantDefaultsReader reads master_record_tenants with pointer
	// types so NULLs survive the scan (the merge in
	// workspacemasterrecord.Service uses NULL to mean "fall through to
	// schema default").
	if vaPool != nil {
		workspaceSettingsSvc.WithInheritance(
			workspacemasterrecord.NewFDWSubscriptionResolver(servicePool),
			workspacemasterrecord.NewPGTenantDefaultsReader(servicePool),
		)
		// TD-WS-001 pay-down — handler resolves the active workspace_id
		// from the caller's subscription via the ActiveWorkspaceResolver.
		// No URL params, no client involvement. The user never sees a
		// workspace UUID.
		// See: .claude/memory/project_workspace_scope_invisible.md
		workspaceSettingsH.WithResolver(
			workspacemasterrecord.NewFDWActiveWorkspaceResolver(servicePool),
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
	// The "vectorPool" slot historically resolved membership / tenancy;
	// post Pillar 3 step 1 those lookups land in vector_artefacts too.
	// vaPool may be nil — in that case the handler returns an empty
	// fields slice after the auth gate succeeds (mirrors v2 work-items).
	fieldsSvc := fields.NewService(servicePool, vaPool)
	fieldsH := fields.NewHandler(fieldsSvc)

	// savedviews — Rally-style saved view configurations. Sole writer for
	// saved_views table in vector_artefacts. See
	// docs/superpowers/specs/2026-05-28-saved-views-design.md.
	savedViewsStore := savedviews.NewPostgresViewStore(vaPool)
	savedViewsSvc := savedviews.NewService(
		savedViewsStore,
		&savedViewsWSAdminAdapter{resolver: permResolver},
		func(ctx context.Context, actor uuid.UUID, action string, viewID uuid.UUID, detail map[string]any) {
			resource := "saved_views"
			resID := viewID.String()
			actorID := actor
			auditLog.Log(ctx, audit.Entry{
				UserID:     &actorID,
				Action:     action,
				Resource:   &resource,
				ResourceID: &resID,
				Metadata:   detail,
			})
		},
	)
	savedViewsHandler := savedviews.NewHandler(
		savedViewsSvc,
		// Node-membership resolver — inlined SQL probe against
		// topology_nodes_members. Lives here (not in topology service)
		// because it's a tiny query specific to the savedviews list endpoint.
		func(ctx interface{ Done() <-chan struct{} }, userID uuid.UUID) ([]uuid.UUID, error) {
			realCtx, _ := ctx.(context.Context)
			if realCtx == nil {
				realCtx = context.Background()
			}
			rows, err := vaPool.Query(realCtx, `SELECT topology_nodes_members_node_id FROM topology_nodes_members WHERE topology_nodes_members_user_id = $1`, userID)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			var out []uuid.UUID
			for rows.Next() {
				var id uuid.UUID
				if err := rows.Scan(&id); err != nil {
					return nil, err
				}
				out = append(out, id)
			}
			return out, rows.Err()
		},
	)

	// PLA-0026 / Story 00499 (B10): workspace-scoped successor to the
	// legacy GET /api/subscription/layers. Reads strategy artefacts_types
	// from vector_artefacts; legacy handler stays live until F3 (per
	// R047 §9). vaPool may be nil — handler returns 503 in that case.
	// PLA-0039 / Story 00530: pmSvc was constructed up-top with vaPool=nil
	// (before VA boot). Now that vaPool is known, attach it so workspace-
	// layers reads see the live pool.
	portfolioModelsSvc.WithVAPool(vaPool)
	workspaceLayersH := portfoliomodels.NewWorkspaceLayersHandler(portfolioModelsSvc)

	// ===== Notifications system (B11.4) =====
	// AMQP_URL empty → NoopBroker, and producers get a NoopNotifier so the
	// rest of the backend boots without RMQ. AMQP_URL set → dial RabbitMQ;
	// dial failure also falls back to noop with a warning, so a broker
	// outage doesn't take the whole API down.
	notifLogger := slog.Default()
	notifPrefs := notifications.NewPrefs(servicePool)
	notifTemplates := notifications.NewTemplates()
	notifications.RegisterMentionDefault(notifTemplates)
	notifications.RegisterArtefactDefault(notifTemplates)

	var notifBroker broker.Broker
	var notifier notifications.Notifier
	if amqpURL := os.Getenv("AMQP_URL"); amqpURL != "" {
		rb, err := broker.New(ctx, amqpURL, notifLogger)
		if err != nil {
			notifLogger.Warn("notifications: rabbit dial failed, falling back to noop broker",
				"err", err)
			notifBroker = broker.NewNoop(notifLogger)
			notifier = notifications.NewNoop(notifLogger)
		} else {
			notifBroker = rb
			notifier = notifications.NewDBNotifier(servicePool)
			// Start the outbox relay (LISTEN/NOTIFY-driven, +30s tick safety net).
			go func() {
				if err := notifications.NewRelay(servicePool, notifBroker, notifLogger).Run(ctx); err != nil && ctx.Err() == nil {
					notifLogger.Error("notifications.relay: exited", "err", err)
				}
			}()
			// Start dispatchers — one goroutine each, bound to *.<channel>.
			go func() {
				if err := dispatchers.NewInApp(servicePool, notifTemplates, notifPrefs, notifLogger).Run(ctx, notifBroker); err != nil && ctx.Err() == nil {
					notifLogger.Error("notifications.inapp: exited", "err", err)
				}
			}()
			go func() {
				if err := dispatchers.NewEmail(servicePool, mailer, notifTemplates, notifPrefs, notifLogger).Run(ctx, notifBroker); err != nil && ctx.Err() == nil {
					notifLogger.Error("notifications.email: exited", "err", err)
				}
			}()
			go func() {
				if err := dispatchers.NewSSE(rtHub, notifPrefs, notifLogger).Run(ctx, notifBroker); err != nil && ctx.Err() == nil {
					notifLogger.Error("notifications.sse: exited", "err", err)
				}
			}()
			notifLogger.Info("notifications: relay + 3 dispatchers running")
		}
	} else {
		notifLogger.Info("notifications: AMQP_URL unset — using NoopNotifier")
		notifBroker = broker.NewNoop(notifLogger)
		notifier = notifications.NewNoop(notifLogger)
	}
	_ = notifBroker // currently no main.go-level shutdown hook; relay goroutines exit on ctx
	notifSvc := notifications.NewService(servicePool, notifPrefs)
	notifH := notifications.NewHandler(notifSvc)
	notifStreamH := notifications.NewStreamHandler(rtHub)
	// Rules engine — CRUD on users_notification_rules + the per-tenant
	// field/operator catalogue endpoint the settings UI consumes.
	// Storage lives on mmff_vector; schema endpoint reads vaPool for
	// artefact_types + their bound fields (which is why both pools land here).
	notifRulesSvc := notifrules.NewService(servicePool)
	notifRulesH := notifrules.NewHandler(notifRulesSvc)
	notifSchemaH := notifrules.NewSchemaHandler(notifrules.NewSchema(vaPool))
	// Evaluator + producer-side hook adapter. The artefactitems
	// service emits ArtefactChangedEvent via WithRuleHook; this
	// adapter loads matching rules and fans each match into the
	// notifications outbox via the existing Notifier. Bridging here
	// (in main.go) avoids any artefactitems↔rules↔notifications
	// import cycle — main is the only place that holds all three.
	notifEvaluator := notifrules.NewEvaluator(servicePool, notifLogger)
	v2RuleHook := newRulesProducerHook(notifEvaluator, notifier, notifLogger)
	if v2RuleHookAttach != nil {
		v2RuleHookAttach(v2RuleHook)
		notifLogger.Info("notifications.rules: producer hook attached to artefactitems v2")
	}

	// ── Notifications v2 pipeline + relay (PLA067 / S06) ─────────────────────
	// Wired only when vaPool is available (vector_artefacts). The pipeline
	// and relay are guarded by NOTIFICATIONS_V2=true for the cutover flip
	// (S15). In dev both run unconditionally when vaPool is set because the
	// tables exist and the feature flag file is not yet wired (S10/S15 job).
	//
	// Strangler-fig HARD RULE: no v1 imports here; v1 relay continues
	// independently above (servicePool path). They co-exist until S15.
	if vaPool != nil && os.Getenv("AMQP_URL") != "" {
		v2TemplatesSvc := notifv2templates.NewService(vaPool)
		v2RulesEvaluator := notifv2rules.NewEvaluator(vaPool)
		v2PendingStore := notifv2pipeline.NewInMemoryPendingStore() // S12 replaces with Valkey impl
		v2Pipeline := notifv2pipeline.NewProcessor(notifv2pipeline.Deps{
			Pool:      vaPool,
			Rules:     v2RulesEvaluator,
			Templates: v2TemplatesSvc,
			Pending:   v2PendingStore,
		})
		_ = v2Pipeline // consumed by v2 relay in S09; held here so it's wired and compiled
		// v2 relay requires the v2 broker (different Consume signature from v1).
		// TD: wire v2 broker here once S04 broker is available on vaPool.
		// For now, construct relay with a nil broker — it will not start.
		// This satisfies the compile-time wiring requirement (Task 12) while
		// keeping S09 as the story that connects broker → relay → processor.
		// v2 relay construction (nil broker = compile-time wiring only for S06).
		notifLogger.Info("notifications/v2: pipeline constructed (PLA067 S06); relay wired in S09")
		_ = notifv2relay.NewRelay // reference to keep import used
	}
	// ─────────────────────────────────────────────────────────────────────────

	// @-mention scaffold — mounted on both transports per PLA-0039.
	// vaPool is optional: when nil, the service falls back to
	// scope='tenant' (master_record_tenants lives in vector_artefacts).
	// Notifier is now DBNotifier (writes outbox in tx) when AMQP_URL is
	// set, falls back to NoopNotifier otherwise.
	mentionsSvc := mentions.NewService(servicePool, vaPool, notifier)
	// Mention context resolvers — turn (kind, UUID) into a
	// "PREFIX-NUM — Title" label. Segregated in
	// notifications/resolvers so the wiring is a single line here;
	// new artefact kinds get @-mention support by adding their slug
	// to defaultArtefactKinds in that package (no main.go edit).
	// Safe to call with vaPool=nil — the resolver returns an error
	// shape that the mentions handler maps to its existing
	// unresolved-context response.
	notifresolvers.RegisterArtefactResolvers(mentionsSvc, vaPool)
	mentionsH := mentions.NewHandler(mentionsSvc)

	// PLA-0027 / Story 00514: timebox sprints REST handler.
	// Uses the same vaPool as v2 work-items; gracefully degrades when nil.
	// Slice 5B (2026-05-21): WithTopology wires the orgDesign service so
	// Service.List can ancestor-walk for heartbeat-propagated reads.
	var sprintH *timeboxsprints.Handler
	if vaPool != nil {
		sprintSvc := timeboxsprints.NewService(vaPool)
		sprintSvc.WithNotifier(webhooks.NewNotifier(webhookSvc))
		sprintSvc.WithTopology(orgDesignSvc)
		sprintH = timeboxsprints.NewHandler(sprintSvc)
	}

	// timebox releases REST handler — mirrors sprints, no adjacency rule.
	// Slice 5B: same WithTopology wiring as sprints for ancestor-walk reads.
	var releaseH *timeboxreleases.Handler
	if vaPool != nil {
		releaseSvc := timeboxreleases.NewService(vaPool)
		releaseSvc.WithTopology(orgDesignSvc)
		releaseH = timeboxreleases.NewHandler(releaseSvc)
	}

	// timebox milestones REST handler — point-in-time markers, no
	// date range / cadence / overlap rule (migration 085).
	var milestoneH *timeboxmilestones.Handler
	if vaPool != nil {
		milestoneH = timeboxmilestones.NewHandler(timeboxmilestones.NewService(vaPool))
	}

	// Lookups handler — slim scope-bound lookup endpoints (users-in-scope
	// etc.) used by inline form pickers. Backed by servicePool
	// (vector_artefacts post Pillar 3 step 1; users lives there now).
	lookupsH := lookups.NewHandler(lookups.NewService(servicePool))

	var flowsH *flows.Handler
	if vaPool != nil {
		flowsH = flows.NewHandler(flows.New(vaPool, servicePool))
	}

	// Generic rank service. Backed by vaPool (vector_artefacts) for
	// work items — the rank service writes position directly to artefacts.
	// Falls back gracefully to a no-op handler when vaPool is nil.
	var rankH *ranking.Handler
	if vaPool != nil {
		ranking.Register("work_item", ranking.ResourceConfig{
			Table:                "artefacts",
			ScopeColumn:          "artefacts_id_timebox_sprint",
			IDColumn:             "artefacts_id",
			PositionColumn:       "artefacts_position",
			SubscriptionIDColumn: "artefacts_id_subscription",
			UpdatedAtColumn:      "artefacts_updated_at",
			ArchivedAtColumn:     "artefacts_archived_at",
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

	// B20.4.3 — cost_centres moved to vector_artefacts in Pillar 3 step 1
	// (subscription-scoped finance reference data; FK target of
	// users.cost_centre_id, which also lives in vector_artefacts now).
	// Writes gated by cost_centres.manage; reads available to any
	// authenticated tenant member (server-side SubscriptionID clamp
	// ensures no cross-tenant leak).
	costCentresH := costcentres.NewHandler(costcentres.NewService(servicePool), permResolver)

	// PLA062 S05.4: Sentinel is the sole request-level clamp surface.
	// Replaces the prior topology.PoolWorkspaceLookup + per-route
	// WorkspaceClampMiddleware mounts that were hoisted in PLA-0053 /
	// story 00578. PoolResolver carries two pool arguments (historically
	// VA for topology_nodes + mmff_vector for workspaces/roles_workspaces/
	// users); post Pillar 3 step 1 every one of those tables lives in
	// vector_artefacts, so both slots take servicePool. sentinelMW is
	// the one middleware mounted in front of every route group that
	// needs the JWT-anchored workspace clamp.
	//
	// The legacy-token fallback (FirstLiveWorkspace), the forgery /
	// role-revocation guard (HasActiveRole), and the per-grant subtree
	// clamp all live inside sentinel.Middleware now — no caller need
	// know about workspaces vs topology_nodes vs roles_workspaces.
	// Cache (Valkey) — backend's read-side cache layer. First consumer:
	// sentinel.PoolResolver wraps ResolveSubtree's recursive topology
	// CTE behind this client. PING failure is non-fatal: every cache op
	// returns ErrCacheUnavailable and callers fall back to source-of-
	// truth queries. The breaker re-closes on the next successful op.
	//
	// Env: VALKEY_HOST + VALKEY_PORT + VALKEY_PASSWORD (set in
	// backend/.env.dev; see infra/swarm/vector-dev-stack.yml for the
	// Valkey service). Reuse-target for notifications-v2 PendingStore
	// (S12 of PLA067) per TD-SEC-REDIS-DEPENDENCY.
	cacheClient, cacheErr := cache.New(context.Background(), cache.Config{
		Addr:     os.Getenv("VALKEY_HOST") + ":" + os.Getenv("VALKEY_PORT"),
		Password: os.Getenv("VALKEY_PASSWORD"),
	})
	if cacheErr != nil {
		log.Printf("cache: startup PING failed — cache disabled, callers fall back to SQL: %v", cacheErr)
	} else {
		log.Printf("cache: connected to Valkey at %s:%s", os.Getenv("VALKEY_HOST"), os.Getenv("VALKEY_PORT"))
	}

	sentinelResolver := sentinel.NewPoolResolver(servicePool, servicePool)
	sentinelResolver.SetCache(cacheClient)
	sentinelMW := sentinel.Middleware(sentinelResolver)

	// Cycle 3 (2026-05-28) — cache the two /sentinel/boot sub-reads
	// behind Valkey. LoadRoleAndPermissions (3 sequential queries) and
	// ListMyGrants (1 query) dominate the warm boot cost per cycle 2's
	// measurement. SetCache wires the read+write path; invalidation
	// lives in the writer services and (for topology-shaped changes) in
	// the existing subtreeCacheInvalidator adapter below, extended to
	// wipe the two new namespaces alongside the sentinel-tier ones.
	authSvc.SetCache(cacheClient)
	if orgDesignSvc != nil {
		orgDesignSvc.SetMyGrantsCache(cacheClient)
	}

	// Wire the cache invalidator into the topology service so any
	// structure-changing write (CreateNode/MoveNode/ArchiveNode/
	// RestoreNode/DuplicateSubtree/ArchiveWorkspaceTopology/
	// RestoreWorkspaceTopology/GrantRole/RevokeRole) wipes Sentinel's
	// per-tenant subtree cache AND the topology:mygrants cache. The
	// adapter is a thin shim over cache.Client.DelPattern so topology
	// doesn't import sentinel or cache directly. orgDesignSvc was
	// constructed earlier (line ~574); we attach the invalidator now
	// that cacheClient exists. Safe to call after construction —
	// builder semantics.
	if orgDesignSvc != nil {
		orgDesignSvc.WithSubtreeCacheInvalidator(&subtreeCacheInvalidator{c: cacheClient})
	}

	// permCacheInvalidator wipes auth:roleperms:* on role/permission
	// writes. Wired into roles.Service (AssignPermissions, RevokePermissions,
	// Archive) and users.Service (Update when role changes). Same narrow
	// adapter pattern as subtreeCacheInvalidator — keeps roles/users free
	// of cache/sentinel imports.
	permInv := &permCacheInvalidator{c: cacheClient}
	rolesSvc.WithPermCacheInvalidator(permInv)
	usersSvc.WithPermCacheInvalidator(permInv)

	// B7.2: search query handler — fulltext via tsvector (plainto_tsquery).
	// Only available when vaPool is up (vector_artefacts has the search columns).
	var searchH *search.Handler
	if vaPool != nil {
		searchH = search.NewHandler(search.New(vaPool))
	}

	// Generic error reporter: any authenticated role can POST a
	// {code, context} pair; we validate the code against the cross-DB
	// mmff_library.error_codes catalogue and append-only insert into
	// vector_artefacts.error_events. Post Pillar 3 step 1 the writes
	// always land on servicePool (vaPool when available).
	errorsReportH := errorsreport.NewHandler(errorsreport.NewService(libPools.RO, servicePool))

	// subscriptions moved to vector_artefacts in Pillar 3 step 1 — the
	// on-login tier lookup queries servicePool.
	authSvc.OnLogin = append(authSvc.OnLogin, func(ctx context.Context, u *roletypes.User) {
		var tier string
		if err := servicePool.QueryRow(ctx,
			`SELECT subscriptions_tier FROM subscriptions WHERE subscriptions_id = $1`, u.SubscriptionID,
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

		// Migration 244 — Pinned (FALSE, default) vs Follow (TRUE) mode
		// for the Home Location dropdown on /user/account-settings.
		// Write-only here; read side flows through /auth/me as
		// userPayload.HomeLocationFollowMode.
		r.Put("/home-location-follow-mode", usersH.SetHomeLocationFollowMode)

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

	// /sentinel — per-user Sentinel preference writes (mutation surface
	// for the substrate Middleware reads on every request). PUT /focus
	// persists users.default_focus_node_id; the read side has shipped
	// since S06 via Resolver.DefaultFocus and the /auth/me boot payload.
	// Mounted with sentinelMW so the handler has the clamp on ctx for
	// future tightening (e.g. scoping writes to the actor's current
	// workspace) and so any future scope_up/down preference writes
	// inherit the same gate.
	// /sentinel/boot composes user + grants + tenant_root into the
	// single payload SentinelProvider needs on mount. Without this
	// mount the frontend bridged via /auth/me + /topology/grants/me,
	// paying a wasted 404 probe on every page load. Injecting the
	// two service calls via closure keeps the sentinel package free
	// of auth/topology imports (avoids cycles).
	sentinelLoadRolePerms := func(ctx context.Context, userID uuid.UUID) (string, uuid.UUID, []string) {
		rp, perms := authSvc.LoadRoleAndPermissions(ctx, userID)
		return rp.Code, rp.ID, perms
	}
	sentinelListGrants := func(ctx context.Context, subID, userID, actorRoleID uuid.UUID) ([]sentinel.BootGrant, error) {
		rows, err := orgDesignSvc.ListMyGrants(ctx, subID, userID, actorRoleID)
		if err != nil {
			return nil, err
		}
		// Field-for-field copy — identical JSON tags. Role + GrantedAt
		// come through as the topology types (Role enum, time.Time) and
		// land in BootGrant's `any` slots, where encoding/json writes
		// them with the same shape the chrome scope-rail consumes
		// today via /topology/grants/me.
		out := make([]sentinel.BootGrant, len(rows))
		for i, g := range rows {
			out[i] = sentinel.BootGrant{
				GrantID:       g.GrantID,
				NodeID:        g.NodeID,
				WorkspaceID:   g.WorkspaceID,
				ParentID:      g.ParentID,
				Name:          g.Name,
				LabelOverride: g.LabelOverride,
				Colour:        g.Colour,
				Icon:          g.Icon,
				Role:          g.Role,
				GrantedAt:     g.GrantedAt,
				Position:      g.Position,
			}
		}
		return out, nil
	}
	sentinelH := sentinel.NewHandler(sentinelResolver).
		WithBootDeps(sentinelLoadRolePerms, sentinelListGrants)
	r.Route("/sentinel", func(r chi.Router) {
		// NB: NotFound MUST be registered BEFORE the .With(...) chain
		// because chi runs the group's middleware stack on prefix-match
		// alone — so any sub-route NOT explicitly mounted below would
		// otherwise hit RequireAuth and 401 instead of 404. This was
		// originally a workaround for the (then-unmounted) /boot probe;
		// /boot is mounted as a real GET below, so the NotFound now
		// only catches truly unknown sub-paths (defence-in-depth so a
		// future probe doesn't accidentally trigger the 401 hook).
		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "not found", http.StatusNotFound)
		})
		r.With(
			authSvc.RequireAuth,
			authSvc.RequireFreshPassword,
			httprate.LimitByIP(120, time.Minute),
			sentinelMW,
		).Get("/boot", sentinelH.Boot)
		r.With(
			authSvc.RequireAuth,
			authSvc.RequireFreshPassword,
			httprate.LimitByIP(60, time.Minute),
			userWriteLimiter,
			sentinelMW,
		).Put("/focus", sentinelH.PutFocus)
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
		// Entity bookmarks (/bookmark, /bookmark/check) deleted with
		// TD-CUT1.1.1-BOOKMARK-SURFACE — see backend/internal/nav/bookmarks.go.
		// Page bookmarks survive.
		r.Post("/page-bookmark", navH.PinPageBookmark)
		r.Delete("/page-bookmark", navH.UnpinPageBookmark)

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
	// register-bulk: perf cycle 6 — collapses N parallel /register POSTs
	// on page mount (one per <Panel>/<Table>/<ResourceTree>) into one
	// HTTP roundtrip. Same auth/source/production rules as /register.
	r.Post("/addressables/register-bulk", addressablesH.RegisterBulk)
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
				r.Get("/dev/artefacts-count", devResetH.ArtefactsCount)
				r.Post("/dev/artefacts-wipe", devResetH.ArtefactsWipe)
				r.Get("/dev/api-audit", devResetH.ApiAudit)
				r.Get("/dev/erd", erdH.Get)
				r.Post("/dev/erd", erdH.Snapshot)
				r.Get("/dev/codegraph", devResetH.Codegraph)
				r.Get("/dev/source", devResetH.Source)
				// Inline closure (not `devReportsH.Mount` as the second arg)
				// so dev/scripts/extract_routes.py picks up the nested
				// routes — its ROUTE_RE only matches the closure form.
				r.Route("/dev/reporting", func(r chi.Router) {
					devReportsH.Mount(r)
				})
			})
		})

		// PLA059 — /admin/api-keys/{issue,list,revoke}.
		// Gate order matters and is pinned by handler tests:
		//   1. RequireFreshPassword — a user with ForcePasswordChange
		//      must rotate before touching credentials.
		//   2. RequireUserAuth — deny API-key-only callers explicitly
		//      (closes the accidental key-chaining path through the
		//      RequirePermission api-key pass-through).
		//   3. RequirePermission(ApiKeysManage) — dedicated permission,
		//      no longer coupled to users.list.
		//   4. RequireStepUpReauth("manage-api-keys") — Issue and
		//      Revoke change credentials state; require a fresh
		//      X-Action-Proof. List is read-only audit data (KeyInfo
		//      carries no raw_key) and is intentionally NOT step-up
		//      gated.
		r.Group(func(r chi.Router) {
			r.Use(authSvc.RequireFreshPassword)
			r.Use(auth.RequireUserAuth)
			r.Use(auth.RequirePermission(permResolver, permissions.ApiKeysManage))
			r.With(authSvc.RequireStepUpReauth("manage-api-keys")).Post("/api-keys/issue", apiKeysH.Issue)
			r.Get("/api-keys", apiKeysH.List)
			r.With(authSvc.RequireStepUpReauth("manage-api-keys")).Post("/api-keys/revoke", apiKeysH.Revoke)
		})
	})

	// /timeboxes/sprints + /timeboxes/releases (B22.23)
	if sprintH != nil {
		r.Route("/timeboxes/sprints", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Get("/", sprintH.List)
			// Slice 2.5 (ObjectTree refactor) — column catalogue.
			r.Get("/columns", sprintH.Columns)
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
			// Slice 2.5 (ObjectTree refactor) — column catalogue.
			r.Get("/columns", releaseH.Columns)
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
	if milestoneH != nil {
		r.Route("/timeboxes/milestones", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Get("/", milestoneH.List)
			r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
				Post("/", milestoneH.Create)
			r.Get("/{id}", milestoneH.Get)
			r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
				Patch("/{id}", milestoneH.Update)
			r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
				Delete("/{id}", milestoneH.Delete)
		})
	}

	// /lookups — slim scope-bound lookup endpoints (users-in-scope etc.).
	// Every authenticated tenant member can read; subscription clamp is
	// applied server-side in the SQL.
	r.Route("/lookups", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Get("/users-in-scope", lookupsH.ListUsersInScope)
	})

	// /mentions — @-mention scaffold (search + create + inbox).
	// Tenant isolation lives in the SQL; no extra permission gate beyond
	// RequireAuth + RequireFreshPassword. Rate-limit matches the other
	// authenticated read-heavy surfaces.
	r.Route("/mentions", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Get("/search", mentionsH.SearchMentionables)
		r.Get("/inbox", mentionsH.ListInbox)
		r.Post("/", mentionsH.Create)
		r.Post("/{id}/read", mentionsH.MarkRead)
	})

	// /notifications — bell + preferences (B11.4).
	// Read-heavy: list + unread-count poll cycles. Tenant isolation
	// is in the SQL (every read fences on subscription_id + user_id).
	r.Route("/notifications", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(240, time.Minute))
		r.Get("/", notifH.List)
		r.Get("/unread-count", notifH.UnreadCount)
		r.Post("/read-all", notifH.MarkAllRead)
		r.Post("/{id}/read", notifH.MarkRead)
		r.Get("/prefs", notifH.ListPrefs)
		r.Put("/prefs", notifH.UpsertPref)
		// SSE: server-sent events for real-time notification nudges.
		// One open connection per user; reconnects handled by the
		// browser's native EventSource.
		r.Get("/stream", notifStreamH.Stream)
		// Rules engine — CRUD + per-tenant field/operator catalogue.
		r.Get("/rule-schema", notifSchemaH.Get)
		r.Route("/rules", func(r chi.Router) {
			r.Get("/", notifRulesH.List)
			r.Post("/", notifRulesH.Create)
			r.Get("/{id}", notifRulesH.Get)
			r.Patch("/{id}", notifRulesH.Update)
			r.Delete("/{id}", notifRulesH.Delete)
		})
	})

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
			r.Use(sentinelMW)
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
	// Writers (POST/PATCH/DELETE) re-pipe the dead /api/dev/artefact-types
	// shadow surface for workspace-admin Custom Fields management.
	// Authz/tenancy/scope clamp all inside handler — see fields/handler.go.
	r.Route("/workspaces/{id}/fields", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Get("/", fieldsH.List)
		r.Post("/", fieldsH.Create)
		r.Patch("/{field_id}", fieldsH.Update)
		r.Delete("/{field_id}", fieldsH.Archive)
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
			r.Use(sentinelMW)
			r.With(readLimit17).Get("/", h.List)
			r.With(writeLimit17, userWriteLimiter).Post("/", h.Create)
			r.With(writeLimit17, userWriteLimiter).Post("/bulk", h.Bulk)
			r.With(readLimit17).Get("/summary", h.Summary)
			// PLA057 / OBJ1 — scope-clamped facet enumeration. Chip UIs
			// call this to learn "what types/priorities are reachable
			// in the current scope" without hitting the workspace catalogue
			// (which can disagree with the grid's topology clamp).
			r.With(readLimit17).Get("/facets", h.Facets)
			r.With(readLimit17).Get("/flow-states", h.ListFlowStates)
			// Slice 2.5 (ObjectTree refactor) — exposes the ?fields=
			// allow-list catalogue. Frontend column picker / agent
			// introspection consume this; no subscription clamp on the
			// catalogue itself, the surface is global to the resource.
			r.With(readLimit17).Get("/columns", h.Columns)
			// Per-type custom-field schema. Consumed by the V2 create
			// flyout + inline edit form to render the right inputs for
			// each artefact type (Risk → risk_score, risk_impact, …;
			// Defect → severity, …). Mounted before /{id} so the
			// literal "types" segment wins over the {id} param.
			r.With(readLimit17).Get("/types/{typeId}/fields", h.ListFieldsForType)
			// Slice 4.6c — narrow refetch for cascade-touched rows.
			// Mounted before /{id} so the literal segment wins over
			// the param.
			r.With(readLimit17).Get("/by-ids", h.ByIDs)
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

	// /saved-views — Rally-style saved view configurations. See
	// docs/superpowers/specs/2026-05-28-saved-views-design.md.
	r.Route("/saved-views", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		savedViewsHandler.Mount(r)
	})
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
			// PLA062 S05.4: Sentinel is the sole request-level clamp.
			// Replaces the inline PoolWorkspaceLookup wiring this group
			// carried pre-PLA-0053 / story 00578 and the hoisted
			// workspaceLookup that followed it.
			r.Use(sentinelMW)

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

	// B20.4.3 — cost centres. Subscription-scoped reference data;
	// reads available to any authenticated tenant member (per-user
	// edit panel needs the dropdown list), writes gated by
	// cost_centres.manage. The handler re-checks per-request even
	// though Patch/Create/Archive route through RequirePermission —
	// SERVER IS THE GATE hard rule, defence in depth.
	r.Route("/cost-centres", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Get("/", costCentresH.List)
		r.With(auth.RequirePermission(permResolver, permissions.CostCentresManage)).
			Post("/", costCentresH.Create)
		r.With(auth.RequirePermission(permResolver, permissions.CostCentresManage)).
			Patch("/{id}", costCentresH.Patch)
		r.With(auth.RequirePermission(permResolver, permissions.CostCentresManage)).
			Delete("/{id}", costCentresH.Archive)
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
		r.Use(sentinelMW)
		artefactTypesH.Mount(r)
		// Re-sync — re-runs strategy + work-type writers against the
		// already-adopted bundle so schema changes to the writers (new
		// columns, depth recomputation, etc.) reach existing rows
		// without a destructive re-adoption.
		r.Post("/resync", portfolioResyncH.Resync)
	})

	// PLA-0055 / story 00596 — per-workspace priorities CRUD. Same
	// auth/clamp shape as /artefact-types: every read narrows to the
	// JWT-resolved workspace via WorkspaceClampMiddleware.
	r.Route("/artefact-priorities", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(sentinelMW)
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
			sentinelMW,
		).Get("/adoption-state", portfolioAdoptionStateH.GetAdoptionState)
		r.Get("/{family}/latest", portfolioModelsH.GetLatestByFamily)
		r.Get("/{id}", portfolioModelsH.GetByModelID)
		r.With(
			auth.RequirePermission(permResolver, permissions.PortfolioList),
			sentinelMW,
		).Post("/{id}/adopt", portfolioAdoptH.Adopt)
		r.With(
			auth.RequirePermission(permResolver, permissions.PortfolioList),
			sentinelMW,
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

	// ---- /flowboard + /topology/{id}/members (FB1.2.1 + FB1.4.1 fix) ----
	// FlowBoard routes: WIP limits, card prefs, and node-members read.
	// All routes sit behind RequireAuth + RequireFreshPassword + sentinelMW;
	// the sentinel middleware seeds WorkspaceID onto request context so the
	// flowboard handlers can compare against the node's workspace and gate
	// 403 on cross-scope reads. Without sentinelMW, every handler trips
	// the `clamp.WorkspaceID == uuid.Nil` guard and returns 403.
	// Per-route permission middleware (member-only WIP write gate) lives
	// inside handler.go in FB1.2.2 / FB1.2.4.
	r.Group(func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(sentinelMW)
		r.Use(httprate.LimitByIP(120, time.Minute))
		flowboardH.Mount(r)
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

	// B20.5.L — Synthetic-user resolver used by apikeys.Middleware on
	// the /_site mount. When a `sam_live_*` bearer token authenticates
	// a request, we look up the highest-tier active user on the key's
	// subscription and stash it in the auth context so downstream
	// handlers (which expect auth.UserFromCtx() to be non-nil) work
	// against api-key auth identically to JWT auth. Nil on
	// /samantha/v2 — that transport's handlers only need
	// subscription_id and would ignore the User anyway.
	siteUserSynth := func(ctx context.Context, subscriptionIDStr string) (*roletypes.User, context.Context, error) {
		subID, err := uuid.Parse(subscriptionIDStr)
		if err != nil {
			return nil, ctx, err
		}
		u, err := authSvc.FindServiceUserForSubscription(ctx, subID)
		if err != nil {
			return nil, ctx, err
		}
		return u, auth.WithUserForServiceAuth(ctx, u), nil
	}

	// Canonical BFF mount: every site-only route lives under /_site.
	// Frontend uses apiSite() (formerly apiInfra) to reach these.
	// apikeys.Middleware sits ahead of the JWT-bearing routes so a
	// `sam_live_*` token validates here and the downstream RequireAuth
	// short-circuits via its existing api_key_subscription_id check.
	// Only the api-key path needs the synthetic User; JWT requests
	// still get their User from RequireAuth's normal lookup.
	r.Route("/_site", func(r chi.Router) {
		r.Use(tagSite)
		r.Use(apikeys.Middleware(apiKeysSvc, siteUserSynth))
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
		// /samantha/v2 handlers only need subscription_id, not a full
		// User — pass nil for the UserSynth.
		r.Use(apikeys.Middleware(apiKeysSvc, nil))

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
			// PLA060 B16.11.4 + .5 — API-key scope enforcement on /samantha/v2
			// data-plane. JWT-authenticated users bypass scope checks
			// (handled by apikeys.HasScope itself); API-key callers
			// must carry the right read/write scope for the resource.
			mountArtefactRoutes := func(r chi.Router, h *artefactitems.Handler, readScope, writeScope string) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				// PLA-0053 / story 00578: workspace clamp via JWT claim
				// on the /samantha/v2 surface too (parity with /_site).
				r.Use(sentinelMW)
				read := apikeys.RequireScope(readScope)
				write := apikeys.RequireScope(writeScope)
				r.With(readLimit, read).Get("/", h.List)
				r.With(writeLimit, userWriteLimiter, write).Post("/", h.Create)
				r.With(writeLimit, userWriteLimiter, write).Post("/bulk", h.Bulk)
				r.With(readLimit, read).Get("/summary", h.Summary)
				r.With(readLimit, read).Get("/facets", h.Facets)
				r.With(readLimit, read).Get("/flow-states", h.ListFlowStates)
				// Slice 2.5 (ObjectTree refactor) — agent-introspectable
				// column catalogue. Same handler as the /_site mount.
				r.With(readLimit, read).Get("/columns", h.Columns)
				// Slice 4.6c — narrow refetch for cascade-touched rows.
				r.With(readLimit, read).Get("/by-ids", h.ByIDs)
				r.With(readLimit, read).Get("/{id}", h.Get)
				r.With(writeLimit, userWriteLimiter, write).Patch("/{id}", h.Patch)
				r.With(writeLimit, userWriteLimiter, write).Delete("/{id}", h.Archive)
				r.With(readLimit, read).Get("/{id}/children", h.ListChildren)
				r.With(readLimit, read).Get("/{id}/field-values", h.ListFieldValues)
				r.With(writeLimit, userWriteLimiter, write).Put("/{id}/field-values", h.UpsertFieldValues)
				r.With(writeLimit, userWriteLimiter, write).Delete("/{id}/field-values/{field_library_id}", h.DeleteFieldValue)
			}
			r.Route("/work-items", func(r chi.Router) {
				mountArtefactRoutes(r, workItemsV2H, apikeys.ScopeWorkItemsRead, apikeys.ScopeWorkItemsWrite)
			})
			r.Route("/portfolio-items", func(r chi.Router) {
				mountArtefactRoutes(r, portfolioItemsV2H, apikeys.ScopePortfolioItemsRead, apikeys.ScopePortfolioItemsWrite)
			})
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

		// ---- /timeboxes/milestones ----
		if milestoneH != nil {
			r.Route("/timeboxes/milestones", func(r chi.Router) {
				r.Use(authSvc.RequireAuth)
				r.Use(authSvc.RequireFreshPassword)
				r.Use(httprate.LimitByIP(120, time.Minute))

				r.Get("/", milestoneH.List)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Post("/", milestoneH.Create)
				r.Get("/{id}", milestoneH.Get)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Patch("/{id}", milestoneH.Update)
				r.With(auth.RequirePermission(permResolver, permissions.WorkItemsSettingsEdit)).
					Delete("/{id}", milestoneH.Delete)
			})
		} else {
			r.Get("/timeboxes/milestones", func(w http.ResponseWriter, r *http.Request) {
				http.Error(w, "timebox milestones not enabled", http.StatusServiceUnavailable)
			})
		}

		// ---- /mentions — @-mention scaffold ----
		// Public-transport mount. Same handler as /_site/mentions; the
		// MapPublic* dto seams (mentions.MapPublicMention,
		// mentions.MapPublicMentionable) keep the lint:public-dto-mapper
		// invariant satisfied even though the shapes are currently equal.
		r.Route("/mentions", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Get("/search", mentionsH.SearchMentionables)
			r.Get("/inbox", mentionsH.ListInbox)
			r.Post("/", mentionsH.Create)
			r.Post("/{id}/read", mentionsH.MarkRead)
		})

		// ---- /notifications — bell + preferences (B11.4) ----
		// Public-transport mount. Same handler as /_site/notifications;
		// MapPublicUserNotification keeps the lint:public-dto-mapper
		// invariant satisfied even though shapes are currently identical.
		r.Route("/notifications", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(240, time.Minute))
			r.Get("/", notifH.List)
			r.Get("/unread-count", notifH.UnreadCount)
			r.Post("/read-all", notifH.MarkAllRead)
			r.Post("/{id}/read", notifH.MarkRead)
			r.Get("/prefs", notifH.ListPrefs)
			r.Put("/prefs", notifH.UpsertPref)
			// Rules engine — same surface as /_site mount.
			r.Get("/rule-schema", notifSchemaH.Get)
			r.Route("/rules", func(r chi.Router) {
				r.Get("/", notifRulesH.List)
				r.Post("/", notifRulesH.Create)
				r.Get("/{id}", notifRulesH.Get)
				r.Patch("/{id}", notifRulesH.Update)
				r.Delete("/{id}", notifRulesH.Delete)
			})
		})

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
		// Writers (POST/PATCH/DELETE) added alongside the read endpoint;
		// scope clamp + role-tier gate inside the handler.
		r.Route("/workspaces/{id}/fields", func(r chi.Router) {
			r.Use(authSvc.RequireAuth)
			r.Use(authSvc.RequireFreshPassword)
			r.Use(httprate.LimitByIP(120, time.Minute))
			r.Get("/", fieldsH.List)
			r.Post("/", fieldsH.Create)
			r.Patch("/{field_id}", fieldsH.Update)
			r.Delete("/{field_id}", fieldsH.Archive)
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

			// Sentinel clamp (PLA062 S05.4): every list-style read
			// narrows to one workspace resolved from the JWT
			// workspace_id claim (PLA-0053 / story 00576 dropped the
			// ?ws= URL surface). Handlers read
			// sentinel.FromCtx(ctx).WorkspaceID; service queries
			// splice it into WHERE.
			r.Group(func(r chi.Router) {
				r.Use(sentinelMW)

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

// topologyScopeAdapter wraps *topology.Service to satisfy
// artefactitems.TopologyScopeResolver, translating topology's own
// sentinels (ErrNodeNotFound, ErrTenantMismatch) into the artefactitems
// sentinels the service compares with errors.Is. Keeps the boundary
// clean: artefactitems never imports topology, never sniffs strings.
type topologyScopeAdapter struct {
	inner *topology.Service
}

func (a topologyScopeAdapter) CanReadScope(ctx context.Context, subscriptionID, userID, targetNodeID uuid.UUID, actorRoleID uuid.UUID) (bool, error) {
	ok, err := a.inner.CanReadScope(ctx, subscriptionID, userID, targetNodeID, actorRoleID)
	return ok, translateTopologyErr(err)
}

func (a topologyScopeAdapter) DescendantNodeIDs(ctx context.Context, subscriptionID, rootNodeID uuid.UUID) ([]uuid.UUID, error) {
	ids, err := a.inner.DescendantNodeIDs(ctx, subscriptionID, rootNodeID)
	return ids, translateTopologyErr(err)
}

func (a topologyScopeAdapter) AncestorNodeIDs(ctx context.Context, subscriptionID, rootNodeID uuid.UUID) ([]uuid.UUID, error) {
	ids, err := a.inner.AncestorNodeIDs(ctx, subscriptionID, rootNodeID)
	return ids, translateTopologyErr(err)
}

func translateTopologyErr(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, topology.ErrNodeNotFound) || errors.Is(err, topology.ErrTenantMismatch) {
		return artefactitems.ErrScopeNodeNotFound
	}
	return err
}

// subtreeCacheInvalidator satisfies topology.SubtreeCacheInvalidator.
// Wipes every cached sentinel subtree AND every cached topology grants
// for a subscription via Valkey pattern delete:
//   - sentinel.CacheKeyPrefixForTenant(subID) → `sentinel:*:{sub}:*`
//     (subtree, focusws, grantnode cache namespaces)
//   - topology.MyGrantsCacheKeyPrefixForTenant(subID) → `topology:mygrants:{sub}:*`
//     (ListMyGrants per-(user, role) entries — added cycle 3 2026-05-28)
//
// Both prefixes are wiped on every structure-changing topology write
// because (a) topology rows are joined into the grants result for
// name/icon/parent_id, so a node move changes the grants payload, and
// (b) GrantRole / RevokeRole obviously affect the grants list itself.
// Tenant-scoped DEL keeps the blast radius to one tenant's caches.
//
// Used by main.go to thread the cache into the topology service without
// forcing topology to import either sentinel or cache (clean one-way
// dep graph).
//
// When the cache client is nil OR Valkey is down (breaker open), the
// DEL is a no-op; the 1-hour safety TTL on cached entries means stale
// values evict themselves within an hour even if every invalidate
// fails. Failures are logged at the cache layer; the writer's call
// site doesn't propagate them — invalidation is best-effort.
type subtreeCacheInvalidator struct {
	c *cache.Client
}

func (i *subtreeCacheInvalidator) InvalidateSubscription(ctx context.Context, subscriptionID uuid.UUID) {
	if i.c == nil {
		return
	}
	_, _ = i.c.DelPattern(ctx, sentinel.CacheKeyPrefixForTenant(subscriptionID))
	_, _ = i.c.DelPattern(ctx, topology.MyGrantsCacheKeyPrefixForTenant(subscriptionID))
}

// permCacheInvalidator satisfies roles.PermCacheInvalidator and
// users.PermCacheInvalidator. Wipes cached auth.LoadRoleAndPermissions
// entries on every role-grid mutation (AssignPermissions /
// RevokePermissions / Archive) and on every user role change (Update
// with role swap).
//
// Granularity:
//   - InvalidatePermCache: namespace-wide (`auth:roleperms:*`) — used
//     when the write affects every user holding the mutated role.
//     A per-role reverse index would let us be surgical, but the dev/
//     prod scale doesn't justify the maintenance burden; repopulating
//     active users on next request costs milliseconds per user.
//   - InvalidatePermCacheForUser: per-user (`auth:roleperms:{user_id}`) —
//     used when the write affects only the named user (role swap on a
//     single user record). Surgical DEL — no other users churn.
//
// SERVER-IS-GATE compliance: this cache stores a derived authoritative
// answer; the gate logic still runs on every request. The DEL closes
// the stale-positive window between the write and the safety TTL —
// without it, a revoked permission could leak for up to 1 hour.
type permCacheInvalidator struct {
	c *cache.Client
}

func (i *permCacheInvalidator) InvalidatePermCache(ctx context.Context) {
	if i.c == nil {
		return
	}
	_, _ = i.c.DelPattern(ctx, auth.AuthCacheKeyPrefix+"*")
}

func (i *permCacheInvalidator) InvalidatePermCacheForUser(ctx context.Context, userID uuid.UUID) {
	if i.c == nil {
		return
	}
	_ = i.c.Del(ctx, auth.AuthCacheKeyPrefix+userID.String())
}

// savedViewsWSAdminAdapter satisfies savedviews.WorkspaceAdminChecker
// by delegating to the permissions resolver. We use WorkspaceArchive as
// a proxy for "workspace admin" — it's the most restrictive workspace
// permission and is gadmin/padmin-only by default. Future work: define
// a dedicated `workspace.share_views` permission code (TD entry).
type savedViewsWSAdminAdapter struct {
	resolver *permissions.Resolver
}

func (a *savedViewsWSAdminAdapter) HasWorkspaceAdmin(ctx context.Context, userID, _ uuid.UUID) (bool, error) {
	return a.resolver.Has(ctx, userID, permissions.WorkspaceArchive)
}
