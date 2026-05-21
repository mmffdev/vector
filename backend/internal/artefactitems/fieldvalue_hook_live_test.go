package artefactitems_test

import (
	"context"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/mmffdev/vector-backend/internal/artefactitems"
	"github.com/mmffdev/vector-backend/internal/notifications/rules"
)

// Live-DB tests that pin the producer→evaluator contract on the
// custom-field write path. Skipped automatically when the vector_artefacts
// tunnel is down (vaPool() handles the skip). These are the tests that
// catch the field-name-mismatch class of bug — the same shape as the
// is_blocked→blocked fix in a695e5b.

// recordingHook is a rules.RuleHook that captures every fired event so
// the test can assert on count + payload shape. Thread-safe — the
// producer fires the hook on the request goroutine, but tests may call
// the service concurrently in future.
type recordingHook struct {
	mu     sync.Mutex
	events []rules.ArtefactChangedEvent
}

func (h *recordingHook) OnArtefactChanged(_ context.Context, ev rules.ArtefactChangedEvent) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.events = append(h.events, ev)
}

func (h *recordingHook) drain() []rules.ArtefactChangedEvent {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := h.events
	h.events = nil
	return out
}

// seedTenantFieldLibrary inserts a tenant-scoped field_library row and
// returns its UUID. Cleans up on t.Cleanup. The field name is unique
// per test (suffix from t.Name()) so parallel runs don't collide on the
// (subscription_id, name) unique index.
func seedTenantFieldLibrary(t *testing.T, va *pgxpool.Pool, subID uuid.UUID, fieldName, label, fieldType string) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var id uuid.UUID
	err := va.QueryRow(ctx, `
		INSERT INTO artefacts_fields_library
			(subscription_id, field_name, label, field_type, scope)
		VALUES ($1, $2, $3, $4, 'tenant')
		RETURNING id`,
		subID, fieldName, label, fieldType,
	).Scan(&id)
	if err != nil {
		t.Skipf("cannot seed field_library row: %v", err)
	}
	t.Cleanup(func() {
		// Field-values rows cascade via FK; defensive cleanup of both.
		_, _ = va.Exec(context.Background(),
			`DELETE FROM artefacts_fields_values WHERE artefacts_fields_values_id_field_library = $1`, id)
		_, _ = va.Exec(context.Background(),
			`DELETE FROM artefacts_fields_library WHERE id = $1`, id)
	})
	return id
}

// uniqueName makes a per-test field-library name so parallel runs and
// repeated runs against the same DB don't trip the (sub, name) unique
// index. Underscores only — the schema's check is on shape, not slug.
func uniqueName(t *testing.T, base string) string {
	t.Helper()
	suffix := strings.ReplaceAll(strings.ToLower(t.Name()), "/", "_")
	return base + "_" + suffix
}

func TestUpsertFieldValue_FiresRuleHookWithFieldName(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	artID := seedArtefact(t, va, sub, "defect", "rule-hook fires test")
	fieldID := seedTenantFieldLibrary(t, va, sub, uniqueName(t, "severity"), "Severity Test", "textbox")

	hook := &recordingHook{}
	svc := artefactitems.NewService(va, nil, "work")
	svc.WithRuleHook(hook)

	authorID := uuid.New()
	val := "critical"
	if err := svc.UpsertFieldValue(context.Background(), sub, artID, artefactitems.UpsertFieldValueInput{
		FieldLibraryID: fieldID.String(),
		StringValue:    &val,
		AuthorUserID:   authorID,
	}); err != nil {
		t.Fatalf("UpsertFieldValue: %v", err)
	}

	events := hook.drain()
	if len(events) != 1 {
		t.Fatalf("want 1 event, got %d", len(events))
	}
	ev := events[0]
	if ev.AuthorUserID != authorID {
		t.Errorf("AuthorUserID: want %s, got %s", authorID, ev.AuthorUserID)
	}
	if ev.ArtefactID.String() != artID.String() {
		t.Errorf("ArtefactID: want %s, got %s", artID, ev.ArtefactID)
	}
	if !strings.EqualFold(ev.ArtefactType, "Defect") {
		t.Errorf("ArtefactType: want Defect, got %q", ev.ArtefactType)
	}
	// The diff key MUST be the field-library `name` — that's what the
	// schema endpoint surfaces and what rule conditions store. Wrong
	// key = silent no-match (the bug we're guarding against).
	key := uniqueName(t, "severity")
	change, ok := ev.Fields[key]
	if !ok {
		t.Fatalf("diff missing field %q; got keys %v", key, mapKeys(ev.Fields))
	}
	if change.Before != nil {
		t.Errorf("Before: want nil (first write), got %v", change.Before)
	}
	if change.After != "critical" {
		t.Errorf("After: want critical, got %v", change.After)
	}
}

func TestUpsertFieldValue_NoopWriteSuppressesEvent(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	artID := seedArtefact(t, va, sub, "defect", "noop suppression")
	fieldID := seedTenantFieldLibrary(t, va, sub, uniqueName(t, "noop"), "Noop", "textbox")

	hook := &recordingHook{}
	svc := artefactitems.NewService(va, nil, "work")
	svc.WithRuleHook(hook)

	val := "same"
	for i := 0; i < 2; i++ {
		if err := svc.UpsertFieldValue(context.Background(), sub, artID, artefactitems.UpsertFieldValueInput{
			FieldLibraryID: fieldID.String(),
			StringValue:    &val,
			AuthorUserID:   uuid.New(),
		}); err != nil {
			t.Fatalf("write %d: %v", i, err)
		}
	}
	events := hook.drain()
	// First write: Before=nil, After=same — that IS a change, fires.
	// Second write: Before=same, After=same — no-op, suppressed.
	if len(events) != 1 {
		t.Fatalf("want exactly 1 event (no-op second write suppressed), got %d", len(events))
	}
}

func TestUpsertFieldValues_BatchFiresOneEventWithAllFields(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	artID := seedArtefact(t, va, sub, "defect", "batch test")
	severityID := seedTenantFieldLibrary(t, va, sub, uniqueName(t, "sev"), "Sev", "textbox")
	notesID := seedTenantFieldLibrary(t, va, sub, uniqueName(t, "notes"), "Notes", "textbox")

	hook := &recordingHook{}
	svc := artefactitems.NewService(va, nil, "work")
	svc.WithRuleHook(hook)

	sevVal := "high"
	notesVal := "urgent fix needed"
	authorID := uuid.New()
	if err := svc.UpsertFieldValues(context.Background(), sub, artID, []artefactitems.UpsertFieldValueInput{
		{FieldLibraryID: severityID.String(), StringValue: &sevVal, AuthorUserID: authorID},
		{FieldLibraryID: notesID.String(), StringValue: &notesVal, AuthorUserID: authorID},
	}); err != nil {
		t.Fatalf("UpsertFieldValues: %v", err)
	}

	events := hook.drain()
	if len(events) != 1 {
		t.Fatalf("batched write must fire ONE event with N fields, not N events. Got %d events", len(events))
	}
	if len(events[0].Fields) != 2 {
		t.Errorf("want 2 fields in the diff, got %d", len(events[0].Fields))
	}
	if c, ok := events[0].Fields[uniqueName(t, "sev")]; !ok || c.After != "high" {
		t.Errorf("sev field missing or wrong: %v (ok=%v)", c, ok)
	}
	if c, ok := events[0].Fields[uniqueName(t, "notes")]; !ok || c.After != "urgent fix needed" {
		t.Errorf("notes field missing or wrong: %v (ok=%v)", c, ok)
	}
}

func TestDeleteFieldValue_FiresWithAfterNil(t *testing.T) {
	va := vaPool(t)
	sub := pickTestSubscription(t, va)
	artID := seedArtefact(t, va, sub, "defect", "delete-fires test")
	fieldID := seedTenantFieldLibrary(t, va, sub, uniqueName(t, "del"), "Del", "textbox")

	hook := &recordingHook{}
	svc := artefactitems.NewService(va, nil, "work")
	svc.WithRuleHook(hook)

	// Seed a value so there's something to delete.
	val := "tobedeleted"
	if err := svc.UpsertFieldValue(context.Background(), sub, artID, artefactitems.UpsertFieldValueInput{
		FieldLibraryID: fieldID.String(),
		StringValue:    &val,
	}); err != nil {
		t.Fatalf("seed write: %v", err)
	}
	hook.drain() // discard the upsert event

	// Look up the value-row id (DeleteFieldValue takes the row PK, not
	// the field-library id — same shape as the handler URL param).
	var fvRowID uuid.UUID
	if err := va.QueryRow(context.Background(), `
		SELECT artefacts_fields_values_id
		  FROM artefacts_fields_values
		 WHERE artefacts_fields_values_id_artefact = $1
		   AND artefacts_fields_values_id_field_library = $2`,
		artID, fieldID,
	).Scan(&fvRowID); err != nil {
		t.Fatalf("look up value row: %v", err)
	}

	if err := svc.DeleteFieldValue(context.Background(), sub, artID, fvRowID); err != nil {
		t.Fatalf("DeleteFieldValue: %v", err)
	}

	events := hook.drain()
	if len(events) != 1 {
		t.Fatalf("want 1 delete event, got %d", len(events))
	}
	change, ok := events[0].Fields[uniqueName(t, "del")]
	if !ok {
		t.Fatalf("delete event missing field key %q; got %v", uniqueName(t, "del"), mapKeys(events[0].Fields))
	}
	if change.After != nil {
		t.Errorf("delete After: want nil, got %v", change.After)
	}
	if change.Before != "tobedeleted" {
		t.Errorf("delete Before: want tobedeleted, got %v", change.Before)
	}
}

func mapKeys(m map[string]rules.FieldChange) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
