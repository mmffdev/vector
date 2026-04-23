package main

import (
	"context"
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
	"github.com/mmffdev/vector-backend/internal/db"
	"github.com/mmffdev/vector-backend/internal/email"
	"github.com/mmffdev/vector-backend/internal/models"
	"github.com/mmffdev/vector-backend/internal/nav"
	"github.com/mmffdev/vector-backend/internal/permissions"
	"github.com/mmffdev/vector-backend/internal/security"
	"github.com/mmffdev/vector-backend/internal/users"
)

func main() {
	_ = godotenv.Load(".env.local")

	// Prod safety: APP_ENV MUST be set explicitly. In production,
	// COOKIE_SECURE MUST be true and FRONTEND_ORIGIN MUST be https://.
	appEnv := os.Getenv("APP_ENV")
	switch appEnv {
	case "":
		log.Fatal("APP_ENV must be set explicitly (development|production)")
	case "production":
		if os.Getenv("COOKIE_SECURE") != "true" {
			log.Fatal("APP_ENV=production requires COOKIE_SECURE=true")
		}
		if origin := os.Getenv("FRONTEND_ORIGIN"); !strings.HasPrefix(origin, "https://") {
			log.Fatal("APP_ENV=production requires FRONTEND_ORIGIN to start with https://")
		}
	case "development":
		log.Println("⚠ APP_ENV=development — cookie/origin guards relaxed; DO NOT run this in production")
	default:
		log.Fatalf("APP_ENV=%q invalid; must be development or production", appEnv)
	}

	ctx := context.Background()
	pool, err := db.New(ctx)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

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
	navH := nav.NewHandler(navSvc, navBookmarks)
	navEntitiesSvc := nav.NewEntitiesService(pool)
	navEntitiesH := nav.NewEntitiesHandler(navEntitiesSvc)

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

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("ok")) })

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
