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

		next.ServeHTTP(ww, r)

		status := ww.Status()
		dur := time.Since(start)

		level := LevelInfo
		if status >= 500 {
			level = LevelError
		} else if status >= 400 {
			level = LevelWarn
		}

		std.log(level, "request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", status,
			"duration_ms", dur.Milliseconds(),
			"bytes", ww.BytesWritten(),
			"request_id", middleware.GetReqID(r.Context()),
		)
	})
}
