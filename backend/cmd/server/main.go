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
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/addressables"
	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/custompages"
	"github.com/mmffdev/vector-backend/internal/db"
	"github.com/mmffdev/vector-backend/internal/defects"
	"github.com/mmffdev/vector-backend/internal/errorsreport"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/libraryreleases"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/nav"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/artefacts"
	"github.com/mmffdev/vector-backend/internal/searchworker"
	"github.com/mmffdev/vector-backend/internal/portfolioitems"
	"github.com/mmffdev/vector-backend/internal/portfoliomodels"
	"github.com/mmffdev/vector-backend/internal/ranking"
	"github.com/mmffdev/vector-backend/internal/realtime"
	"github.com/mmffdev/vector-backend/internal/security"
	"github.com/mmffdev/vector-backend/internal/userstories"
	"github.com/mmffdev/vector-backend/internal/users"
	"github.com/mmffdev/vector-backend/internal/workitems"
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

	// Library DB pools (mmff_library). Phase 3 only consumes RO; the
	// publish + ack pools are wired the moment a handler needs them.
	// Required env vars are documented in librarydb/db.go.
	libPools, err := librarydb.New(ctx)
	if err != nil {
		log.Fatalf("librarydb: %v", err)
	}
	defer libPools.Close()

	auditLog := audit.New(pool)
	mailer := email.NewFromEnv()

	authSvc := auth.NewService(pool, auditLog, mailer)
	authH := auth.NewHandler(authSvc)

	usersSvc := users.New(pool, auditLog, mailer)
	usersH := users.NewHandler(usersSvc)

	permsSvc := permissions.New(pool, auditLog)
	permsH := permissions.NewHandler(permsSvc)

	// Page registry: cached DB-backed catalogue. 60s TTL trades a tiny
	// window of staleness after an admin change for near-zero read cost.
	// Prime at startup so a broken DB fails fast here, not on first request.
	navRegistry := nav.NewCachedRegistry(pool, 60*time.Second)
	if _, err := navRegistry.Load(ctx); err != nil {
		log.Fatalf("nav registry: initial load: %v", err)
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

	portfolioModelsH := portfoliomodels.NewHandler(libPools.RO)
	portfolioAdoptionStateH := portfoliomodels.NewAdoptionStateHandler(pool)
	portfolioAdoptH := portfoliomodels.NewAdoptHandler(libPools.RO, pool)
	portfolioAdoptStreamH := portfoliomodels.NewAdoptStreamHandler(portfolioAdoptH.Orchestrator)
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

	artefactsSvc := artefacts.New(pool)
	artefactsH := artefacts.NewHandler(artefactsSvc)

	workItemsSvc := workitems.New(pool)
	workItemsH := workitems.NewHandler(workItemsSvc)

	// Generic rank service. Resource registration happens here so the
	// PermissionChecker can delegate to the owning package's authz —
	// the loadRowForUpdate scopes by subscription_id, so a permissive
	// checker is safe (tenant isolation is enforced at the SQL boundary).
	ranking.Register("work_item", ranking.ResourceConfig{
		Table:       "o_artefacts_execution_work_items",
		ScopeColumn: "sprint_id",
		Permissions: ranking.PermissionCheckerFunc(func(ctx context.Context, subscriptionID, rowID uuid.UUID) (bool, error) {
			return true, nil
		}),
	})
	rankSvc := ranking.New(pool)
	rankH := ranking.NewHandler(rankSvc)

	// Realtime hub + Postgres LISTEN bridge. The hub is in-memory; the
	// bridge runs LISTEN rank_changed on a dedicated connection and
	// fans NOTIFY payloads (emitted by the notify_rank_changed trigger
	// in db/schema/069) to subscribed clients.
	rtHub := realtime.NewHub()
	realtime.StartRankListener(context.Background(), pool, rtHub)

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

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{os.Getenv("FRONTEND_ORIGIN")},
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

	// /api/env reports which DB the backend is actually connected to.
	// Letter is derived from the live DB_PORT env var (5434=prod tunnel,
	// 5435=dev, 5436=staging) — the truth source the frontend EnvBadge
	// polls so it can never drift from the running backend.
	r.Get("/api/env", func(w http.ResponseWriter, r *http.Request) {
		env, letter := envFromDBPort()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"env":         env,
			"letter":      letter,
			"db_host":     os.Getenv("DB_HOST") + ":" + os.Getenv("DB_PORT"),
			"backend_env": os.Getenv("BACKEND_ENV"),
		})
	})

	// POST /api/env/switch — flips backend to the requested env by
	// spawning .claude/bin/switch-server in a detached process group.
	// The script kills this very process and starts a new `go run`
	// with BACKEND_ENV set, so we MUST send the 202 response before
	// the script gets to step 2 (kill). The script's own ~1s setup
	// + tunnel check provides the buffer.
	//
	// Dev-only: refuses when APP_ENV=production. CSRF middleware
	// blocks unauthenticated callers (no csrf cookie → 403 before
	// reaching this handler).
	r.Post("/api/env/switch", func(w http.ResponseWriter, r *http.Request) {
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

		script := "/Users/rick/Documents/MMFFDev-Projects/MMFFDev - Vector/.claude/bin/switch-server"
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

	// ---- /api/auth ----
	r.Route("/api/auth", func(r chi.Router) {
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
	r.Route("/api/me", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Get("/theme-pack", usersH.GetThemePack)
		r.Put("/theme-pack", usersH.SetThemePack)
	})

	// ---- /api/nav ----
	r.Route("/api/nav", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		// 120 requests/min/IP across all nav routes — comfortably above
		// normal UI churn (load + a handful of PUTs per session), blocks
		// authed-session abuse.
		r.Use(httprate.LimitByIP(120, time.Minute))

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

	// ---- /api/custom-pages ----
	r.Route("/api/custom-pages", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Get("/", customPagesH.List)
		r.Post("/", customPagesH.Create)
		r.Get("/{id}", customPagesH.Get)
		r.Patch("/{id}", customPagesH.Patch)
		r.Delete("/{id}", customPagesH.Delete)
	})

	// ---- /api/pane-help — REMOVED in PLA-0005 / 00254 ----
	// The pane_help table was migrated into page_help and dropped in
	// migration 076. Every endpoint returns 410 Gone with a pointer to
	// the replacement so any stale caller fails loudly.
	paneHelpGone := func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		_, _ = w.Write([]byte(`{"error":"pane_help removed; use /api/page-help/{addressable_id} (substrate-keyed) and /api/page-help/admin (gadmin)"}`))
	}
	r.Get("/api/pane-help", paneHelpGone)
	r.Get("/api/pane-help/admin", paneHelpGone)
	r.Put("/api/pane-help/*", paneHelpGone)

	// ---- /api/addressables and /api/page-help/{addressable_id} (PLA-0005) ----
	// build-reconcile: CI service-account token (X-CI-Token).
	// register:        dev unrestricted; prod requires X-Custom-App-Token.
	// snapshot, page-help GET: unauthenticated by design (substrate metadata).
	// page-help admin (list / PUT / DELETE): gadmin-only, story 00253.
	r.Post("/api/addressables/build-reconcile", addressablesH.BuildReconcile)
	r.Post("/api/addressables/register", addressablesH.Register)
	r.Get("/api/addressables/snapshot", addressablesH.Snapshot)
	r.Get("/api/page-help/{addressable_id}", addressablesH.PageHelp)
	r.Route("/api/page-help/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequireRole(models.RoleGAdmin))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Get("/", addressablesH.PageHelpAdminList)
		r.Put("/{addressable_id}", addressablesH.PageHelpAdminPut)
		r.Delete("/{addressable_id}", addressablesH.PageHelpAdminDelete)
	})
	r.Route("/api/addressables/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequireRole(models.RoleGAdmin))
		r.Use(httprate.LimitByIP(120, time.Minute))
		r.Patch("/{id}/helpable", addressablesH.AdminUpdateHelpable)
	})

	// ---- /api/portfolio-models ----
	// Read-only library bundle surface (Phase 3 of mmff_library plan).
	// Bundle GETs by family/id are open to any authenticated user —
	// MMFF-authored content is implicitly visible across tenants;
	// per-tenant share enforcement lands in Phase 5. List + adoption-state
	// are padmin-only because adoption is a padmin-owned product decision.
	r.Route("/api/portfolio-models", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		// Padmin-only: list of MMFF-published bundles for the adoption
		// picker. Registered BEFORE /{id} so chi resolves the static
		// path first (defensive — chi's trie prefers static segments
		// anyway).
		r.With(auth.RequireRole(models.RolePAdmin)).
			Get("/", portfolioModelsH.List)

		// Padmin-only: live adoption state for the caller's subscription.
		// Registered BEFORE /{id} so chi resolves the static path first
		// (defensive — chi's trie prefers static segments anyway).
		r.With(auth.RequireRole(models.RolePAdmin)).
			Get("/adoption-state", portfolioAdoptionStateH.GetAdoptionState)

		r.Get("/{family}/latest", portfolioModelsH.GetLatestByFamily)
		r.Get("/{id}", portfolioModelsH.GetByModelID)

		// Padmin-only: run the adoption saga for a library model id.
		// Per-step atomic, idempotent on retry — see
		// backend/internal/portfoliomodels/adopt.go for the orchestrator.
		// Registered AFTER /{id} in source order is fine — chi's trie
		// distinguishes by HTTP method anyway.
		r.With(auth.RequireRole(models.RolePAdmin)).
			Post("/{id}/adopt", portfolioAdoptH.Adopt)

		// Padmin-only: SSE variant — emits one `event: step` per saga
		// step plus a final `event: done` or `event: fail`. See
		// backend/internal/portfoliomodels/adopt_stream.go.
		r.With(auth.RequireRole(models.RolePAdmin)).
			Get("/{id}/adopt/stream", portfolioAdoptStreamH.Stream)
	})

	// ---- /api/library/releases ----
	// Release-notification channel (Phase 3, plan §12). Gadmin-only:
	// only the subscription's group admin acknowledges releases on
	// behalf of the tenant. Count endpoint is the cheap badge poll;
	// list endpoint hands back full release rows + actions.
	r.Route("/api/library/releases", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequireRole(models.RoleGAdmin))
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Get("/", libReleasesH.List)
		r.Get("/count", libReleasesH.Count)
		r.Post("/{id}/ack", libReleasesH.Ack)
	})

	// ---- /api/subscription ----
	// Subscription-scoped write surface. Padmin-only.
	r.Route("/api/subscription", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(auth.RequireRole(models.RolePAdmin))
		r.Use(httprate.LimitByIP(120, time.Minute))

		// Subscription layer reads + writes (stories 00062–00065).
		r.Get("/layers", layersBatchH.GetLayers)
		r.Patch("/layers/batch", layersBatchH.PatchLayersBatch)
	})

	// ---- /api/errors ----
	// Generic error reporter — any authenticated user (padmin, gadmin,
	// or user) may report an occurrence. Rate-limited to dampen runaway
	// loops on the client side; cap matches /api/nav.
	r.Route("/api/errors", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Post("/report", errorsReportH.Report)
	})

	// ---- /api/user-stories ----
	r.Route("/api/user-stories", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Post("/", userStoriesH.Create)
		r.Get("/{id}", userStoriesH.Get)
		r.Patch("/{id}", userStoriesH.Patch)
		r.Delete("/{id}", userStoriesH.Archive)
	})

	// ---- /api/defects ----
	r.Route("/api/defects", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Post("/", defectsH.Create)
		r.Get("/{id}", defectsH.Get)
		r.Patch("/{id}", defectsH.Patch)
		r.Delete("/{id}", defectsH.Archive)
	})

	// ---- /api/artefacts/{type} ----
	// Core CRUD: all authenticated roles.
	// Schema management: padmin only (RequireRole enforced per sub-route).
	// Field values: all authenticated roles.
	r.Route("/api/artefacts/{type}", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Post("/", artefactsH.Create)
		r.Get("/{id}", artefactsH.Get)
		r.Patch("/{id}", artefactsH.Patch)
		r.Delete("/{id}", artefactsH.Archive)

		r.Get("/{id}/fields", artefactsH.ListFieldValues)
		r.Put("/{id}/fields/{field_name}", artefactsH.WriteFieldValue)
		r.Post("/{id}/fields/bulk", artefactsH.BulkWriteFieldValues)

		r.Group(func(r chi.Router) {
			r.Use(auth.RequireRole(models.RolePAdmin))
			r.Get("/schema", artefactsH.ListSchema)
			r.Post("/schema", artefactsH.CreateSchema)
			r.Patch("/schema/{schema_id}", artefactsH.PatchSchema)
			r.Delete("/schema/{schema_id}", artefactsH.ArchiveSchema)
		})
	})

	// ---- /api/rank ----
	// One generic endpoint serves every registered resource. The
	// resource_type field in the body picks the registry entry; the
	// service enforces tenant isolation by scoping every query by
	// subscription_id from the session (never the body).
	r.Route("/api/rank", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(240, time.Minute))

		r.Post("/move", rankH.Move)
	})

	// ---- /ws ----
	// One WebSocket per connected client; topic-based fan-out via the
	// realtime hub. Auth: session-cookie required (RequireAuth runs on
	// the upgrade request before Accept). Tenant isolation: every
	// subscribe frame is rejected unless the topic carries the caller's
	// own subscription_id — see Client.topicAllowed.
	r.Group(func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Get("/ws", realtime.ServeWS(rtHub))
	})

	// ---- /api/work-items ----
	r.Route("/api/work-items", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Get("/", workItemsH.List)
		r.Post("/", workItemsH.Create)
		r.Get("/{id}", workItemsH.Get)
		r.Patch("/{id}", workItemsH.Patch)
		r.Delete("/{id}", workItemsH.Archive)
		r.Get("/{id}/children", workItemsH.ListChildren)
		r.Get("/{id}/field-values", workItemsH.ListFieldValues)
		r.Put("/{id}/field-values", workItemsH.UpsertFieldValues)
		r.Delete("/{id}/field-values/{field_library_id}", workItemsH.DeleteFieldValue)
	})

	// ---- /api/sprints ----
	r.Route("/api/sprints", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Get("/", workItemsH.ListSprints)
		r.Post("/", workItemsH.CreateSprint)
		r.Get("/{id}", workItemsH.GetSprint)
		r.Patch("/{id}", workItemsH.PatchSprint)
		r.Delete("/{id}", workItemsH.ArchiveSprint)
	})

	// ---- /api/custom-field-library ----
	r.Route("/api/custom-field-library", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Get("/", workItemsH.ListCustomFields)
		r.Post("/", workItemsH.CreateCustomField)
		r.Get("/{id}", workItemsH.GetCustomField)
		r.Patch("/{id}", workItemsH.PatchCustomField)
		r.Delete("/{id}", workItemsH.ArchiveCustomField)
	})

	// ---- /api/work-item-templates ----
	r.Route("/api/work-item-templates", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Get("/", workItemsH.ListTemplates)
		r.Post("/", workItemsH.CreateTemplate)
		r.Get("/{id}", workItemsH.GetTemplate)
		r.Post("/{id}/fields", workItemsH.AddTemplateField)
		r.Delete("/{id}/fields/{field_library_id}", workItemsH.RemoveTemplateField)
	})

	// ---- /api/portfolio-items ----
	r.Route("/api/portfolio-items", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)
		r.Use(httprate.LimitByIP(120, time.Minute))

		r.Post("/", portfolioItemsH.Create)
		r.Get("/{id}", portfolioItemsH.Get)
		r.Patch("/{id}", portfolioItemsH.Patch)
		r.Delete("/{id}", portfolioItemsH.Archive)
	})

	// ---- /api/admin ----
	r.Route("/api/admin", func(r chi.Router) {
		r.Use(authSvc.RequireAuth)
		r.Use(authSvc.RequireFreshPassword)

		// Users — gadmin only
		r.Group(func(r chi.Router) {
			r.Use(auth.RequireRole(models.RoleGAdmin))
			r.Post("/users", usersH.Create)
			r.Patch("/users/{id}", usersH.Patch)
		})

		// List users — gadmin or padmin
		r.Group(func(r chi.Router) {
			r.Use(auth.RequireRole(models.RoleGAdmin, models.RolePAdmin))
			r.Get("/users", usersH.List)
		})

		// Permissions — gadmin or padmin (finer project-level gating later when projects table lands)
		r.Group(func(r chi.Router) {
			r.Use(auth.RequireRole(models.RoleGAdmin, models.RolePAdmin))
			r.Post("/permissions", permsH.Grant)
			r.Delete("/permissions/{id}", permsH.Revoke)
			r.Get("/permissions", permsH.List)
		})

		// Dev tools — gadmin or padmin (reset is scoped to caller's subscription)
		r.Group(func(r chi.Router) {
			r.Use(auth.RequireRole(models.RoleGAdmin, models.RolePAdmin))
			r.Post("/dev/adoption-reset", devResetH.ResetAdoptionState)
		})
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
