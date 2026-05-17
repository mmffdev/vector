package artefacttypes

import (
	"context"

	"github.com/google/uuid"
)

// defaultWorkspaceTypes is the canonical set of system artefact types seeded
// into every new workspace. Portfolio Item is excluded — it is added by the
// portfolio model adoption saga once a model is chosen.
var defaultWorkspaceTypes = []struct {
	name      string
	prefix    string
	slot      string
	colour    string
	sortOrder int
}{
	{"Story", "US", "wrk_story", "#ef4444", 10},
	{"Defect", "DE", "wrk_defect", "#6366f1", 20},
	{"Risk", "RSK", "wrk_risk", "#dc2626", 25},
	{"Task", "TA", "wrk_task", "#6366f1", 30},
	{"Epic", "EP", "wrk_epic", "#a855f7", 40},
}

// SeedDefaultWorkspaceTypes inserts the 5 canonical system work types for a
// newly-created workspace. Idempotent via ON CONFLICT DO NOTHING on the slot
// partial unique index. Called by workspaces.Service.Create after commit.
func (s *Service) SeedDefaultWorkspaceTypes(ctx context.Context, subscriptionID, workspaceID uuid.UUID) error {
	if s.pool == nil {
		return nil
	}
	for _, t := range defaultWorkspaceTypes {
		if _, err := s.pool.Exec(ctx, sqlInsertDefaultWorkspaceType,
			subscriptionID, workspaceID,
			t.name, t.prefix, t.slot, t.colour, t.sortOrder,
		); err != nil {
			return err
		}
	}
	return nil
}
