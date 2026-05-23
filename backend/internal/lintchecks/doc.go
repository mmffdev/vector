// Package lintchecks holds Go-test-shaped lint rules that fire in CI
// alongside `go test ./...`. Each *_test.go in this package enforces
// one cross-cutting code-hygiene contract:
//
//   - http_error_placement_test.go   PLA060 B16.12.6 — no http.Error
//                                    in product handlers; httperr.Write /
//                                    httperr.WriteCoded only.
//   - sql_placement_test.go          PLA060 B16.13.1 — SQL literals
//                                    live in sql.go (allowlist of
//                                    pre-existing offenders is closed).
//
// New checks land here when the pattern is "ratchet via Go test +
// allowlist" rather than a one-off staticcheck rule. See
// docs/c_code_standards.md.
package lintchecks
