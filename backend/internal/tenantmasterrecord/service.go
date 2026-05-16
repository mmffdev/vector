// Package tenantmasterrecord is the SOLE writer for the
// master_record_tenants table in vector_artefacts (subscription-tier).
//
// One row exists per subscription (the table's PRIMARY KEY). Get
// auto-creates the row on demand (defensive — covers subscriptions
// seeded before mig 068, though the migration backfills all existing).
// Patch applies a partial update with full server-side validation.
//
// SeedForSubscription is called from the subscription-create path
// (mmff_vector subscriptions INSERT) — the broken DB trigger was
// dropped in mmff_vector migration 200 because Postgres triggers
// cannot write across DBs. Eventual-consistency pattern: if
// SeedForSubscription fails after a subscription is created, the
// next Get auto-creates the row.
//
// Reads/writes vaPool. PRIMARY KEY is subscription_id (NOT workspace_id —
// this is the distinguishing feature vs workspacemasterrecord).
package tenantmasterrecord

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound     = errors.New("tenant settings not found")
	ErrInvalidInput = errors.New("invalid input")
)

// Settings is the wire shape returned to the frontend. Every field
// maps 1:1 to a column on master_record_tenants. Pointer types are
// nullable on the wire.
type Settings struct {
	TenantID                     uuid.UUID  `json:"tenant_id"`
	TenantName                   string     `json:"tenant_name"`
	TenantDescription            *string    `json:"tenant_description"`
	TenantPrimaryContactEmail    *string    `json:"tenant_primary_contact_email"`
	TenantDataRegion             string     `json:"tenant_data_region"`
	TenantTimezone               string     `json:"tenant_timezone"`
	TenantDateFormat             string     `json:"tenant_date_format"`
	TenantDatetimeFormat         string     `json:"tenant_datetime_format"`
	TenantWorkdays               []string   `json:"tenant_workdays"`
	TenantWeekStart              string     `json:"tenant_week_start"`
	TenantRankMethod             string     `json:"tenant_rank_method"`
	TenantBuildChangesetTracking bool       `json:"tenant_build_changeset_tracking"`
	TenantNotes                  *string    `json:"tenant_notes"`
	TenantCreatedAt              time.Time  `json:"tenant_created_at"`
	TenantUpdatedAt              time.Time  `json:"tenant_updated_at"`
	TenantArchivedAt             *time.Time `json:"tenant_archived_at"`
}

// PatchInput is the partial update payload. Pointer fields are
// "absent = no change". Empty-string convention clears nullable text fields.
type PatchInput struct {
	TenantName                   *string   `json:"tenant_name,omitempty"`
	TenantDescription            *string   `json:"tenant_description,omitempty"`
	TenantDataRegion             *string   `json:"tenant_data_region,omitempty"`
	TenantTimezone               *string   `json:"tenant_timezone,omitempty"`
	TenantDateFormat             *string   `json:"tenant_date_format,omitempty"`
	TenantDatetimeFormat         *string   `json:"tenant_datetime_format,omitempty"`
	TenantWorkdays               *[]string `json:"tenant_workdays,omitempty"`
	TenantWeekStart              *string   `json:"tenant_week_start,omitempty"`
	TenantRankMethod             *string   `json:"tenant_rank_method,omitempty"`
	TenantBuildChangesetTracking *bool     `json:"tenant_build_changeset_tracking,omitempty"`
	TenantNotes                  *string   `json:"tenant_notes,omitempty"`
	TenantPrimaryContactEmail    *string   `json:"tenant_primary_contact_email,omitempty"`
}

// Violation is a per-field validation error.
type Violation struct {
	Field   string
	Message string
}

// ValidationError aggregates one or more field violations.
type ValidationError struct {
	Violations []Violation
}

func (v *ValidationError) Error() string {
	if len(v.Violations) == 0 {
		return "validation failed"
	}
	parts := make([]string, 0, len(v.Violations))
	for _, vv := range v.Violations {
		parts = append(parts, fmt.Sprintf("%s: %s", vv.Field, vv.Message))
	}
	return "validation failed — " + strings.Join(parts, "; ")
}

// Service is the sole-writer surface.
type Service struct {
	Pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

// Allowed-value sets, mirrored to the CHECK constraints in mig 068.
var (
	regionSet = map[string]struct{}{
		"use1": {}, "use2": {}, "usw1": {}, "usw2": {},
		"cac1": {}, "caw1": {}, "sae1": {},
		"euw1": {}, "euw2": {}, "euw3": {}, "euc1": {}, "eun1": {},
		"mec1": {}, "mes1": {}, "afs1": {},
		"aps1": {}, "apse1": {}, "apse2": {}, "apne1": {}, "apne2": {}, "ape1": {},
	}
	dateFormatSet = map[string]struct{}{
		"DD/MM/YYYY": {}, "MM/DD/YYYY": {}, "YYYY-MM-DD": {},
		"DD-MMM-YYYY": {}, "D MMMM YYYY": {}, "MMMM D, YYYY": {},
	}
	datetimeFormatSet = map[string]struct{}{
		"DD/MM/YYYY HH:mm":   {},
		"MM/DD/YYYY hh:mm a": {},
		"YYYY-MM-DD HH:mm":   {},
		"D MMM YYYY, HH:mm":  {},
	}
	dayCodeSet = map[string]struct{}{
		"mon": {}, "tue": {}, "wed": {}, "thu": {}, "fri": {}, "sat": {}, "sun": {},
	}
	weekStartSet  = map[string]struct{}{"mon": {}, "sun": {}}
	rankMethodSet = map[string]struct{}{"manual": {}, "dragdrop": {}}

	emailRe = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
)

// Get returns the row for subscriptionID, defensively inserting an
// empty row if none exists yet (covers subscriptions created after
// the broken-trigger drop in mig 200 but before the Go seed path).
func (s *Service) Get(ctx context.Context, subscriptionID uuid.UUID) (*Settings, error) {
	row, err := s.read(ctx, subscriptionID)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := s.Pool.Exec(ctx, sqlEnsureTenantRow, subscriptionID); err != nil {
			return nil, err
		}
		return s.read(ctx, subscriptionID)
	}
	return row, err
}

// SeedForSubscription is the explicit seed path called by the
// subscription-create flow. Idempotent via ON CONFLICT DO NOTHING.
// Safe to call repeatedly; safe to fail without leaving a half-state
// (the next Get auto-creates the row).
func (s *Service) SeedForSubscription(ctx context.Context, subscriptionID uuid.UUID) error {
	_, err := s.Pool.Exec(ctx, sqlEnsureTenantRow, subscriptionID)
	return err
}

func (s *Service) read(ctx context.Context, subscriptionID uuid.UUID) (*Settings, error) {
	var x Settings
	err := s.Pool.QueryRow(ctx, sqlSelectTenantSettings, subscriptionID).Scan(
		&x.TenantID, &x.TenantName, &x.TenantDescription, &x.TenantPrimaryContactEmail,
		&x.TenantDataRegion, &x.TenantTimezone, &x.TenantDateFormat, &x.TenantDatetimeFormat,
		&x.TenantWorkdays, &x.TenantWeekStart, &x.TenantRankMethod, &x.TenantBuildChangesetTracking,
		&x.TenantNotes,
		&x.TenantCreatedAt, &x.TenantUpdatedAt, &x.TenantArchivedAt,
	)
	if err != nil {
		return nil, err
	}
	return &x, nil
}

// Patch validates the input then applies a partial update. Returns
// the fresh row on success; *ValidationError on field violations.
func (s *Service) Patch(ctx context.Context, subscriptionID, actorID uuid.UUID, in PatchInput) (*Settings, error) {
	if _, err := s.Get(ctx, subscriptionID); err != nil {
		return nil, err
	}

	violations := []Violation{}

	sets := []string{}
	args := []any{}
	addSet := func(col string, val any) {
		args = append(args, val)
		sets = append(sets, fmt.Sprintf("%s = $%d", col, len(args)))
	}

	if in.TenantName != nil {
		v := strings.TrimSpace(*in.TenantName)
		if v == "" {
			violations = append(violations, Violation{Field: "tenant_name", Message: "required"})
		} else if len(v) > 128 {
			violations = append(violations, Violation{Field: "tenant_name", Message: "must be 128 characters or fewer"})
		} else {
			addSet("master_record_tenants_name", v)
		}
	}
	if in.TenantDescription != nil {
		if len(*in.TenantDescription) > 2000 {
			violations = append(violations, Violation{Field: "tenant_description", Message: "must be 2000 characters or fewer"})
		} else if *in.TenantDescription == "" {
			addSet("master_record_tenants_description", nil)
		} else {
			addSet("master_record_tenants_description", *in.TenantDescription)
		}
	}
	if in.TenantDataRegion != nil {
		if _, ok := regionSet[*in.TenantDataRegion]; !ok {
			violations = append(violations, Violation{Field: "tenant_data_region", Message: "not a valid region code"})
		} else {
			addSet("master_record_tenants_data_region", *in.TenantDataRegion)
		}
	}
	if in.TenantTimezone != nil {
		v := strings.TrimSpace(*in.TenantTimezone)
		if v == "" {
			violations = append(violations, Violation{Field: "tenant_timezone", Message: "required"})
		} else if len(v) > 128 {
			violations = append(violations, Violation{Field: "tenant_timezone", Message: "must be 128 characters or fewer"})
		} else {
			addSet("master_record_tenants_timezone", v)
		}
	}
	if in.TenantDateFormat != nil {
		if _, ok := dateFormatSet[*in.TenantDateFormat]; !ok {
			violations = append(violations, Violation{Field: "tenant_date_format", Message: "not a valid date format"})
		} else {
			addSet("master_record_tenants_date_format", *in.TenantDateFormat)
		}
	}
	if in.TenantDatetimeFormat != nil {
		if _, ok := datetimeFormatSet[*in.TenantDatetimeFormat]; !ok {
			violations = append(violations, Violation{Field: "tenant_datetime_format", Message: "not a valid date/time format"})
		} else {
			addSet("master_record_tenants_datetime_format", *in.TenantDatetimeFormat)
		}
	}
	if in.TenantWorkdays != nil {
		days := *in.TenantWorkdays
		if len(days) == 0 {
			violations = append(violations, Violation{Field: "tenant_workdays", Message: "must include at least one day"})
		} else if len(days) > 7 {
			violations = append(violations, Violation{Field: "tenant_workdays", Message: "no more than seven days"})
		} else {
			seen := map[string]struct{}{}
			bad := false
			for _, d := range days {
				if _, ok := dayCodeSet[d]; !ok {
					bad = true
					break
				}
				seen[d] = struct{}{}
			}
			if bad {
				violations = append(violations, Violation{Field: "tenant_workdays", Message: "must be drawn from mon, tue, wed, thu, fri, sat, sun"})
			} else if len(seen) != len(days) {
				violations = append(violations, Violation{Field: "tenant_workdays", Message: "duplicates not allowed"})
			} else {
				addSet("master_record_tenants_workdays", days)
			}
		}
	}
	if in.TenantWeekStart != nil {
		if _, ok := weekStartSet[*in.TenantWeekStart]; !ok {
			violations = append(violations, Violation{Field: "tenant_week_start", Message: "must be 'mon' or 'sun'"})
		} else {
			addSet("master_record_tenants_week_start", *in.TenantWeekStart)
		}
	}
	if in.TenantRankMethod != nil {
		if _, ok := rankMethodSet[*in.TenantRankMethod]; !ok {
			violations = append(violations, Violation{Field: "tenant_rank_method", Message: "must be 'manual' or 'dragdrop'"})
		} else {
			addSet("master_record_tenants_rank_method", *in.TenantRankMethod)
		}
	}
	if in.TenantBuildChangesetTracking != nil {
		addSet("master_record_tenants_build_changeset_tracking", *in.TenantBuildChangesetTracking)
	}
	if in.TenantNotes != nil {
		if len(*in.TenantNotes) > 4000 {
			violations = append(violations, Violation{Field: "tenant_notes", Message: "must be 4000 characters or fewer"})
		} else if *in.TenantNotes == "" {
			addSet("master_record_tenants_notes", nil)
		} else {
			addSet("master_record_tenants_notes", *in.TenantNotes)
		}
	}
	if in.TenantPrimaryContactEmail != nil {
		v := strings.TrimSpace(*in.TenantPrimaryContactEmail)
		if v == "" {
			addSet("master_record_tenants_primary_contact_email", nil)
		} else if !emailRe.MatchString(v) {
			violations = append(violations, Violation{Field: "tenant_primary_contact_email", Message: "not a valid email address"})
		} else {
			addSet("master_record_tenants_primary_contact_email", v)
		}
	}

	if len(violations) > 0 {
		return nil, &ValidationError{Violations: violations}
	}
	if len(sets) == 0 {
		return s.read(ctx, subscriptionID)
	}

	args = append(args, subscriptionID)
	q := fmt.Sprintf(sqlUpdateTenantTemplate, strings.Join(sets, ", "), len(args))
	if _, err := s.Pool.Exec(ctx, q, args...); err != nil {
		return nil, err
	}
	_ = actorID // future audit hook
	return s.read(ctx, subscriptionID)
}
