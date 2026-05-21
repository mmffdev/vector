package devreports

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service is the sole reader/writer for dev_reports. Bound to the mmff_dev
// pool; nil-pool degrades every method to a safe empty/not-found response
// so the rest of the server boots fine without MMFF_DEV_DB_URL set.
type Service struct {
	pool *pgxpool.Pool
}

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// List returns lightweight metadata for every report, optionally filtered
// by type and/or search term. Empty typ returns all types.
func (s *Service) List(ctx context.Context, typ, search string) ([]Meta, error) {
	if s.pool == nil {
		return []Meta{}, nil
	}
	conds := []string{}
	args := []any{}
	i := 1
	if typ != "" {
		if !isValidType(typ) {
			return nil, ErrInvalidInput
		}
		conds = append(conds, sqlListTypeFilter+strconv.Itoa(i))
		args = append(args, typ)
		i++
	}
	if search != "" {
		conds = append(conds, fmt.Sprintf(sqlListSearchFilter, i))
		args = append(args, "%"+search+"%")
		i++
	}
	var b strings.Builder
	b.WriteString(sqlListBase)
	if len(conds) > 0 {
		b.WriteString(" WHERE ")
		b.WriteString(strings.Join(conds, " AND "))
	}
	b.WriteString(sqlListOrderBy)
	rows, err := s.pool.Query(ctx, b.String(), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Meta{}
	for rows.Next() {
		var m Meta
		if err := rows.Scan(
			&m.ID, &m.Type, &m.Title, &m.Category, &m.Topic,
			&m.Summary, &m.ContentText, &m.ReportDate,
			&m.CreatedAt, &m.UpdatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// Get returns the full report (meta + content + payload) for one id.
func (s *Service) Get(ctx context.Context, id string) (*Full, error) {
	if s.pool == nil {
		return nil, ErrNotFound
	}
	if id == "" {
		return nil, ErrInvalidInput
	}
	var f Full
	var payloadRaw []byte
	err := s.pool.QueryRow(ctx, sqlGetByID, id).Scan(
		&f.ID, &f.Type, &f.Title, &f.Category, &f.Topic,
		&f.Summary, &f.ContentText, &f.ReportDate,
		&f.CreatedAt, &f.UpdatedAt, &f.Content, &payloadRaw,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if len(payloadRaw) > 0 {
		_ = json.Unmarshal(payloadRaw, &f.Payload)
	}
	return &f, nil
}

// Upsert inserts or replaces a report by id. Skills call this via the
// Next.js proxy. ContentText is auto-derived from Content if empty so the
// search index stays populated even when callers forget to provide it.
func (s *Service) Upsert(ctx context.Context, in UpsertInput) (*Full, error) {
	if s.pool == nil {
		return nil, ErrInvalidInput
	}
	if in.ID == "" || in.Title == "" || in.Content == "" || in.Type == "" {
		return nil, ErrInvalidInput
	}
	if !isValidType(in.Type) {
		return nil, ErrInvalidInput
	}
	contentText := in.ContentText
	if contentText == "" {
		contentText = stripHTML(in.Content)
	}
	payload := in.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var reportDate *time.Time
	if in.ReportDate != "" {
		if t, err := time.Parse("2006-01-02", in.ReportDate); err == nil {
			reportDate = &t
		}
	}
	if _, err := s.pool.Exec(ctx, sqlUpsert,
		in.ID, in.Type, in.Title, nullable(in.Category), nullable(in.Topic),
		nullable(in.Summary), in.Content, contentText, payloadJSON, reportDate,
	); err != nil {
		return nil, err
	}
	return s.Get(ctx, in.ID)
}

// Delete removes a report by id. Returns ErrNotFound if no row was affected.
func (s *Service) Delete(ctx context.Context, id string) error {
	if s.pool == nil {
		return ErrInvalidInput
	}
	if id == "" {
		return ErrInvalidInput
	}
	ct, err := s.pool.Exec(ctx, sqlDeleteByID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// stripHTML returns a best-effort plaintext mirror of an HTML blob so the
// search index can match against words inside the report body. Not a full
// HTML parser — just enough to drop tags and collapse whitespace.
func stripHTML(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inTag := false
	for _, r := range s {
		switch {
		case r == '<':
			inTag = true
		case r == '>':
			inTag = false
			b.WriteByte(' ')
		case !inTag:
			b.WriteRune(r)
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
