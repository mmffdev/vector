package librarydb

import (
	"time"

	"github.com/google/uuid"
)

// Bundle is the complete portfolio model bundle: spine + 5 child layers.
// Returned by FetchByModelID / FetchLatestByFamily under a single
// REPEATABLE READ snapshot so all six reads are consistent.
type Bundle struct {
	Model       Model
	Layers      []Layer
	Workflows   []Workflow
	Transitions []WorkflowTransition
	Artifacts   []Artifact
	Terminology []Terminology
}

type Model struct {
	ID                  uuid.UUID
	ModelFamilyID       uuid.UUID
	Key                 string
	Name                string
	Description         *string
	InstructionsMD      *string
	Scope               string // 'system' | 'tenant' | 'shared'
	OwnerSubscriptionID *uuid.UUID
	Visibility          string // 'private' | 'public' | 'invite'
	FeatureFlags        []byte // raw jsonb
	DefaultView         *string
	Icon                *string
	Version             int32
	LibraryVersion      *string
	ArchivedAt          *time.Time
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

type Layer struct {
	ID             uuid.UUID
	ModelID        uuid.UUID
	Name           string
	Tag            string
	SortOrder      int32
	ParentLayerID  *uuid.UUID
	Icon           *string
	Colour         *string
	DescriptionMD  *string
	HelpMD         *string
	AllowsChildren bool
	IsLeaf         bool
	ArchivedAt     *time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type Workflow struct {
	ID         uuid.UUID
	ModelID    uuid.UUID
	LayerID    uuid.UUID
	StateKey   string
	StateLabel string
	SortOrder  int32
	IsInitial  bool
	IsTerminal bool
	Colour     *string
	ArchivedAt *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type WorkflowTransition struct {
	ID          uuid.UUID
	ModelID     uuid.UUID
	FromStateID uuid.UUID
	ToStateID   uuid.UUID
	ArchivedAt  *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Artifact struct {
	ID          uuid.UUID
	ModelID     uuid.UUID
	ArtifactKey string
	Enabled     bool
	Config      []byte // raw jsonb
	ArchivedAt  *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type Terminology struct {
	ID         uuid.UUID
	ModelID    uuid.UUID
	Key        string
	Value      string
	ArchivedAt *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}
