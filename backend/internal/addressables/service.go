// Package addressables is the SOLE writer for page_addressables and
// page_help. Every INSERT/UPDATE/DELETE against those tables must pass
// through this package. This is the trust boundary called out in
// PLA-0005 risks: anyone bypassing it to write directly corrupts the
// registry irreversibly.
//
// The boundary is enforced by:
//   1. This package being the only one that holds the SQL strings.
//   2. boundary_test.go (in this package) running ripgrep over the
//      whole repo and failing CI if any other Go file outside
//      backend/internal/addressables/ contains 'page_addressables' or
//      'page_help' inside a SQL context.
//   3. Story 00260 wires the same ripgrep into lint:addressables so
//      pre-commit catches it before CI.
//
// Address form (mandatory, deterministic):
//
//   samantha._viewport.<slot>._<kind>.<name>[._<kind>.<name>…]
//
// Six closed-vocabulary viewport slots:
//   app | header | footer | side_bar | modal | toast
//
// Leading underscores on every system segment make the address self-
// tokenizing (segments alternate _system / user-name).
//
// Source rules:
//   - 'build'      — declared at build time via the reconcile job.
//                     Build wins: source='build' rows refuse runtime
//                     overwrites (returns ErrCustomAppCollision).
//   - 'runtime'    — registered by a live mount in dev mode for an
//                     addressable not yet reconciled. Production
//                     refuses runtime registration.
//   - 'custom_app' — registered by a Samantha SDK custom app at
//                     runtime; allowed in production but still
//                     refuses to overwrite a build row.
package addressables

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ViewportSlot is the closed vocabulary for the second address segment.
type ViewportSlot string

const (
	SlotApp     ViewportSlot = "app"
	SlotHeader  ViewportSlot = "header"
	SlotFooter  ViewportSlot = "footer"
	SlotSideBar ViewportSlot = "side_bar"
	SlotModal   ViewportSlot = "modal"
	SlotToast   ViewportSlot = "toast"
)

// IsValid reports whether v is one of the six recognised slots.
func (v ViewportSlot) IsValid() bool {
	switch v {
	case SlotApp, SlotHeader, SlotFooter, SlotSideBar, SlotModal, SlotToast:
		return true
	}
	return false
}

// Source enumerates the three legal values for page_addressables.source.
type Source string

const (
	SourceBuild     Source = "build"
	SourceRuntime   Source = "runtime"
	SourceCustomApp Source = "custom_app"
)

// IsValid reports whether s is one of the three recognised sources.
func (s Source) IsValid() bool {
	switch s {
	case SourceBuild, SourceRuntime, SourceCustomApp:
		return true
	}
	return false
}

// Sentinel errors. Map these to HTTP statuses in the handler:
//   ErrInvalidViewportSlot       → 400
//   ErrInvalidSource             → 400
//   ErrInvalidName               → 400
//   ErrInvalidKind               → 400
//   ErrParentNotFound            → 404 (with the offending parent address)
//   ErrCustomAppCollision        → 409 (with the canonical existing address)
//   ErrRuntimeRegisterInProduction → 403
var (
	ErrInvalidViewportSlot         = errors.New("addressables: invalid viewport slot")
	ErrInvalidSource               = errors.New("addressables: invalid source")
	ErrInvalidName                 = errors.New("addressables: invalid name (must be lower-snake, 1–64 chars, [a-z0-9_])")
	ErrInvalidKind                 = errors.New("addressables: invalid kind (must be lower-snake, 1–32 chars, [a-z0-9_])")
	ErrParentNotFound              = errors.New("addressables: parent address not found")
	ErrCustomAppCollision          = errors.New("addressables: cannot overwrite a build-source addressable")
	ErrRuntimeRegisterInProduction = errors.New("addressables: runtime registration refused in production")
)

// Service is the sole writer for page_addressables and page_help.
type Service struct {
	pool *pgxpool.Pool

	// inProduction toggles the production-only refusal of runtime
	// registration. Set from the calling process's environment at New().
	inProduction bool
}

// New constructs a Service. inProduction=true causes RegisterFromRuntime
// to return ErrRuntimeRegisterInProduction; RegisterFromCustomApp is
// unaffected.
func New(pool *pgxpool.Pool, inProduction bool) *Service {
	return &Service{pool: pool, inProduction: inProduction}
}

// Addressable is one row of the registry as the snapshot read returns it.
type Addressable struct {
	ID            uuid.UUID  `json:"id"`
	ParentID      *uuid.UUID `json:"parent_id"`
	Kind          string     `json:"kind"`
	Name          string     `json:"name"`
	Address       string     `json:"address"`
	PageRoute     string     `json:"page_route"`
	Source        Source     `json:"source"`
	CustomAppID   *uuid.UUID `json:"custom_app_id"`
	SoftArchived  bool       `json:"soft_archived"`
	Helpable      bool       `json:"helpable"`
}

// BuildNode is one entry of the tree the reconcile job hands to
// RegisterFromBuild. Children form the recursive structure.
type BuildNode struct {
	Kind     string      `json:"kind"`
	Name     string      `json:"name"`
	Children []BuildNode `json:"children,omitempty"`
}

// ReconcileCounts is what RegisterFromBuildWithCounts returns alongside
// the address list so the CI handler can report deltas to its operator.
type ReconcileCounts struct {
	Inserted  int
	Archived  int
	Unchanged int
}

// ─────────────────────────────────────────────────────────────────────
// Address builder
// ─────────────────────────────────────────────────────────────────────

// BuildAddress assembles the canonical address string from the four
// inputs. Returns ErrInvalidViewportSlot/ErrInvalidKind/ErrInvalidName
// when the inputs violate the vocabulary or syntax rules.
//
// Form: samantha._viewport.<slot>._<kind>.<name>[._<kind>.<name>…]
//
// parentAddress, when non-empty, must already be a valid address built
// by a previous call (or echoed back from the registry); this function
// appends ._<kind>.<name> to it. parentAddress="" means root: the
// resulting address is samantha._viewport.<slot>._<kind>.<name>.
func BuildAddress(parentAddress string, slot ViewportSlot, kind, name string) (string, error) {
	if !slot.IsValid() {
		return "", ErrInvalidViewportSlot
	}
	if !isValidKind(kind) {
		return "", ErrInvalidKind
	}
	if !isValidName(name) {
		return "", ErrInvalidName
	}
	if parentAddress == "" {
		return fmt.Sprintf("samantha._viewport.%s._%s.%s", slot, kind, name), nil
	}
	return fmt.Sprintf("%s._%s.%s", parentAddress, kind, name), nil
}

func isValidName(s string) bool {
	if len(s) < 1 || len(s) > 64 {
		return false
	}
	for _, r := range s {
		if !(r == '_' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

func isValidKind(s string) bool {
	if len(s) < 1 || len(s) > 32 {
		return false
	}
	for _, r := range s {
		if !(r == '_' || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot (read)
// ─────────────────────────────────────────────────────────────────────

// Snapshot returns every live addressable for the given page route,
// ordered by address. Used by the runtime <DomRegistry> to verify that
// what is mounted matches what is declared.
func (s *Service) Snapshot(ctx context.Context, pageRoute string) ([]Addressable, error) {
	rows, err := s.pool.Query(ctx, sqlSnapshotPageAddressables, pageRoute)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Addressable{}
	for rows.Next() {
		var a Addressable
		var src string
		if err := rows.Scan(&a.ID, &a.ParentID, &a.Kind, &a.Name, &a.Address, &a.PageRoute, &src, &a.CustomAppID, &a.SoftArchived, &a.Helpable); err != nil {
			return nil, err
		}
		a.Source = Source(src)
		out = append(out, a)
	}
	return out, rows.Err()
}

// ─────────────────────────────────────────────────────────────────────
// RegisterFromBuild — sole entry point for the build-time reconciler.
// ─────────────────────────────────────────────────────────────────────

// RegisterFromBuild reconciles a tree of build-declared addressables
// against the registry for one page route. Existing rows with matching
// (parent_id, kind, name) are kept (last_seen_at refreshed); rows
// present in the registry but missing from the tree are soft_archived;
// rows missing from the registry are inserted with source='build'.
//
// Each newly inserted row gets a library_help_defaults seed via
// seedLibraryDefault when one is found.
//
// rootSlot fixes the viewport slot for the entire tree (one tree per
// slot per page).
//
// Returns the canonical addresses for every node in the tree, in the
// order encountered (depth-first, children after parent).
func (s *Service) RegisterFromBuild(ctx context.Context, pageRoute string, rootSlot ViewportSlot, tree []BuildNode) ([]string, error) {
	addresses, _, err := s.RegisterFromBuildWithCounts(ctx, pageRoute, rootSlot, tree)
	return addresses, err
}

// RegisterFromBuildWithCounts is the same as RegisterFromBuild but also
// returns inserted/archived/unchanged counts so callers (the REST handler)
// can report delta to operators.
func (s *Service) RegisterFromBuildWithCounts(ctx context.Context, pageRoute string, rootSlot ViewportSlot, tree []BuildNode) ([]string, ReconcileCounts, error) {
	var counts ReconcileCounts
	if !rootSlot.IsValid() {
		return nil, counts, ErrInvalidViewportSlot
	}
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, counts, err
	}
	defer tx.Rollback(ctx)

	addresses := []string{}
	keepIDs := map[uuid.UUID]struct{}{}

	var walk func(parentID *uuid.UUID, parentAddress string, nodes []BuildNode) error
	walk = func(parentID *uuid.UUID, parentAddress string, nodes []BuildNode) error {
		for _, n := range nodes {
			addr, err := BuildAddress(parentAddress, rootSlot, n.Kind, n.Name)
			if err != nil {
				return err
			}
			id, isNew, err := s.upsertAddressable(ctx, tx, parentID, n.Kind, n.Name, addr, pageRoute, SourceBuild, nil)
			if err != nil {
				return err
			}
			keepIDs[id] = struct{}{}
			addresses = append(addresses, addr)
			if isNew {
				counts.Inserted++
				if err := s.seedLibraryDefault(ctx, tx, id, n.Kind, n.Name); err != nil {
					return err
				}
			} else {
				counts.Unchanged++
			}
			childParent := id
			if err := walk(&childParent, addr, n.Children); err != nil {
				return err
			}
		}
		return nil
	}

	if err := walk(nil, "", tree); err != nil {
		return nil, counts, err
	}

	// Soft-archive build rows on this route that the new tree dropped.
	archived, err := s.archiveDroppedBuildRowsCount(ctx, tx, pageRoute, keepIDs)
	if err != nil {
		return nil, counts, err
	}
	counts.Archived = archived

	if err := tx.Commit(ctx); err != nil {
		return nil, counts, err
	}
	return addresses, counts, nil
}

// ─────────────────────────────────────────────────────────────────────
// RegisterFromRuntime — dev-mode-only addressable insertion.
// ─────────────────────────────────────────────────────────────────────

// RegisterFromRuntime inserts a single runtime-source addressable when
// a live mount is observed for an address that is not yet in the
// registry. Refused in production (returns ErrRuntimeRegisterInProduction).
//
// parentAddress="" means root for the given slot. Returns the canonical
// address; on collision with an existing row it returns the existing
// address (idempotent), unless the existing row is source='build' AND
// the caller is source='custom_app' — that case returns ErrCustomAppCollision.
func (s *Service) RegisterFromRuntime(ctx context.Context, pageRoute, parentAddress string, slot ViewportSlot, kind, name string, source Source, customAppID *uuid.UUID) (string, error) {
	if s.inProduction && source == SourceRuntime {
		return "", ErrRuntimeRegisterInProduction
	}
	if !source.IsValid() || source == SourceBuild {
		// Build inserts go through RegisterFromBuild only.
		return "", ErrInvalidSource
	}
	if !slot.IsValid() {
		return "", ErrInvalidViewportSlot
	}
	if !isValidKind(kind) {
		return "", ErrInvalidKind
	}
	if !isValidName(name) {
		return "", ErrInvalidName
	}

	addr, err := BuildAddress(parentAddress, slot, kind, name)
	if err != nil {
		return "", err
	}

	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var parentID *uuid.UUID
	if parentAddress != "" {
		pid, err := s.lookupID(ctx, tx, pageRoute, parentAddress)
		if err != nil {
			return "", err
		}
		parentID = &pid
	}

	// Check for an existing live row with this triple.
	if existingSource, _, err := s.peekSibling(ctx, tx, parentID, pageRoute, kind, name); err == nil {
		if existingSource == SourceBuild && source == SourceCustomApp {
			return "", ErrCustomAppCollision
		}
		// Otherwise idempotent: refresh last_seen_at and return the existing address.
		if err := s.touchLastSeen(ctx, tx, parentID, pageRoute, kind, name); err != nil {
			return "", err
		}
		if err := tx.Commit(ctx); err != nil {
			return "", err
		}
		return addr, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	id, _, err := s.upsertAddressable(ctx, tx, parentID, kind, name, addr, pageRoute, source, customAppID)
	if err != nil {
		return "", err
	}
	if err := s.seedLibraryDefault(ctx, tx, id, kind, name); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return addr, nil
}

// ─────────────────────────────────────────────────────────────────────
// page_help reads (used by the snapshot bundle and the /help/<id> route)
// ─────────────────────────────────────────────────────────────────────

// HelpDoc is the wire shape for one page_help row in its rich-content
// form. Title is optional (nil when no heading is set). VideoEmbeds and
// ImageURLs are JSON arrays whose element schemas live in the frontend
// types — the backend only round-trips them as raw JSON so the editor
// and renderer stay in lockstep without a server-side validator on
// every shape change. Sanitiser logic for body_html / video URLs lives
// in story 00330.
type HelpDoc struct {
	AddressableID uuid.UUID       `json:"addressable_id"`
	Locale        string          `json:"locale"`
	Title         *string         `json:"title,omitempty"`
	BodyHTML      string          `json:"body_html"`
	VideoEmbeds   json.RawMessage `json:"video_embeds"`
	ImageURLs     json.RawMessage `json:"image_urls"`
}

// HelpFor returns the live page_help row for an addressable + locale.
// When no live row exists, returns an empty HelpDoc with found=false
// (callers treat absence of copy as "no help").
func (s *Service) HelpFor(ctx context.Context, addressableID uuid.UUID, locale string) (HelpDoc, bool, error) {
	if locale == "" {
		locale = "en"
	}
	doc := HelpDoc{AddressableID: addressableID, Locale: locale}
	err := s.pool.QueryRow(ctx, sqlSelectHelpForAddressableLocale, addressableID, locale).
		Scan(&doc.Title, &doc.BodyHTML, &doc.VideoEmbeds, &doc.ImageURLs)
	if errors.Is(err, pgx.ErrNoRows) {
		return HelpDoc{AddressableID: addressableID, Locale: locale, VideoEmbeds: emptyJSONArray, ImageURLs: emptyJSONArray}, false, nil
	}
	if err != nil {
		return HelpDoc{}, false, err
	}
	if len(doc.VideoEmbeds) == 0 {
		doc.VideoEmbeds = emptyJSONArray
	}
	if len(doc.ImageURLs) == 0 {
		doc.ImageURLs = emptyJSONArray
	}
	return doc, true, nil
}

// emptyJSONArray is the canonical encoding the API returns when a
// row's JSONB column is NULL or unset. Keeps the wire shape stable.
var emptyJSONArray = json.RawMessage(`[]`)

// ─────────────────────────────────────────────────────────────────────
// page_help admin (gadmin editor surface — story 00253)
// ─────────────────────────────────────────────────────────────────────

// HelpAdminRow is one row of the gadmin editor list: live page_help
// rows joined to their addressable so the UI can group by page_route
// and show address + kind + body preview + provenance.
//
// IsLibraryDefault is true when seeded_from='library' AND the row has
// not been touched by an editor (i.e. updated_by_user_id IS NULL); used
// by the UI to render the "library default" badge.
type HelpAdminRow struct {
	HelpID           uuid.UUID       `json:"help_id"`
	AddressableID    uuid.UUID       `json:"addressable_id"`
	Address          string          `json:"address"`
	PageRoute        string          `json:"page_route"`
	Kind             string          `json:"kind"`
	Name             string          `json:"name"`
	Locale           string          `json:"locale"`
	Title            *string         `json:"title,omitempty"`
	BodyHTML         string          `json:"body_html"`
	VideoEmbeds      json.RawMessage `json:"video_embeds"`
	ImageURLs        json.RawMessage `json:"image_urls"`
	SeededFrom       *string         `json:"seeded_from"`
	IsLibraryDefault bool            `json:"is_library_default"`
	UpdatedAt        string          `json:"updated_at"`
	UpdatedByEmail   *string         `json:"updated_by_email"`
	Helpable         bool            `json:"helpable"`
}

// AdminListHelp returns every live page_help row joined to its
// addressable, ordered by page_route then address. Used by the
// /dev/page-help editor.
func (s *Service) AdminListHelp(ctx context.Context) ([]HelpAdminRow, error) {
	rows, err := s.pool.Query(ctx, sqlAdminListHelp)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []HelpAdminRow{}
	for rows.Next() {
		var r HelpAdminRow
		var updated time.Time
		if err := rows.Scan(
			&r.HelpID, &r.AddressableID, &r.Address, &r.PageRoute, &r.Kind, &r.Name,
			&r.Locale, &r.Title, &r.BodyHTML, &r.VideoEmbeds, &r.ImageURLs, &r.SeededFrom, &r.IsLibraryDefault,
			&updated, &r.UpdatedByEmail, &r.Helpable,
		); err != nil {
			return nil, err
		}
		r.UpdatedAt = updated.UTC().Format(time.RFC3339)
		if len(r.VideoEmbeds) == 0 {
			r.VideoEmbeds = emptyJSONArray
		}
		if len(r.ImageURLs) == 0 {
			r.ImageURLs = emptyJSONArray
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// HelpUpdate is the input shape for UpdateHelp. Title is optional
// (nil leaves the column at its current value? no — see below).
//
// Field semantics on write:
//   - Title:       always overwritten (nil becomes NULL, "" becomes empty).
//                  The editor sends the full intended state every save.
//   - BodyHTML:    always overwritten.
//   - VideoEmbeds: always overwritten. Pass `[]` to clear.
//   - ImageURLs:   always overwritten. Pass `[]` to clear.
//
// We deliberately do NOT do partial PATCH semantics: the editor saves
// the whole document, and ambiguity between "absent" and "cleared"
// would fight that model.
type HelpUpdate struct {
	Title       *string
	BodyHTML    string
	VideoEmbeds json.RawMessage
	ImageURLs   json.RawMessage
}

// UpdateHelp writes a new body + rich content for the (addressable,
// locale) live row. Bumps updated_at + updated_by, flips seeded_from
// to 'manual' (the schema's name for editor-authored content; the plan
// calls this state "gadmin"), and clears library_ref so future library
// churn does not retro-apply. Returns ErrParentNotFound when no live
// row exists.
func (s *Service) UpdateHelp(ctx context.Context, addressableID uuid.UUID, locale string, doc HelpUpdate, editorID uuid.UUID) error {
	if locale == "" {
		locale = "en"
	}
	videos := doc.VideoEmbeds
	if len(videos) == 0 {
		videos = emptyJSONArray
	}
	images := doc.ImageURLs
	if len(images) == 0 {
		images = emptyJSONArray
	}
	tag, err := s.pool.Exec(ctx, sqlUpdateHelp,
		doc.Title, doc.BodyHTML, videos, images, editorID, addressableID, locale)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrParentNotFound
	}
	return nil
}

// ArchiveHelp soft-archives the live page_help row for (addressable,
// locale). The addressable itself is untouched — registry rows are
// archived only by reconcile or runtime GC. Returns ErrParentNotFound
// when no live row exists.
func (s *Service) ArchiveHelp(ctx context.Context, addressableID uuid.UUID, locale string, editorID uuid.UUID) error {
	if locale == "" {
		locale = "en"
	}
	tag, err := s.pool.Exec(ctx, sqlArchiveHelp, editorID, addressableID, locale)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrParentNotFound
	}
	return nil
}

// UpdateHelpable flips the per-row helpable bit on an addressable so
// gadmin can hide the help icon on a specific element without touching
// code. Returns ErrParentNotFound when no live addressable row exists.
func (s *Service) UpdateHelpable(ctx context.Context, addressableID uuid.UUID, helpable bool) error {
	tag, err := s.pool.Exec(ctx, sqlUpdateHelpable, helpable, addressableID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrParentNotFound
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────
// Internal: write-side helpers (only this file may reach the tables)
// ─────────────────────────────────────────────────────────────────────

// upsertAddressable inserts a (parent_id, kind, name, address, route,
// source, custom_app_id) row if absent (returning isNew=true), or
// refreshes last_seen_at on an existing live row (isNew=false). Returns
// the row id either way.
func (s *Service) upsertAddressable(ctx context.Context, tx pgx.Tx, parentID *uuid.UUID, kind, name, addr, pageRoute string, source Source, customAppID *uuid.UUID) (uuid.UUID, bool, error) {
	// Try the insert first; ON CONFLICT (the partial unique indexes) is
	// not directly addressable as a target, so we do an existence check
	// inside the transaction with a row lock instead.
	var existingID uuid.UUID
	var existingSource string
	var query string
	var args []any
	if parentID == nil {
		query = sqlSelectAddressableSiblingRootForUpdate
		args = []any{pageRoute, kind, name}
	} else {
		query = sqlSelectAddressableSiblingChildForUpdate
		args = []any{*parentID, kind, name}
	}
	err := tx.QueryRow(ctx, query, args...).Scan(&existingID, &existingSource)
	if err == nil {
		// Live row exists; refresh last_seen_at and return.
		_, err = tx.Exec(ctx, sqlTouchAddressableLastSeen, existingID)
		if err != nil {
			return uuid.Nil, false, err
		}
		return existingID, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, err
	}

	// No live row — insert.
	var newID uuid.UUID
	err = tx.QueryRow(ctx, sqlInsertAddressable,
		parentID, kind, name, addr, pageRoute, string(source), customAppID).Scan(&newID)
	if err != nil {
		return uuid.Nil, false, err
	}
	return newID, true, nil
}

// archiveDroppedBuildRows soft-archives every build-source row on the
// given page route whose id is not in keepIDs. Used by RegisterFromBuild
// to retire addressables that the build no longer declares.
func (s *Service) archiveDroppedBuildRows(ctx context.Context, tx pgx.Tx, pageRoute string, keepIDs map[uuid.UUID]struct{}) error {
	_, err := s.archiveDroppedBuildRowsCount(ctx, tx, pageRoute, keepIDs)
	return err
}

// archiveDroppedBuildRowsCount is the same as archiveDroppedBuildRows
// and additionally returns the number of rows soft-archived.
func (s *Service) archiveDroppedBuildRowsCount(ctx context.Context, tx pgx.Tx, pageRoute string, keepIDs map[uuid.UUID]struct{}) (int, error) {
	rows, err := tx.Query(ctx, sqlListLiveBuildAddressableIDs, pageRoute)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	var toArchive []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return 0, err
		}
		if _, keep := keepIDs[id]; !keep {
			toArchive = append(toArchive, id)
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(toArchive) == 0 {
		return 0, nil
	}
	if _, err := tx.Exec(ctx, sqlSoftArchiveAddressablesByID, toArchive); err != nil {
		return 0, err
	}
	return len(toArchive), nil
}

// lookupIDByAddress finds the live row id for a (route, address) pair.
// Returns ErrParentNotFound when absent (re-using the same sentinel for
// any address-not-found case in the handler).
func (s *Service) lookupIDByAddress(ctx context.Context, pageRoute, address string) (uuid.UUID, error) {
	id, _, err := s.lookupRowByAddress(ctx, pageRoute, address)
	return id, err
}

// lookupRowByAddress finds the live row id + helpable bit for a
// (route, address) pair. Returns ErrParentNotFound when absent.
func (s *Service) lookupRowByAddress(ctx context.Context, pageRoute, address string) (uuid.UUID, bool, error) {
	var id uuid.UUID
	var helpable bool
	err := s.pool.QueryRow(ctx, sqlSelectAddressableByRouteAndAddressWithHelpable, pageRoute, address).
		Scan(&id, &helpable)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, ErrParentNotFound
	}
	return id, helpable, err
}

// addressableExists reports whether a live row with this id exists. Used
// by the page-help handler to distinguish "addressable missing" (404)
// from "addressable known but no help authored" (200 with empty body).
func (s *Service) addressableExists(ctx context.Context, id uuid.UUID) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, sqlExistsLiveAddressable, id).Scan(&exists)
	return exists, err
}

// peekSibling returns the source + id of a live sibling row matching
// (parent, kind, name) on the page route. pgx.ErrNoRows when absent.
func (s *Service) peekSibling(ctx context.Context, tx pgx.Tx, parentID *uuid.UUID, pageRoute, kind, name string) (Source, uuid.UUID, error) {
	var src string
	var id uuid.UUID
	var err error
	if parentID == nil {
		err = tx.QueryRow(ctx, sqlSelectAddressableSiblingRootSourceID, pageRoute, kind, name).
			Scan(&src, &id)
	} else {
		err = tx.QueryRow(ctx, sqlSelectAddressableSiblingChildSourceID, *parentID, kind, name).
			Scan(&src, &id)
	}
	return Source(src), id, err
}

// touchLastSeen refreshes last_seen_at on an existing live sibling.
func (s *Service) touchLastSeen(ctx context.Context, tx pgx.Tx, parentID *uuid.UUID, pageRoute, kind, name string) error {
	if parentID == nil {
		_, err := tx.Exec(ctx, sqlTouchAddressableSiblingRootLastSeen, pageRoute, kind, name)
		return err
	}
	_, err := tx.Exec(ctx, sqlTouchAddressableSiblingChildLastSeen, *parentID, kind, name)
	return err
}

// lookupID resolves a parent address back to its UUID inside the tx.
// Returns ErrParentNotFound when the address is unknown for the route.
func (s *Service) lookupID(ctx context.Context, tx pgx.Tx, pageRoute, address string) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, sqlSelectAddressableIDByRouteAndAddress, pageRoute, address).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, ErrParentNotFound
	}
	return id, err
}

// PlaceholderBodyHTML is the fallback body inserted into page_help when
// no library_help_defaults row matches the addressable's (kind, name).
// PLA-0008/00325 contract: every addressable ships with a discoverable,
// gadmin-editable help row from the moment it first registers — never
// help-less.
const PlaceholderBodyHTML = "Help text not yet authored."

// seedLibraryDefault looks up the longest-matching library_help_defaults
// row for (kind, name, locale='en') and inserts a page_help row with
// seeded_from='library'. When no library row matches, falls back to a
// placeholder row (seeded_from='placeholder', body=PlaceholderBodyHTML,
// title=NULL, video_embeds=[], image_urls=[], updated_by_user_id=NULL)
// so every newly registered addressable always has a help row.
//
// Both paths use ON CONFLICT DO NOTHING — re-registering the same
// addressable leaves the existing row (and any gadmin edits) untouched.
// Library churn does NOT auto-propagate; once page_help has a row, it
// is independent.
//
// Match precedence:
//   1. exact name_pattern == name
//   2. wildcard '*'
//   3. placeholder (no library row matches at all)
func (s *Service) seedLibraryDefault(ctx context.Context, tx pgx.Tx, addressableID uuid.UUID, kind, name string) error {
	var libID uuid.UUID
	var title *string
	var body string
	var videos, images json.RawMessage
	// Prefer exact name match, then wildcard.
	err := tx.QueryRow(ctx, sqlSelectLibraryHelpDefault, kind, name).
		Scan(&libID, &title, &body, &videos, &images)
	if errors.Is(err, pgx.ErrNoRows) {
		// No library default — seed the placeholder row instead.
		_, perr := tx.Exec(ctx, sqlInsertHelpPlaceholder, addressableID, PlaceholderBodyHTML)
		return perr
	}
	if err != nil {
		return err
	}
	if len(videos) == 0 {
		videos = emptyJSONArray
	}
	if len(images) == 0 {
		images = emptyJSONArray
	}

	_, err = tx.Exec(ctx, sqlInsertHelpFromLibrary,
		addressableID, title, body, videos, images, libID)
	return err
}

// ─────────────────────────────────────────────────────────────────────
// Validation helpers exposed for the handler.
// ─────────────────────────────────────────────────────────────────────

// ParseSlot turns a raw string into a typed ViewportSlot or returns
// ErrInvalidViewportSlot.
func ParseSlot(s string) (ViewportSlot, error) {
	v := ViewportSlot(strings.ToLower(strings.TrimSpace(s)))
	if !v.IsValid() {
		return "", ErrInvalidViewportSlot
	}
	return v, nil
}

// ParseSource turns a raw string into a typed Source or returns
// ErrInvalidSource.
func ParseSource(s string) (Source, error) {
	v := Source(strings.ToLower(strings.TrimSpace(s)))
	if !v.IsValid() {
		return "", ErrInvalidSource
	}
	return v, nil
}
