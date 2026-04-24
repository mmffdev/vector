package portfoliomodels

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"github.com/mmffdev/vector-backend/internal/librarydb"
)

// Bundle DTO mirrors librarydb.Bundle for the wire. Two reasons we
// keep a separate DTO instead of tagging the librarydb structs:
//
//  1. JSONB columns are stored as []byte in librarydb (kept that way
//     so the Phase 4 adoption cookbook can hand them straight to the
//     tenant-side INSERTs without a re-encode round trip). Marshalling
//     []byte directly emits base64; we want embedded JSON, so the DTO
//     converts them to json.RawMessage.
//  2. Keeps the public HTTP shape decoupled from the internal Go shape
//     — Phase 5+ may add fields (sharing, adoption counters) that
//     don't belong on librarydb.Bundle.
type bundleDTO struct {
	Model       modelDTO              `json:"model"`
	Layers      []layerDTO            `json:"layers"`
	Workflows   []workflowDTO         `json:"workflows"`
	Transitions []transitionDTO       `json:"transitions"`
	Artifacts   []artifactDTO         `json:"artifacts"`
	Terminology []terminologyDTO      `json:"terminology"`
}

type modelDTO struct {
	ID                  uuid.UUID       `json:"id"`
	ModelFamilyID       uuid.UUID       `json:"model_family_id"`
	Key                 string          `json:"key"`
	Name                string          `json:"name"`
	Description         *string         `json:"description"`
	InstructionsMD      *string         `json:"instructions_md"`
	Scope               string          `json:"scope"`
	OwnerSubscriptionID *uuid.UUID      `json:"owner_subscription_id"`
	Visibility          string          `json:"visibility"`
	FeatureFlags        json.RawMessage `json:"feature_flags"`
	DefaultView         *string         `json:"default_view"`
	Icon                *string         `json:"icon"`
	Version             int32           `json:"version"`
	LibraryVersion      *string         `json:"library_version"`
	ArchivedAt          *time.Time      `json:"archived_at"`
	CreatedAt           time.Time       `json:"created_at"`
	UpdatedAt           time.Time       `json:"updated_at"`
}

type layerDTO struct {
	ID             uuid.UUID  `json:"id"`
	ModelID        uuid.UUID  `json:"model_id"`
	Name           string     `json:"name"`
	Tag            string     `json:"tag"`
	SortOrder      int32      `json:"sort_order"`
	ParentLayerID  *uuid.UUID `json:"parent_layer_id"`
	Icon           *string    `json:"icon"`
	Colour         *string    `json:"colour"`
	DescriptionMD  *string    `json:"description_md"`
	HelpMD         *string    `json:"help_md"`
	AllowsChildren bool       `json:"allows_children"`
	IsLeaf         bool       `json:"is_leaf"`
	ArchivedAt     *time.Time `json:"archived_at"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

type workflowDTO struct {
	ID         uuid.UUID  `json:"id"`
	ModelID    uuid.UUID  `json:"model_id"`
	LayerID    uuid.UUID  `json:"layer_id"`
	StateKey   string     `json:"state_key"`
	StateLabel string     `json:"state_label"`
	SortOrder  int32      `json:"sort_order"`
	IsInitial  bool       `json:"is_initial"`
	IsTerminal bool       `json:"is_terminal"`
	Colour     *string    `json:"colour"`
	ArchivedAt *time.Time `json:"archived_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type transitionDTO struct {
	ID          uuid.UUID  `json:"id"`
	ModelID     uuid.UUID  `json:"model_id"`
	FromStateID uuid.UUID  `json:"from_state_id"`
	ToStateID   uuid.UUID  `json:"to_state_id"`
	ArchivedAt  *time.Time `json:"archived_at"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

type artifactDTO struct {
	ID          uuid.UUID       `json:"id"`
	ModelID     uuid.UUID       `json:"model_id"`
	ArtifactKey string          `json:"artifact_key"`
	Enabled     bool            `json:"enabled"`
	Config      json.RawMessage `json:"config"`
	ArchivedAt  *time.Time      `json:"archived_at"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type terminologyDTO struct {
	ID         uuid.UUID  `json:"id"`
	ModelID    uuid.UUID  `json:"model_id"`
	Key        string     `json:"key"`
	Value      string     `json:"value"`
	ArchivedAt *time.Time `json:"archived_at"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// jsonbOrNull turns a nil/empty []byte into a JSON `null` so the DTO
// always emits valid JSON regardless of whether the column is `'{}'`,
// `'null'`, or unscanned.
func jsonbOrNull(b []byte) json.RawMessage {
	if len(b) == 0 {
		return json.RawMessage("null")
	}
	return json.RawMessage(b)
}

func bundleToDTO(b *librarydb.Bundle) bundleDTO {
	out := bundleDTO{
		Model: modelDTO{
			ID:                  b.Model.ID,
			ModelFamilyID:       b.Model.ModelFamilyID,
			Key:                 b.Model.Key,
			Name:                b.Model.Name,
			Description:         b.Model.Description,
			InstructionsMD:      b.Model.InstructionsMD,
			Scope:               b.Model.Scope,
			OwnerSubscriptionID: b.Model.OwnerSubscriptionID,
			Visibility:          b.Model.Visibility,
			FeatureFlags:        jsonbOrNull(b.Model.FeatureFlags),
			DefaultView:         b.Model.DefaultView,
			Icon:                b.Model.Icon,
			Version:             b.Model.Version,
			LibraryVersion:      b.Model.LibraryVersion,
			ArchivedAt:          b.Model.ArchivedAt,
			CreatedAt:           b.Model.CreatedAt,
			UpdatedAt:           b.Model.UpdatedAt,
		},
		Layers:      make([]layerDTO, 0, len(b.Layers)),
		Workflows:   make([]workflowDTO, 0, len(b.Workflows)),
		Transitions: make([]transitionDTO, 0, len(b.Transitions)),
		Artifacts:   make([]artifactDTO, 0, len(b.Artifacts)),
		Terminology: make([]terminologyDTO, 0, len(b.Terminology)),
	}
	for _, l := range b.Layers {
		out.Layers = append(out.Layers, layerDTO(l))
	}
	for _, w := range b.Workflows {
		out.Workflows = append(out.Workflows, workflowDTO(w))
	}
	for _, t := range b.Transitions {
		out.Transitions = append(out.Transitions, transitionDTO(t))
	}
	for _, a := range b.Artifacts {
		out.Artifacts = append(out.Artifacts, artifactDTO{
			ID:          a.ID,
			ModelID:     a.ModelID,
			ArtifactKey: a.ArtifactKey,
			Enabled:     a.Enabled,
			Config:      jsonbOrNull(a.Config),
			ArchivedAt:  a.ArchivedAt,
			CreatedAt:   a.CreatedAt,
			UpdatedAt:   a.UpdatedAt,
		})
	}
	for _, t := range b.Terminology {
		out.Terminology = append(out.Terminology, terminologyDTO(t))
	}
	return out
}
