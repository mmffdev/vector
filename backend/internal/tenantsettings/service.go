// Package tenantsettings is the SOLE writer for the
// master_record_tenant table in vector_artefacts.
//
// One row exists per workspace (the table's PRIMARY KEY). Get
// auto-creates the row on demand (defensive — covers workspaces
// seeded before mig 036). Patch applies a partial update with full
// server-side validation.
//
// Rewired for M2: reads/writes vector_artefacts (vaPool).
// tenant_owner_user_id is accepted as a bare UUID — cross-DB user
// existence is not validated here; the DB CHECK constraint on
// email format is the only DB-enforced guard.
package tenantsettings

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
// maps 1:1 to a column on master_record_tenant. Pointer types are
// nullable on the wire.
type Settings struct {
	TenantID                     uuid.UUID  `json:"tenant_id"`
	TenantName                   string     `json:"tenant_name"`
	TenantDescription            *string    `json:"tenant_description"`
	TenantOwnerUserID            *uuid.UUID `json:"tenant_owner_user_id"`
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
// "absent = no change". An explicit empty string clears nullable
// text fields; an explicit null on the wire decodes to a nil
// pointer here, treated as "absent" — clearing nullable fields uses
// the empty-string convention for symmetry with the work-items
// PATCH contract.
type PatchInput struct {
	TenantName                   *string   `json:"tenant_name,omitempty"`
	TenantDescription            *string   `json:"tenant_description,omitempty"`
	TenantOwnerUserID            *string   `json:"tenant_owner_user_id,omitempty"`
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

// Violation is a per-field validation error returned to callers as a
// 422 Problem-Details `violations[]` entry.
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

// allowed-value sets, mirrored to the CHECK constraints in mig 126.
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

// Get returns the row for workspaceID, defensively inserting an
// empty row if none exists yet.
func (s *Service) Get(ctx context.Context, workspaceID uuid.UUID) (*Settings, error) {
	row, err := s.read(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := s.Pool.Exec(ctx, sqlEnsureTenantRow, workspaceID); err != nil {
			return nil, err
		}
		return s.read(ctx, workspaceID)
	}
	return row, err
}

func (s *Service) read(ctx context.Context, workspaceID uuid.UUID) (*Settings, error) {
	var x Settings
	err := s.Pool.QueryRow(ctx, sqlSelectTenantSettings, workspaceID).Scan(
		&x.TenantID, &x.TenantName, &x.TenantDescription, &x.TenantOwnerUserID, &x.TenantPrimaryContactEmail,
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
// the fresh row on success. Validation failures return a
// *ValidationError with the offending fields.
func (s *Service) Patch(ctx context.Context, workspaceID, actorID uuid.UUID, in PatchInput) (*Settings, error) {
	if _, err := s.Get(ctx, workspaceID); err != nil {
		return nil, err
	}

	violations := []Violation{}

	// Build SET clauses + args dynamically. updated_at is touched by
	// the BEFORE UPDATE trigger.
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
			addSet("tenant_name", v)
		}
	}
	if in.TenantDescription != nil {
		if len(*in.TenantDescription) > 2000 {
			violations = append(violations, Violation{Field: "tenant_description", Message: "must be 2000 characters or fewer"})
		} else if *in.TenantDescription == "" {
			addSet("tenant_description", nil)
		} else {
			addSet("tenant_description", *in.TenantDescription)
		}
	}
	if in.TenantOwnerUserID != nil {
		v := strings.TrimSpace(*in.TenantOwnerUserID)
		if v == "" {
			addSet("tenant_owner_user_id", nil)
		} else {
			id, err := uuid.Parse(v)
			if err != nil {
				violations = append(violations, Violation{Field: "tenant_owner_user_id", Message: "must be a valid UUID"})
			} else {
				addSet("tenant_owner_user_id", id)
			}
		}
	}
	if in.TenantDataRegion != nil {
		if _, ok := regionSet[*in.TenantDataRegion]; !ok {
			violations = append(violations, Violation{Field: "tenant_data_region", Message: "not a valid region code"})
		} else {
			addSet("tenant_data_region", *in.TenantDataRegion)
		}
	}
	if in.TenantTimezone != nil {
		v := strings.TrimSpace(*in.TenantTimezone)
		if v == "" {
			violations = append(violations, Violation{Field: "tenant_timezone", Message: "required"})
		} else if len(v) > 128 {
			violations = append(violations, Violation{Field: "tenant_timezone", Message: "must be 128 characters or fewer"})
		} else {
			addSet("tenant_timezone", v)
		}
	}
	if in.TenantDateFormat != nil {
		if _, ok := dateFormatSet[*in.TenantDateFormat]; !ok {
			violations = append(violations, Violation{Field: "tenant_date_format", Message: "not a valid date format"})
		} else {
			addSet("tenant_date_format", *in.TenantDateFormat)
		}
	}
	if in.TenantDatetimeFormat != nil {
		if _, ok := datetimeFormatSet[*in.TenantDatetimeFormat]; !ok {
			violations = append(violations, Violation{Field: "tenant_datetime_format", Message: "not a valid date/time format"})
		} else {
			addSet("tenant_datetime_format", *in.TenantDatetimeFormat)
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
				addSet("tenant_workdays", days)
			}
		}
	}
	if in.TenantWeekStart != nil {
		if _, ok := weekStartSet[*in.TenantWeekStart]; !ok {
			violations = append(violations, Violation{Field: "tenant_week_start", Message: "must be 'mon' or 'sun'"})
		} else {
			addSet("tenant_week_start", *in.TenantWeekStart)
		}
	}
	if in.TenantRankMethod != nil {
		if _, ok := rankMethodSet[*in.TenantRankMethod]; !ok {
			violations = append(violations, Violation{Field: "tenant_rank_method", Message: "must be 'manual' or 'dragdrop'"})
		} else {
			addSet("tenant_rank_method", *in.TenantRankMethod)
		}
	}
	if in.TenantBuildChangesetTracking != nil {
		addSet("tenant_build_changeset_tracking", *in.TenantBuildChangesetTracking)
	}
	if in.TenantNotes != nil {
		if len(*in.TenantNotes) > 4000 {
			violations = append(violations, Violation{Field: "tenant_notes", Message: "must be 4000 characters or fewer"})
		} else if *in.TenantNotes == "" {
			addSet("tenant_notes", nil)
		} else {
			addSet("tenant_notes", *in.TenantNotes)
		}
	}
	if in.TenantPrimaryContactEmail != nil {
		v := strings.TrimSpace(*in.TenantPrimaryContactEmail)
		if v == "" {
			addSet("tenant_primary_contact_email", nil)
		} else if !emailRe.MatchString(v) {
			violations = append(violations, Violation{Field: "tenant_primary_contact_email", Message: "not a valid email address"})
		} else {
			addSet("tenant_primary_contact_email", v)
		}
	}

	if len(violations) > 0 {
		return nil, &ValidationError{Violations: violations}
	}
	if len(sets) == 0 {
		// Nothing to do — return current.
		return s.read(ctx, workspaceID)
	}

	args = append(args, workspaceID)
	q := fmt.Sprintf(sqlUpdateTenantTemplate, strings.Join(sets, ", "), len(args))
	if _, err := s.Pool.Exec(ctx, q, args...); err != nil {
		return nil, err
	}
	_ = actorID // future audit hook
	return s.read(ctx, workspaceID)
}
