package security

import "net/http"

// MaxBodyBytes is the global ceiling for any request body the API will read.
// 1 MiB is plenty for auth/admin JSON; uploads will need their own route with
// a scoped limit if/when that feature lands.
const MaxBodyBytes = 1 << 20 // 1 MiB

// BodyLimit wraps r.Body in http.MaxBytesReader. Handlers that try to read past
// the limit get an error back from json.Decode, which they already convert to 400.
func BodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, MaxBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}
