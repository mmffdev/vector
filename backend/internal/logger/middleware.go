package logger

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
)

// HTTPLogger returns a chi-compatible middleware that logs each request as a
// structured JSON entry via the package-level logger.
func HTTPLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)

		// Seed a mutable carrier on the context so downstream auth
		// middleware can record why a 401 happened (no-credential vs
		// invalid-credential + reason). We read it back below to pick
		// the log level + emit audit-grade context.
		ctx, _ := withAuthFailureCarrier(r.Context())
		next.ServeHTTP(ww, r.WithContext(ctx))

		status := ww.Status()
		dur := time.Since(start)

		level := LevelInfo
		if status >= 500 {
			level = LevelError
		} else if status >= 400 {
			level = LevelWarn
		}

		// Carve out the high-volume "unauthenticated client poked an
		// auth-gated endpoint" case — downgrade no-credential 401s to
		// info without affecting any other 4xx. Invalid-credential
		// 401s stay at warn — that is the SOC 2 / defence-tier audit
		// signal we want loud.
		kv := []any{
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"duration_ms", dur.Milliseconds(),
			"bytes", ww.BytesWritten(),
			"request_id", middleware.GetReqID(r.Context()),
		}
		if kind, reason, ok := authFailureFromCtx(ctx); ok {
			if kind == AuthFailureNoCredential {
				level = LevelInfo
			}
			kv = append(kv, "auth_failure", string(kind))
			if reason != "" {
				kv = append(kv, "auth_reason", reason)
			}
		}

		std.log(level, "request", kv...)
	})
}
