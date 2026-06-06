package navmap

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Service reads the unfiltered nav spine from vector_artefacts (vaPool).
type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// Spine reads both catalogue tables and assembles the bucket->page tree.
func (s *Service) Spine(ctx context.Context) (SpineResponse, error) {
	buckets, err := s.queryBuckets(ctx)
	if err != nil {
		return SpineResponse{}, fmt.Errorf("navmap: buckets: %w", err)
	}
	pages, tagOf, err := s.queryPages(ctx)
	if err != nil {
		return SpineResponse{}, fmt.Errorf("navmap: pages: %w", err)
	}
	return assembleSpine(buckets, pages, tagOf), nil
}

func (s *Service) queryBuckets(ctx context.Context) ([]SpineBucket, error) {
	rows, err := s.pool.Query(ctx, sqlListBuckets)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SpineBucket
	for rows.Next() {
		var b SpineBucket
		if err := rows.Scan(&b.TagEnum, &b.Label, &b.Order); err != nil {
			return nil, err
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

func (s *Service) queryPages(ctx context.Context) ([]SpinePage, map[string]string, error) {
	rows, err := s.pool.Query(ctx, sqlListAllPages)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	var pages []SpinePage
	tagOf := make(map[string]string)
	for rows.Next() {
		var p SpinePage
		var tag string
		if err := rows.Scan(&p.KeyEnum, &p.Label, &p.Href, &p.Kind, &tag, &p.DefaultOrder); err != nil {
			return nil, nil, err
		}
		pages = append(pages, p)
		tagOf[p.KeyEnum] = tag
	}
	return pages, tagOf, rows.Err()
}

// assembleSpine is pure: nests pages under their bucket by tag_enum, and
// collects pages whose tag matches no bucket into Untagged.
func assembleSpine(buckets []SpineBucket, pages []SpinePage, tagOf map[string]string) SpineResponse {
	byTag := make(map[string]int, len(buckets)) // tag_enum -> index in buckets
	for i := range buckets {
		buckets[i].Pages = nil
		byTag[buckets[i].TagEnum] = i
	}
	var untagged []SpinePage
	for _, p := range pages {
		tag := tagOf[p.KeyEnum]
		if idx, ok := byTag[tag]; ok {
			buckets[idx].Pages = append(buckets[idx].Pages, p)
		} else {
			untagged = append(untagged, p)
		}
	}
	return SpineResponse{Buckets: buckets, Untagged: untagged}
}
