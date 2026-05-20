package fields

// Service is the sole writer/reader boundary for the field-scope HTTP
// surface (PLA-0039 / Story 00526, B22.6). The handler in this package
// MUST go through Service for all DB I/O — `lint:no-db-in-handlers`
// enforces this. Two concrete capabilities live here:
//
//   - AssertCallerMayRead: tenancy + membership gate against mmff_vector
//     (master_record_workspaces + roles_workspaces).
//   - LoadAdmittedFields:  bulk lookup of admitted artefacts_fields_library
//     rows for a (workspace, tenant) pair against vector_artefacts.
//
// vectorPool MUST be non-nil. artefactsPool MAY be nil — when the
// VECTOR_ARTEFACTS_DB_URL is unset at boot the handler short-circuits
// to an empty fields slice rather than 500-ing. LoadAdmittedFields
// returns ErrArtefactsPoolMissing in that configuration so callers can
// distinguish "no pool wired" from "no rows match".

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/roles"
	"github.com/mmffdev/vector-backend/internal/roletypes"
)

// Sentinel errors. Handler maps these to HTTP statuses.
var (
	ErrWorkspaceNotFound    = errors.New("workspace not found")
	ErrForbidden            = errors.New("forbidden")
	ErrArtefactsPoolMissing = errors.New("vector_artefacts pool not configured")
	ErrFieldNameRequired    = errors.New("field name is required")
	ErrFieldLabelRequired   = errors.New("field label is required")
	ErrFieldTypeRequired    = errors.New("field data_type is required")
	ErrFieldTypeInvalid     = errors.New("field data_type is not one of the allowed values")
	ErrFieldScopeInvalid    = errors.New("field scope must be 'tenant' or 'workspace'")
	// ErrFieldNotFoundWriter — Update/Archive on a row that does not
	// exist (or was already archived). Distinct from resolver.go's
	// ErrFieldNotFound which lives on a different code-path. Writer
	// callers translate this to 404.
	ErrFieldNotFoundWriter = errors.New("field not found")
	// ErrFieldTypeChangeBlocked — Update rejected because the caller
	// asked to change data_type after artefacts_fields_values rows
	// already reference the field. Translates to 409 Conflict.
	ErrFieldTypeChangeBlocked = errors.New("field data_type cannot be changed once values exist")
	// ErrFieldDuplicateName — Create/Update hit the (subscription_id,
	// field_name) unique index for live rows. Translates to 409 Conflict.
	ErrFieldDuplicateName = errors.New("field name already in use")
)

// Service holds the two pools and exposes capability methods. Construct
// via NewService — callers MUST NOT zero-init.
type Service struct {
	vectorPool    *pgxpool.Pool
	artefactsPool *pgxpool.Pool
}

// NewService wires the service. vectorPool is required; artefactsPool
// may be nil. Mirrors NewHandler's old contract one-for-one.
func NewService(vectorPool, artefactsPool *pgxpool.Pool) *Service {
	return &Service{vectorPool: vectorPool, artefactsPool: artefactsPool}
}

// HasArtefactsPool reports whether the vector_artefacts pool was wired
// at boot. The handler uses this to short-circuit to an empty response
// rather than calling LoadAdmittedFields and getting ErrArtefactsPoolMissing.
func (s *Service) HasArtefactsPool() bool { return s.artefactsPool != nil }

// FieldRow is the canonical service-layer shape for one admitted row.
// The handler renames json tags via fieldRowOut; the service stays
// transport-agnostic (struct tags are inert here).
type FieldRow struct {
	ID             uuid.UUID
	SubscriptionID *uuid.UUID
	FieldName      string
	Label          string
	FieldType      string
	OptionsJSON    json.RawMessage
	ConfigJSON     json.RawMessage
	Description    *string
	Scope          string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// AssertCallerMayRead returns nil iff the caller can read the field set
// for wsID. Returns ErrWorkspaceNotFound, ErrForbidden, or a plumbing
// error. See handler.go for the full rule semantics — this method is a
// straight extraction.
func (s *Service) AssertCallerMayRead(ctx context.Context, wsID uuid.UUID, u *roletypes.User) error {
	var wsTenant uuid.UUID
	err := s.vectorPool.QueryRow(ctx, sqlSelectWorkspaceTenant, wsID).Scan(&wsTenant)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkspaceNotFound
	}
	if err != nil {
		return err
	}
	if wsTenant != u.SubscriptionID {
		return ErrWorkspaceNotFound
	}
	if u.RoleID == roles.SystemGrpGlobalID || u.RoleID == roles.SystemGrpPortfolioID {
		return nil
	}
	var member bool
	err = s.vectorPool.QueryRow(ctx, sqlExistsActiveWorkspaceMembership, u.ID, wsID).Scan(&member)
	if err != nil {
		return err
	}
	if !member {
		return ErrForbidden
	}
	return nil
}

// AssertCallerMayWrite is the write-side gate for POST/PATCH/DELETE on
// /workspaces/{id}/fields. The rule matrix (server-side, defence in
// depth — frontend role checks are UX-only):
//
//   - scope='global'    → ALWAYS denied through this surface. Global
//                         rows are owned by vector_admin tooling and
//                         must not be reachable from a workspace path,
//                         even by gadmin/padmin.
//   - scope='workspace' → caller must be tenant-admin (grp_global,
//                         grp_portfolio) OR hold an active role grant
//                         on the workspace.
//   - scope='tenant'    → caller must be tenant-admin (grp_global,
//                         grp_portfolio). Workspace members get 403.
//   - anything else     → ErrFieldScopeInvalid (handler → 400).
//
// Workspace + tenancy is always re-checked: the workspace must belong
// to the caller's tenant (else ErrWorkspaceNotFound — same shape as
// "does not exist" so existence is not leaked).
func (s *Service) AssertCallerMayWrite(
	ctx context.Context,
	wsID uuid.UUID,
	u *roletypes.User,
	scope string,
) error {
	// Scope-clamp comes first so even a tenant-admin cannot smuggle
	// scope='global' past the gate via this surface.
	switch scope {
	case "global":
		return ErrForbidden
	case "tenant", "workspace":
		// fall through to tenancy + role checks
	default:
		return ErrFieldScopeInvalid
	}

	// Workspace must belong to caller's tenant. Same shape as the read
	// gate — cross-tenant probes get ErrWorkspaceNotFound.
	var wsTenant uuid.UUID
	err := s.vectorPool.QueryRow(ctx, sqlSelectWorkspaceTenant, wsID).Scan(&wsTenant)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrWorkspaceNotFound
	}
	if err != nil {
		return err
	}
	if wsTenant != u.SubscriptionID {
		return ErrWorkspaceNotFound
	}

	isTenantAdmin := u.RoleID == roles.SystemGrpGlobalID ||
		u.RoleID == roles.SystemGrpPortfolioID

	if scope == "tenant" {
		// Tenant-scope rows are padmin/gadmin only — workspace
		// members cannot create or mutate library entries that
		// apply tenant-wide.
		if !isTenantAdmin {
			return ErrForbidden
		}
		return nil
	}

	// scope == "workspace": tenant admin bypasses membership; everyone
	// else needs an active role grant on the workspace.
	if isTenantAdmin {
		return nil
	}
	var member bool
	err = s.vectorPool.QueryRow(ctx,
		sqlExistsActiveWorkspaceMembership, u.ID, wsID).Scan(&member)
	if err != nil {
		return err
	}
	if !member {
		return ErrForbidden
	}
	return nil
}

// allowedFieldTypes mirrors the CHECK constraint on
// artefacts_fields_library.field_type. Listed in the order the column
// constraint lists them; keep in sync with the schema if the constraint
// is ever extended.
var allowedFieldTypes = map[string]struct{}{
	"textbox": {}, "richtext": {}, "integer": {}, "decimal": {},
	"date": {}, "boolean": {}, "select": {}, "multiselect": {},
	"radio": {}, "user": {}, "url": {},
}

// CreateFieldInput is the service-layer payload for CreateWorkspaceField.
// Names mirror the wire shape on the handler (handler decodes the JSON
// body into this struct directly — keeps the conversion trivial).
type CreateFieldInput struct {
	WorkspaceID uuid.UUID
	Name        string          // → field_name (lower_snake_case slug)
	Label       string          // → label (human display)
	DataType    string          // → field_type
	Scope       string          // "tenant" | "workspace" — "global" rejected by gate
	OptionsJSON json.RawMessage // optional
	ConfigJSON  json.RawMessage // optional
	Description *string         // optional
}

// validate runs purely-syntactic checks against the input. Returns one of
// the ErrField* sentinels — handler maps them to 400.
func (in CreateFieldInput) validate() error {
	if in.Name == "" {
		return ErrFieldNameRequired
	}
	if in.Label == "" {
		return ErrFieldLabelRequired
	}
	if in.DataType == "" {
		return ErrFieldTypeRequired
	}
	if _, ok := allowedFieldTypes[in.DataType]; !ok {
		return ErrFieldTypeInvalid
	}
	if in.Scope != "tenant" && in.Scope != "workspace" {
		return ErrFieldScopeInvalid
	}
	return nil
}

// CreateWorkspaceField inserts one row into artefacts_fields_library and,
// for scope='workspace', the matching admit row into workspaces_fields.
// Returns the hydrated row so the handler can echo it without a round-trip.
//
// Pre-conditions:
//   - AssertCallerMayWrite has already cleared (caller passes u.SubscriptionID
//     + in.Scope to it).
//   - artefactsPool is non-nil — returns ErrArtefactsPoolMissing otherwise so
//     the handler can 503 cleanly.
func (s *Service) CreateWorkspaceField(
	ctx context.Context,
	tenantID uuid.UUID,
	createdBy uuid.UUID,
	in CreateFieldInput,
) (*FieldRow, error) {
	if s.artefactsPool == nil {
		return nil, ErrArtefactsPoolMissing
	}
	if err := in.validate(); err != nil {
		return nil, err
	}

	// scope='workspace' / 'tenant' both require a tenant — pass it in
	// directly. (scope='global' is forbidden upstream by the write gate
	// so we never need to NULL out subscription_id here.)
	var optsArg, cfgArg any
	if len(in.OptionsJSON) > 0 {
		optsArg = []byte(in.OptionsJSON)
	}
	if len(in.ConfigJSON) > 0 {
		cfgArg = []byte(in.ConfigJSON)
	}
	var descArg any
	if in.Description != nil {
		descArg = *in.Description
	}

	tx, err := s.artefactsPool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		row         FieldRow
		optionsJSON []byte
		configJSON  []byte
	)
	err = tx.QueryRow(ctx, sqlInsertFieldLibrary,
		tenantID,
		in.Name,
		in.Label,
		in.DataType,
		optsArg,
		cfgArg,
		descArg,
		in.Scope,
	).Scan(
		&row.ID,
		&row.SubscriptionID,
		&row.FieldName,
		&row.Label,
		&row.FieldType,
		&optionsJSON,
		&configJSON,
		&row.Description,
		&row.Scope,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrFieldDuplicateName
		}
		return nil, err
	}
	if len(optionsJSON) > 0 {
		row.OptionsJSON = json.RawMessage(optionsJSON)
	}
	if len(configJSON) > 0 {
		row.ConfigJSON = json.RawMessage(configJSON)
	}

	// scope='workspace' rows are deny-by-default — admit the field
	// into the workspace that just created it so it's visible to its
	// own page. scope='tenant' rows don't need an admit row (the
	// resolver admits them on subscription match alone).
	if in.Scope == "workspace" {
		if _, err := tx.Exec(ctx, sqlInsertWorkspaceFieldAdmit,
			in.WorkspaceID, row.ID, createdBy); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &row, nil
}

// UpdateFieldInput is the sparse-patch input for UpdateWorkspaceField.
// Every pointer is "leave alone if nil"; set it to the new value to
// patch the column. DataType is special — see ErrFieldTypeChangeBlocked.
type UpdateFieldInput struct {
	FieldID     uuid.UUID
	Label       *string
	DataType    *string
	OptionsJSON json.RawMessage // empty → leave alone
	ConfigJSON  json.RawMessage // empty → leave alone
	Description *string
}

// UpdateWorkspaceField patches one artefacts_fields_library row. Enforces:
//
//   - field exists and is live (else ErrFieldNotFoundWriter).
//   - row's tenant matches the caller's tenant (else ErrForbidden — defence
//     in depth on top of the workspace/tenant gate; the row could belong
//     to a different tenant if a stale id is replayed).
//   - if DataType changes, no artefacts_fields_values rows reference the
//     field (else ErrFieldTypeChangeBlocked → 409).
//   - new DataType is in the allow-list (else ErrFieldTypeInvalid → 400).
//   - field_name is NOT patchable — the slug is the stable identity and
//     changing it would break any external reference. Archive + recreate
//     is the supported migration path.
func (s *Service) UpdateWorkspaceField(
	ctx context.Context,
	tenantID uuid.UUID,
	in UpdateFieldInput,
) (*FieldRow, error) {
	if s.artefactsPool == nil {
		return nil, ErrArtefactsPoolMissing
	}

	// Re-fetch the row so we know the live data_type + tenant. Don't
	// trust the caller's view of these.
	var (
		existing       FieldRow
		archivedAt     *time.Time
		optionsJSON    []byte
		configJSON     []byte
	)
	err := s.artefactsPool.QueryRow(ctx, sqlSelectFieldLibraryFull, in.FieldID).Scan(
		&existing.ID,
		&existing.SubscriptionID,
		&existing.FieldName,
		&existing.Label,
		&existing.FieldType,
		&optionsJSON,
		&configJSON,
		&existing.Description,
		&existing.Scope,
		&existing.CreatedAt,
		&existing.UpdatedAt,
		&archivedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrFieldNotFoundWriter
	}
	if err != nil {
		return nil, err
	}
	if archivedAt != nil {
		return nil, ErrFieldNotFoundWriter
	}
	// Tenant clamp — scope='global' rows have NULL subscription_id and
	// cannot be patched through this surface. Tenant/workspace rows
	// must belong to caller's tenant.
	if existing.SubscriptionID == nil || *existing.SubscriptionID != tenantID {
		return nil, ErrForbidden
	}

	// DataType-change gate: same value is a no-op; different value is
	// allowed only if no values reference the field yet.
	if in.DataType != nil && *in.DataType != existing.FieldType {
		if _, ok := allowedFieldTypes[*in.DataType]; !ok {
			return nil, ErrFieldTypeInvalid
		}
		var n int64
		if err := s.artefactsPool.QueryRow(ctx, sqlCountFieldValues, existing.ID).Scan(&n); err != nil {
			return nil, err
		}
		if n > 0 {
			return nil, ErrFieldTypeChangeBlocked
		}
	}

	// COALESCE-style sparse patch — pass nil for "leave alone".
	var labelArg, typeArg, descArg any
	if in.Label != nil {
		labelArg = *in.Label
	}
	if in.DataType != nil {
		typeArg = *in.DataType
	}
	if in.Description != nil {
		descArg = *in.Description
	}
	var optsArg, cfgArg any
	if len(in.OptionsJSON) > 0 {
		optsArg = []byte(in.OptionsJSON)
	}
	if len(in.ConfigJSON) > 0 {
		cfgArg = []byte(in.ConfigJSON)
	}

	var (
		row     FieldRow
		oj, cj  []byte
	)
	err = s.artefactsPool.QueryRow(ctx, sqlUpdateFieldLibrary,
		in.FieldID, labelArg, typeArg, optsArg, cfgArg, descArg,
	).Scan(
		&row.ID,
		&row.SubscriptionID,
		&row.FieldName,
		&row.Label,
		&row.FieldType,
		&oj,
		&cj,
		&row.Description,
		&row.Scope,
		&row.CreatedAt,
		&row.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		// Lost to a concurrent archive between fetch and update.
		return nil, ErrFieldNotFoundWriter
	}
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrFieldDuplicateName
		}
		return nil, err
	}
	if len(oj) > 0 {
		row.OptionsJSON = json.RawMessage(oj)
	}
	if len(cj) > 0 {
		row.ConfigJSON = json.RawMessage(cj)
	}
	return &row, nil
}

// ArchiveWorkspaceField soft-deletes one artefacts_fields_library row
// (sets archived_at = now()). Pre-conditions mirror Update: row must
// exist, be live, and belong to caller's tenant.
//
// Soft-delete is intentional — existing artefacts_fields_values rows
// keep their data; the field just disappears from new pickers. The List
// query already filters archived_at IS NULL so the row vanishes from
// the admitted set automatically.
func (s *Service) ArchiveWorkspaceField(
	ctx context.Context,
	tenantID uuid.UUID,
	fieldID uuid.UUID,
) error {
	if s.artefactsPool == nil {
		return ErrArtefactsPoolMissing
	}

	// Pre-fetch for tenant + scope clamp. Same defence-in-depth move
	// as Update — don't let a stale fieldID slip past the gate.
	var (
		subID    *uuid.UUID
		scope    string
		archived *time.Time
	)
	err := s.artefactsPool.QueryRow(ctx, sqlSelectFieldLibraryGate, fieldID).
		Scan(&subID, &scope, &archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrFieldNotFoundWriter
	}
	if err != nil {
		return err
	}
	if archived != nil {
		return ErrFieldNotFoundWriter
	}
	if scope == "global" {
		// Global rows are never editable from this surface.
		return ErrForbidden
	}
	if subID == nil || *subID != tenantID {
		return ErrForbidden
	}

	tag, err := s.artefactsPool.Exec(ctx, sqlArchiveFieldLibrary, fieldID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		// Race: archived between our fetch and our update.
		return ErrFieldNotFoundWriter
	}
	return nil
}

// isUniqueViolation returns true if err is a PostgreSQL unique-violation
// (SQLSTATE 23505). pgx wraps the driver error; we check via interface
// assertion so we don't need a hard import on pgconn.
func isUniqueViolation(err error) bool {
	type sqlState interface{ SQLState() string }
	var s sqlState
	if errors.As(err, &s) {
		return s.SQLState() == "23505"
	}
	return false
}

// LoadAdmittedFields runs the bulk admit query against vector_artefacts.
// MUST stay in lockstep with resolver.go ResolveField — handler_test.go
// exercises both layers with the same matrix.
func (s *Service) LoadAdmittedFields(ctx context.Context, wsID, tenantID uuid.UUID) ([]FieldRow, error) {
	if s.artefactsPool == nil {
		return nil, ErrArtefactsPoolMissing
	}
	rows, err := s.artefactsPool.Query(ctx, sqlLoadAdmittedFields, wsID, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []FieldRow{}
	for rows.Next() {
		var (
			r           FieldRow
			optionsJSON []byte
			configJSON  []byte
		)
		if err := rows.Scan(
			&r.ID,
			&r.SubscriptionID,
			&r.FieldName,
			&r.Label,
			&r.FieldType,
			&optionsJSON,
			&configJSON,
			&r.Description,
			&r.Scope,
			&r.CreatedAt,
			&r.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if len(optionsJSON) > 0 {
			r.OptionsJSON = json.RawMessage(optionsJSON)
		}
		if len(configJSON) > 0 {
			r.ConfigJSON = json.RawMessage(configJSON)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
