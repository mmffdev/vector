// Package geo wraps MaxMind GeoLite2 lookups for the session-anomaly
// drift-detection layer (TD-SEC-SESSION-ANOMALY).
//
// Two databases are consulted independently:
//   - GeoLite2-City  → ISO-3166-1 alpha-2 country code
//   - GeoLite2-ASN   → autonomous system number + organisation
//
// Both are optional: if the .mmdb file paths in env aren't set or the
// files are missing, the Resolver returns empty strings without
// erroring. That keeps the dev developer ergonomic (no need to
// download the .mmdb files just to compile) while production deploys
// can ship the files alongside the binary.
//
// MaxMind license note: GeoLite2 is free but requires a sign-in to
// download. See backend/data/geoip/README.md for the provisioning
// step. We do NOT bundle the .mmdb files into the repo; they're
// gitignored and treated as deploy-time artefacts.
package geo

import (
	"errors"
	"log"
	"net"
	"os"
	"sync"

	"github.com/oschwald/geoip2-golang"
)

// Lookup is the resolved-once-per-IP shape consumed by the auth
// package. Empty strings mean the lookup failed or the corresponding
// database isn't loaded — callers MUST tolerate "" gracefully (treat
// as "no signal", do not enforce drift).
type Lookup struct {
	Country string // ISO 3166-1 alpha-2, e.g. "GB", "US", "DE"
	ASN     string // numeric AS number as decimal string, e.g. "15169"
}

// Resolver caches loaded MaxMind .mmdb readers and exposes a single
// Resolve(ip) method. Zero value is usable — represents "no databases
// loaded, every lookup returns Lookup{}".
type Resolver struct {
	mu      sync.RWMutex
	cityDB  *geoip2.Reader
	asnDB   *geoip2.Reader
	loaded  bool
}

// NewResolver constructs a Resolver and attempts to open both .mmdb
// files from environment paths. A missing or unreadable file is
// non-fatal: that lookup arm stays disabled, the other still works.
// Errors are logged at startup (visible in deploy logs) but never
// returned — operator visibility without runtime-breakage.
//
//   GEOIP_CITY_DB — path to GeoLite2-City.mmdb (provides Country)
//   GEOIP_ASN_DB  — path to GeoLite2-ASN.mmdb (provides ASN)
func NewResolver() *Resolver {
	r := &Resolver{}
	if cityPath := os.Getenv("GEOIP_CITY_DB"); cityPath != "" {
		db, err := geoip2.Open(cityPath)
		if err != nil {
			log.Printf("geo: GeoLite2-City unavailable (%s): %v — country lookups disabled", cityPath, err)
		} else {
			r.cityDB = db
			r.loaded = true
		}
	}
	if asnPath := os.Getenv("GEOIP_ASN_DB"); asnPath != "" {
		db, err := geoip2.Open(asnPath)
		if err != nil {
			log.Printf("geo: GeoLite2-ASN unavailable (%s): %v — ASN lookups disabled", asnPath, err)
		} else {
			r.asnDB = db
			r.loaded = true
		}
	}
	if !r.loaded {
		log.Printf("geo: no MaxMind databases loaded — TD-SEC-SESSION-ANOMALY drift detection will run with empty fingerprints. Set GEOIP_CITY_DB and GEOIP_ASN_DB to enable.")
	}
	return r
}

// Resolve looks up country + ASN for the given IP. Returns Lookup{}
// (both empty) on any failure mode: bad IP, no databases loaded,
// lookup miss. Safe to call with nil receiver — same empty result.
func (r *Resolver) Resolve(ipStr string) Lookup {
	if r == nil || !r.loaded || ipStr == "" {
		return Lookup{}
	}
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return Lookup{}
	}
	out := Lookup{}
	r.mu.RLock()
	city := r.cityDB
	asn := r.asnDB
	r.mu.RUnlock()
	if city != nil {
		if rec, err := city.Country(ip); err == nil {
			out.Country = rec.Country.IsoCode
		}
	}
	if asn != nil {
		if rec, err := asn.ASN(ip); err == nil && rec.AutonomousSystemNumber > 0 {
			// Format as decimal string to match the audit_logs metadata
			// shape (jsonb can hold any number but text is canonical here).
			out.ASN = decimalASN(rec.AutonomousSystemNumber)
		}
	}
	return out
}

// Close releases both database readers. Called once on shutdown.
func (r *Resolver) Close() error {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var errs []error
	if r.cityDB != nil {
		if err := r.cityDB.Close(); err != nil {
			errs = append(errs, err)
		}
		r.cityDB = nil
	}
	if r.asnDB != nil {
		if err := r.asnDB.Close(); err != nil {
			errs = append(errs, err)
		}
		r.asnDB = nil
	}
	r.loaded = false
	return errors.Join(errs...)
}

// decimalASN renders a uint to its base-10 string without pulling in
// strconv (single-purpose helper, ~10 LOC).
func decimalASN(n uint) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
