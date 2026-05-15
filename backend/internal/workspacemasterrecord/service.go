// Package workspacemasterrecord is the SOLE writer for the
// master_record_workspaces table in vector_artefacts.
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
package workspacemasterrecord

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

// Settings is the wire shape returned to the frontend. Every value
// field maps 1:1 to a column on master_record_workspaces. Pointer
// types are nullable on the wire.
//
// PLA-0051 / Story 4 — each of the 11 inheritable fields gains a
// {field}_source sibling carrying one of:
//
//	"workspace"      — workspace row had a non-NULL value (explicit override)
//	"tenant"         — workspace was NULL, tenant default supplied the value
//	"system_default" — both tiers NULL, schema default supplied the value
//
// Old clients reading just the value fields continue to work — they
// receive the resolved value regardless of source. New clients read
// the _source markers to render the inherit/override toggle UI.
type Settings struct {
	TenantID                           uuid.UUID  `json:"tenant_id"`
	TenantName                         string     `json:"tenant_name"`
	TenantDescription                  *string    `json:"tenant_description"`
	TenantDescriptionSource            string     `json:"tenant_description_source,omitempty"`
	TenantOwnerUserID                  *uuid.UUID `json:"tenant_owner_user_id"`
	TenantPrimaryContactEmail          *string    `json:"tenant_primary_contact_email"`
	TenantPrimaryContactEmailSource    string     `json:"tenant_primary_contact_email_source,omitempty"`
	TenantDataRegion                   string     `json:"tenant_data_region"`
	TenantDataRegionSource             string     `json:"tenant_data_region_source,omitempty"`
	TenantTimezone                     string     `json:"tenant_timezone"`
	TenantTimezoneSource               string     `json:"tenant_timezone_source,omitempty"`
	TenantDateFormat                   string     `json:"tenant_date_format"`
	TenantDateFormatSource             string     `json:"tenant_date_format_source,omitempty"`
	TenantDatetimeFormat               string     `json:"tenant_datetime_format"`
	TenantDatetimeFormatSource         string     `json:"tenant_datetime_format_source,omitempty"`
	TenantWorkdays                     []string   `json:"tenant_workdays"`
	TenantWorkdaysSource               string     `json:"tenant_workdays_source,omitempty"`
	TenantWeekStart                    string     `json:"tenant_week_start"`
	TenantWeekStartSource              string     `json:"tenant_week_start_source,omitempty"`
	TenantRankMethod                   string     `json:"tenant_rank_method"`
	TenantRankMethodSource             string     `json:"tenant_rank_method_source,omitempty"`
	TenantBuildChangesetTracking       bool       `json:"tenant_build_changeset_tracking"`
	TenantBuildChangesetTrackingSource string     `json:"tenant_build_changeset_tracking_source,omitempty"`
	TenantNotes                        *string    `json:"tenant_notes"`
	TenantNotesSource                  string     `json:"tenant_notes_source,omitempty"`
	TenantCreatedAt                    time.Time  `json:"tenant_created_at"`
	TenantUpdatedAt                    time.Time  `json:"tenant_updated_at"`
	TenantArchivedAt                   *time.Time `json:"tenant_archived_at"`
}

// Source values written to Settings.{Field}Source. Defined as constants
// so the COALESCE merge logic in Service.Get (Story 3) doesn't proliferate
// magic strings; tests reference the literals directly.
const (
	SourceWorkspace     = "workspace"
	SourceTenant        = "tenant"
	SourceSystemDefault = "system_default"
)

// PatchInput is the partial update payload. Pointer fields are
// "absent = no change". An explicit empty string clears nullable
// text fields; an explicit null on the wire decodes to a nil
// pointer here, treated as "absent" — clearing nullable fields uses
// the empty-string convention for symmetry with the work-items
// PATCH contract.
//
// PLA-0051 / Story 5: ClearOverrides nulls workspace columns so the
// row falls back to inheriting from tenantmasterrecord. Each entry
// must be one of the canonical inheritable-field JSON names (see
// inheritableFieldColumn map in this file). Fields listed here are
// applied AFTER any explicit value patches in the same request, so
// {tenant_timezone: "Asia/Tokyo", clear_overrides: ["tenant_timezone"]}
// resolves to "clear" — the explicit value is overridden by the
// clear. (Documenting the conflict path; UI never sends both.)
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
	ClearOverrides               []string  `json:"clear_overrides,omitempty"`
}

// inheritableFieldColumn maps the JSON name of an inheritable field
// to its DB column. Used by ClearOverrides processing in Service.Patch
// (Story 5) — entries not in this map are rejected as ErrInvalidInput.
var inheritableFieldColumn = map[string]string{
	"tenant_data_region":              "master_record_workspaces_data_region",
	"tenant_timezone":                 "master_record_workspaces_timezone",
	"tenant_date_format":              "master_record_workspaces_date_format",
	"tenant_datetime_format":          "master_record_workspaces_datetime_format",
	"tenant_workdays":                 "master_record_workspaces_workdays",
	"tenant_week_start":               "master_record_workspaces_week_start",
	"tenant_rank_method":              "master_record_workspaces_rank_method",
	"tenant_build_changeset_tracking": "master_record_workspaces_build_changeset_tracking",
	"tenant_primary_contact_email":    "master_record_workspaces_primary_contact_email",
	"tenant_description":              "master_record_workspaces_description",
	"tenant_notes":                    "master_record_workspaces_notes",
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

// TenantDefaultsReader is the narrow contract Service.Get uses to fetch
// a workspace's tenant-tier defaults for the COALESCE merge. Satisfied
// by tenantmasterrecord.Service in production; tests inject a fake.
//
// PLA-0051 / Story 3. Returning ErrNotFound or "tenant archived"
// (caller-detected via TenantArchivedAt) falls inheritance through to
// schema defaults.
type TenantDefaultsReader interface {
	Get(ctx context.Context, subscriptionID uuid.UUID) (*tenantSettings, error)
}

// SubscriptionResolver maps a workspace ID to the subscription that
// owns it. Production reads fdw_workspaces (FDW shadow over
// mmff_vector.master_record_workspaces) via FDWSubscriptionResolver;
// tests inject a fake that returns a stashed mapping.
//
// Returning ErrNotFound is non-fatal — Service.Get treats it as "no
// tenant tier to inherit from" and falls to schema defaults.
type SubscriptionResolver interface {
	SubscriptionFor(ctx context.Context, workspaceID uuid.UUID) (uuid.UUID, error)
}

// tenantSettings mirrors the subset of tenantmasterrecord.Settings the
// merge needs. Declared locally so this package doesn't import
// tenantmasterrecord directly (avoids a dependency cycle once
// tenantmasterrecord eventually wants to call workspacemasterrecord
// for something else). The production wiring in main.go adapts
// tenantmasterrecord.Service.Get's return value to this shape.
type tenantSettings struct {
	DataRegion                *string
	Timezone                  *string
	DateFormat                *string
	DatetimeFormat            *string
	Workdays                  []string // nil = NULL on the row
	WeekStart                 *string
	RankMethod                *string
	BuildChangesetTracking    *bool
	PrimaryContactEmail       *string
	Description               *string
	Notes                     *string
	ArchivedAt                *time.Time
}

// Service is the sole-writer surface.
type Service struct {
	Pool       *pgxpool.Pool
	TenantsDR  TenantDefaultsReader   // optional; nil = no inheritance, fall to schema defaults
	SubsResolver SubscriptionResolver // optional; nil = no inheritance
}

func New(pool *pgxpool.Pool) *Service { return &Service{Pool: pool} }

// WithInheritance wires the resolver + tenant reader used by Service.Get
// to perform the COALESCE merge. main.go calls this once both services
// exist. If either is nil, inheritance is disabled and Service.Get
// returns workspace-row values verbatim with source=workspace (or
// system_default if NULL post-mig-069).
func (s *Service) WithInheritance(r SubscriptionResolver, t TenantDefaultsReader) *Service {
	s.SubsResolver = r
	s.TenantsDR = t
	return s
}

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

// Get returns the row for workspaceID with inheritance applied —
// the COALESCE merge from tenantmasterrecord plus per-field source
// markers (PLA-0051 / Story 3). Defensively inserts an empty row if
// the workspace has no settings yet.
func (s *Service) Get(ctx context.Context, workspaceID uuid.UUID) (*Settings, error) {
	raw, err := s.readRaw(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		if _, err := s.Pool.Exec(ctx, sqlEnsureTenantRow, workspaceID); err != nil {
			return nil, err
		}
		raw, err = s.readRaw(ctx, workspaceID)
	}
	if err != nil {
		return nil, err
	}
	return s.mergeInheritance(ctx, workspaceID, raw), nil
}

// rawSettings is the workspace row exactly as read from
// master_record_workspaces — inheritable columns are nullable
// pointers so the merge can distinguish NULL (inherit) from a
// non-NULL workspace override. Non-inheritable identity/audit
// columns stay as value types.
type rawSettings struct {
	TenantID                     uuid.UUID
	TenantName                   string
	TenantDescription            *string
	TenantOwnerUserID            *uuid.UUID
	TenantPrimaryContactEmail    *string
	TenantDataRegion             *string
	TenantTimezone               *string
	TenantDateFormat             *string
	TenantDatetimeFormat         *string
	TenantWorkdays               []string // pgx: array column scans as []string; NULL → nil
	TenantWeekStart              *string
	TenantRankMethod             *string
	TenantBuildChangesetTracking *bool
	TenantNotes                  *string
	TenantCreatedAt              time.Time
	TenantUpdatedAt              time.Time
	TenantArchivedAt             *time.Time
}

// readRaw fetches one workspace row with inheritable columns as
// pointers so NULL is detectable.
func (s *Service) readRaw(ctx context.Context, workspaceID uuid.UUID) (*rawSettings, error) {
	var x rawSettings
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

// schema defaults — mirror the column defaults in vector_artefacts
// migration 067. Used as the system_default fallback when neither
// workspace nor tenant supplies a value. Kept here so the merge logic
// is one file; if the DB defaults shift, this list shifts with them.
var (
	defaultDataRegion             = "use1"
	defaultTimezone               = "Europe/London"
	defaultDateFormat             = "DD/MM/YYYY"
	defaultDatetimeFormat         = "DD/MM/YYYY HH:mm"
	defaultWorkdays               = []string{"mon", "tue", "wed", "thu", "fri"}
	defaultWeekStart              = "mon"
	defaultRankMethod             = "dragdrop"
	defaultBuildChangesetTracking = false
)

// mergeInheritance applies the COALESCE merge from raw workspace +
// tenant defaults + schema defaults and stamps the per-field source
// markers. Tenant lookup is best-effort: if the SubscriptionResolver
// or TenantDefaultsReader is unwired, or either returns an error or
// the tenant is archived, the merge falls through to schema defaults.
func (s *Service) mergeInheritance(ctx context.Context, workspaceID uuid.UUID, raw *rawSettings) *Settings {
	out := &Settings{
		TenantID:          raw.TenantID,
		TenantName:        raw.TenantName,
		TenantOwnerUserID: raw.TenantOwnerUserID,
		TenantCreatedAt:   raw.TenantCreatedAt,
		TenantUpdatedAt:   raw.TenantUpdatedAt,
		TenantArchivedAt:  raw.TenantArchivedAt,
	}

	// Best-effort tenant lookup. Failures are non-fatal — fall to defaults.
	var tenant *tenantSettings
	if s.SubsResolver != nil && s.TenantsDR != nil {
		subID, err := s.SubsResolver.SubscriptionFor(ctx, workspaceID)
		if err == nil {
			if t, terr := s.TenantsDR.Get(ctx, subID); terr == nil && t != nil {
				// Treat an archived tenant as "no tenant tier" — falls
				// through to schema defaults (test 8).
				if t.ArchivedAt == nil {
					tenant = t
				}
			}
		}
	}

	// ─── per-field merge helpers ───────────────────────────────────
	// String case — workspace value (nullable *string) wins, then
	// tenant value (nullable *string), then schema default.
	mergeString := func(ws *string, tn *string, dflt string) (string, string) {
		if ws != nil {
			return *ws, SourceWorkspace
		}
		if tn != nil {
			return *tn, SourceTenant
		}
		return dflt, SourceSystemDefault
	}
	mergeStringPtr := func(ws *string, tn *string) (*string, string) {
		// Inheritable string fields stored as nullable text on the
		// table (description, notes, primary_contact_email). NULL on
		// workspace + tenant means "no value" — wire shape carries
		// nil with source=system_default.
		if ws != nil {
			return ws, SourceWorkspace
		}
		if tn != nil {
			return tn, SourceTenant
		}
		return nil, SourceSystemDefault
	}
	mergeBool := func(ws *bool, tn *bool, dflt bool) (bool, string) {
		if ws != nil {
			return *ws, SourceWorkspace
		}
		if tn != nil {
			return *tn, SourceTenant
		}
		return dflt, SourceSystemDefault
	}
	mergeWorkdays := func(ws []string, tn []string, dflt []string) ([]string, string) {
		if ws != nil {
			return ws, SourceWorkspace
		}
		if tn != nil {
			return tn, SourceTenant
		}
		return dflt, SourceSystemDefault
	}

	// tenant-side accessors guard against nil tenant.
	getTenantStr := func(f func(*tenantSettings) *string) *string {
		if tenant == nil {
			return nil
		}
		return f(tenant)
	}
	getTenantBool := func(f func(*tenantSettings) *bool) *bool {
		if tenant == nil {
			return nil
		}
		return f(tenant)
	}
	getTenantWorkdays := func() []string {
		if tenant == nil {
			return nil
		}
		return tenant.Workdays
	}

	out.TenantDataRegion, out.TenantDataRegionSource = mergeString(
		raw.TenantDataRegion, getTenantStr(func(t *tenantSettings) *string { return t.DataRegion }), defaultDataRegion)
	out.TenantTimezone, out.TenantTimezoneSource = mergeString(
		raw.TenantTimezone, getTenantStr(func(t *tenantSettings) *string { return t.Timezone }), defaultTimezone)
	out.TenantDateFormat, out.TenantDateFormatSource = mergeString(
		raw.TenantDateFormat, getTenantStr(func(t *tenantSettings) *string { return t.DateFormat }), defaultDateFormat)
	out.TenantDatetimeFormat, out.TenantDatetimeFormatSource = mergeString(
		raw.TenantDatetimeFormat, getTenantStr(func(t *tenantSettings) *string { return t.DatetimeFormat }), defaultDatetimeFormat)
	out.TenantWorkdays, out.TenantWorkdaysSource = mergeWorkdays(
		raw.TenantWorkdays, getTenantWorkdays(), defaultWorkdays)
	out.TenantWeekStart, out.TenantWeekStartSource = mergeString(
		raw.TenantWeekStart, getTenantStr(func(t *tenantSettings) *string { return t.WeekStart }), defaultWeekStart)
	out.TenantRankMethod, out.TenantRankMethodSource = mergeString(
		raw.TenantRankMethod, getTenantStr(func(t *tenantSettings) *string { return t.RankMethod }), defaultRankMethod)
	out.TenantBuildChangesetTracking, out.TenantBuildChangesetTrackingSource = mergeBool(
		raw.TenantBuildChangesetTracking, getTenantBool(func(t *tenantSettings) *bool { return t.BuildChangesetTracking }), defaultBuildChangesetTracking)
	out.TenantPrimaryContactEmail, out.TenantPrimaryContactEmailSource = mergeStringPtr(
		raw.TenantPrimaryContactEmail, getTenantStr(func(t *tenantSettings) *string { return t.PrimaryContactEmail }))
	out.TenantDescription, out.TenantDescriptionSource = mergeStringPtr(
		raw.TenantDescription, getTenantStr(func(t *tenantSettings) *string { return t.Description }))
	out.TenantNotes, out.TenantNotesSource = mergeStringPtr(
		raw.TenantNotes, getTenantStr(func(t *tenantSettings) *string { return t.Notes }))

	return out
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
			addSet("master_record_workspaces_name", v)
		}
	}
	if in.TenantDescription != nil {
		if len(*in.TenantDescription) > 2000 {
			violations = append(violations, Violation{Field: "tenant_description", Message: "must be 2000 characters or fewer"})
		} else if *in.TenantDescription == "" {
			addSet("master_record_workspaces_description", nil)
		} else {
			addSet("master_record_workspaces_description", *in.TenantDescription)
		}
	}
	if in.TenantOwnerUserID != nil {
		v := strings.TrimSpace(*in.TenantOwnerUserID)
		if v == "" {
			addSet("master_record_workspaces_id_user_owner", nil)
		} else {
			id, err := uuid.Parse(v)
			if err != nil {
				violations = append(violations, Violation{Field: "tenant_owner_user_id", Message: "must be a valid UUID"})
			} else {
				addSet("master_record_workspaces_id_user_owner", id)
			}
		}
	}
	if in.TenantDataRegion != nil {
		if _, ok := regionSet[*in.TenantDataRegion]; !ok {
			violations = append(violations, Violation{Field: "tenant_data_region", Message: "not a valid region code"})
		} else {
			addSet("master_record_workspaces_data_region", *in.TenantDataRegion)
		}
	}
	if in.TenantTimezone != nil {
		v := strings.TrimSpace(*in.TenantTimezone)
		if v == "" {
			violations = append(violations, Violation{Field: "tenant_timezone", Message: "required"})
		} else if len(v) > 128 {
			violations = append(violations, Violation{Field: "tenant_timezone", Message: "must be 128 characters or fewer"})
		} else {
			addSet("master_record_workspaces_timezone", v)
		}
	}
	if in.TenantDateFormat != nil {
		if _, ok := dateFormatSet[*in.TenantDateFormat]; !ok {
			violations = append(violations, Violation{Field: "tenant_date_format", Message: "not a valid date format"})
		} else {
			addSet("master_record_workspaces_date_format", *in.TenantDateFormat)
		}
	}
	if in.TenantDatetimeFormat != nil {
		if _, ok := datetimeFormatSet[*in.TenantDatetimeFormat]; !ok {
			violations = append(violations, Violation{Field: "tenant_datetime_format", Message: "not a valid date/time format"})
		} else {
			addSet("master_record_workspaces_datetime_format", *in.TenantDatetimeFormat)
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
				addSet("master_record_workspaces_workdays", days)
			}
		}
	}
	if in.TenantWeekStart != nil {
		if _, ok := weekStartSet[*in.TenantWeekStart]; !ok {
			violations = append(violations, Violation{Field: "tenant_week_start", Message: "must be 'mon' or 'sun'"})
		} else {
			addSet("master_record_workspaces_week_start", *in.TenantWeekStart)
		}
	}
	if in.TenantRankMethod != nil {
		if _, ok := rankMethodSet[*in.TenantRankMethod]; !ok {
			violations = append(violations, Violation{Field: "tenant_rank_method", Message: "must be 'manual' or 'dragdrop'"})
		} else {
			addSet("master_record_workspaces_rank_method", *in.TenantRankMethod)
		}
	}
	if in.TenantBuildChangesetTracking != nil {
		addSet("master_record_workspaces_build_changeset_tracking", *in.TenantBuildChangesetTracking)
	}
	if in.TenantNotes != nil {
		if len(*in.TenantNotes) > 4000 {
			violations = append(violations, Violation{Field: "tenant_notes", Message: "must be 4000 characters or fewer"})
		} else if *in.TenantNotes == "" {
			addSet("master_record_workspaces_notes", nil)
		} else {
			addSet("master_record_workspaces_notes", *in.TenantNotes)
		}
	}
	if in.TenantPrimaryContactEmail != nil {
		v := strings.TrimSpace(*in.TenantPrimaryContactEmail)
		if v == "" {
			addSet("master_record_workspaces_primary_contact_email", nil)
		} else if !emailRe.MatchString(v) {
			violations = append(violations, Violation{Field: "tenant_primary_contact_email", Message: "not a valid email address"})
		} else {
			addSet("master_record_workspaces_primary_contact_email", v)
		}
	}

	// PLA-0051 Story 5: ClearOverrides nulls workspace columns so the
	// row falls back to inheriting from tenantmasterrecord. Validate
	// names first; bad entries become violations rather than rebuild
	// of the SET clauses for an invalid request.
	clearCols := make(map[string]struct{}, len(in.ClearOverrides))
	for _, name := range in.ClearOverrides {
		col, ok := inheritableFieldColumn[name]
		if !ok {
			violations = append(violations, Violation{
				Field:   "clear_overrides",
				Message: fmt.Sprintf("unknown inheritable field %q", name),
			})
			continue
		}
		clearCols[col] = struct{}{}
	}

	if len(violations) > 0 {
		return nil, &ValidationError{Violations: violations}
	}

	// If any clears collide with explicit-value patches for the same
	// column, rebuild sets+args so the clear wins (documented contract
	// in PatchInput.ClearOverrides godoc). Same-named field in both
	// halves of a single request → clear wins. Cheap rebuild — Patch
	// volume is tiny.
	if len(clearCols) > 0 {
		newSets := make([]string, 0, len(sets)+len(clearCols))
		newArgs := make([]any, 0, len(args)+len(clearCols))
		addNewSet := func(col string, val any) {
			newArgs = append(newArgs, val)
			newSets = append(newSets, fmt.Sprintf("%s = $%d", col, len(newArgs)))
		}
		// Preserve original explicit-value patches except those being
		// cleared. Original order of `sets` mirrors `args`; iterate
		// both in lockstep.
		for i, clause := range sets {
			// `clause` is "<col> = $N" — extract <col>.
			eq := strings.IndexByte(clause, ' ')
			col := clause[:eq]
			if _, clearing := clearCols[col]; clearing {
				continue // skip; the clear added below wins
			}
			addNewSet(col, args[i])
		}
		for col := range clearCols {
			addNewSet(col, nil)
		}
		sets, args = newSets, newArgs
	}

	if len(sets) == 0 {
		// Nothing to do — return current.
		return s.Get(ctx, workspaceID)
	}

	args = append(args, workspaceID)
	q := fmt.Sprintf(sqlUpdateTenantTemplate, strings.Join(sets, ", "), len(args))
	if _, err := s.Pool.Exec(ctx, q, args...); err != nil {
		return nil, err
	}
	_ = actorID // future audit hook
	return s.Get(ctx, workspaceID)
}
