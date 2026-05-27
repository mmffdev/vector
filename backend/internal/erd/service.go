// Package erd introspects the live pg catalogs of vector_artefacts and
// mmff_library to produce an ERD payload for the /dev/erd page.
//
// Sole writer: the HTTP handler in handler.go. The service is read-only
// against both pools; it never mutates schema.
package erd

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	va        *pgxpool.Pool // vector_artefacts
	lib       *pgxpool.Pool // mmff_library (read-only)
	areasPath string        // path to dev/audits/erd_groups.yaml

	mu       sync.Mutex
	cached   *Response
	cachedAt time.Time
	softRefs []Edge
}

// SetSoftRefs replaces the cached set of cross-DB soft-reference edges
// that Build will append after the hard FKs. Called by the handler at
// construction time once SY003 has been parsed; safe to call again to
// refresh.
func (s *Service) SetSoftRefs(refs []Edge) {
	s.mu.Lock()
	s.softRefs = refs
	s.mu.Unlock()
}

func NewService(va, lib *pgxpool.Pool, areasPath string) *Service {
	return &Service{va: va, lib: lib, areasPath: areasPath}
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

	groups, err := loadGroupsFromPath(s.areasPath)
	if err != nil {
		return nil, err
	}

	resp := &Response{
		GeneratedAt: time.Now().UTC(),
		Groups:      groups.List(),
		Nodes:       []Node{},
		Edges:       []Edge{},
		Databases:   []DatabaseSum{},
	}

	for _, ds := range []struct {
		label string
		pool  *pgxpool.Pool
	}{
		{"vector_artefacts", s.va},
		{"mmff_library", s.lib},
	} {
		counts, err := fetchRowCounts(ctx, ds.pool)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", ds.label, err)
		}
		cols, err := fetchColumns(ctx, ds.pool)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", ds.label, err)
		}
		fks, err := fetchHardFKs(ctx, ds.pool, ds.label)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", ds.label, err)
		}

		var tableNames []string
		for t := range counts {
			tableNames = append(tableNames, t)
		}
		for _, t := range tableNames {
			resp.Nodes = append(resp.Nodes, Node{
				ID:       ds.label + "." + t,
				Database: ds.label,
				Table:    t,
				Group:    groups.GroupFor(t),
				RowCount: counts[t],
				Columns:  cols[t],
			})
		}
		resp.Edges = append(resp.Edges, fks...)
		resp.Databases = append(resp.Databases, DatabaseSum{
			Name:       ds.label,
			TableCount: len(tableNames),
			FKCount:    len(fks),
		})
	}

	s.mu.Lock()
	soft := s.softRefs
	s.mu.Unlock()
	resp.Edges = append(resp.Edges, soft...)

	s.mu.Lock()
	s.cached = resp
	s.cachedAt = time.Now()
	s.mu.Unlock()
	return resp, nil
}
