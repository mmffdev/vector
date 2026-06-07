package flows

// SpineState is one state in a default workflow spine.
type SpineState struct {
	Name       string
	Kind       string // backlog | todo | in_progress | done | accepted | cancelled
	Colour     string // "" → NULL
	SortOrder  int
	IsInitial  bool
	IsPullable bool
}

// standardSpine is the fallback default workflow seeded for a work type when
// its clone-source has no live flow. Mirrors the canonical Story workflow.
var standardSpine = []SpineState{
	{Name: "Backlog", Kind: "backlog", SortOrder: 10, IsInitial: true},
	{Name: "To Do", Kind: "todo", SortOrder: 20, IsPullable: true},
	{Name: "Doing", Kind: "in_progress", SortOrder: 30},
	{Name: "Completed", Kind: "done", SortOrder: 40},
	{Name: "Accepted", Kind: "accepted", SortOrder: 50},
}
