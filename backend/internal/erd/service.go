// Package erd introspects the live pg catalogs of vector_artefacts and
// mmff_library to produce an ERD payload for the /dev/erd page.
//
// Sole writer: the HTTP handler in handler.go. The service is read-only
// against both pools; it never mutates schema.
package erd

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	va  *pgxpool.Pool // vector_artefacts
	lib *pgxpool.Pool // mmff_library (read-only)

	mu       sync.Mutex
	cached   *Response
	cachedAt time.Time
}

func NewService(va, lib *pgxpool.Pool) *Service {
	return &Service{va: va, lib: lib}
}

const cacheTTL = 60 * time.Second

// Build returns the full ERD response. Cached in-process for cacheTTL.
// force=true bypasses the cache (used by POST so snapshots are always fresh).
func (s *Service) Build(ctx context.Context, force bool) (*Response, error) {
	s.mu.Lock()
	if !force && s.cached != nil && time.Since(s.cachedAt) < cacheTTL {
		out := s.cached
		s.mu.Unlock()
		return out, nil
	}
	s.mu.Unlock()

	if s.va == nil || s.lib == nil {
		return nil, errors.New("erd: pools not configured")
	}

	resp := &Response{GeneratedAt: time.Now().UTC()}
	resp.Groups = []Group{}
	resp.Nodes = []Node{}
	resp.Edges = []Edge{}
	resp.Databases = []DatabaseSum{
		{Name: "vector_artefacts"},
		{Name: "mmff_library"},
	}

	s.mu.Lock()
	s.cached = resp
	s.cachedAt = time.Now()
	s.mu.Unlock()

	return resp, nil
}
