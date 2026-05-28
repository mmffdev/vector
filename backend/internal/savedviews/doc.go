// Package savedviews is the sole writer for the saved_views table in
// vector_artefacts. Implements Rally-style "Save As New View" + "Manage
// Saved Views" semantics with three sharing scopes (user | node |
// workspace) and a kind discriminator (objecttree | page_layout) so one
// table serves multiple consumers.
//
// Design: docs/superpowers/specs/2026-05-28-saved-views-design.md
// Plan:   docs/superpowers/plans/2026-05-28-saved-views.md
//
// # Architecture
//
// The package is layered:
//
//	store.go   — ViewStore interface + PostgresViewStore implementation
//	service.go — Service wraps a ViewStore; enforces permissions, tenant
//	             integrity, audit-log emission. Sole writer.
//	handler.go — chi HTTP surface; six endpoints under /_site/saved-views.
//
// # ViewStore swap path
//
// The ViewStore interface is the load-bearing future-proofing artefact.
// Every handler and the Service depend on the interface, never on
// *pgxpool.Pool directly. If a future scale curve makes Postgres the
// wrong substrate for this one table, the swap is:
//
//  1. Implement ViewStore against the new store.
//  2. Add a migration tool that reads from PostgresViewStore and writes
//     to the new store (the body shape is opaque JSON; no
//     re-schema-ing needed).
//  3. Flip the constructor in backend/cmd/server/main.go to the new
//     impl behind a feature flag.
//  4. Verify a week of dual reads (both stores returning identical
//     results), then retire PostgresViewStore.
//
// # Scale envelope
//
// See spec §5. Today's substrate handles up to ~10M rows on default
// Postgres settings, up to ~100M with autovacuum tuning + Valkey
// caching (CachedViewStore), up to ~500M with HASH partitioning on
// saved_views_id_subscription. Beyond that, the swap path above.
package savedviews
