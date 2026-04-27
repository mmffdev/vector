package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/joho/godotenv"

	"github.com/mmffdev/vector-backend/internal/audit"
	"github.com/mmffdev/vector-backend/internal/auth"
	"github.com/mmffdev/vector-backend/internal/custompages"
	"github.com/mmffdev/vector-backend/internal/db"
	"github.com/mmffdev/vector-backend/internal/errorsreport"
	"github.com/mmffdev/vector-backend/internal/librarydb"
	"github.com/mmffdev/vector-backend/internal/libraryreleases"
	"github.com/mmffdev/vector-backend/internal/messaging/email"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/nav"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/portfoliomodels"
	"github.com/mmffdev/vector-backend/internal/security"
	"github.com/mmffdev/vector-backend/internal/users"
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

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status":     "ok",
			"commit":     Commit,
			"build_time": BuildTime,
			"started_at": processStartedAt.Format(time.RFC3339),
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
