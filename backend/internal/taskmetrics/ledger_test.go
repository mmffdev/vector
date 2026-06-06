package taskmetrics

import (
	"reflect"
	"testing"
)

func TestDeriveTaskEvents(t *testing.T) {
	cases := []struct {
		name string
		in   TaskDelta
		want []PendingEvent
	}{
		{
			name: "non-task emits nothing",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: false, AfterSprintID: "s1"},
			want: nil,
		},
		{
			name: "added to sprint",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "", AfterSprintID: "s1"},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1}},
		},
		{
			name: "removed from sprint (not done) drops scope and remaining",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "", BeforeKind: "in_progress"},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: -1}},
		},
		{
			name: "removed from sprint while done drops scope only",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "", BeforeKind: kindDone},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: 0}},
		},
		{
			name: "sprint-to-sprint move",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "s2", BeforeKind: "todo"},
			want: []PendingEvent{
				{SprintID: "s1", ArtefactID: "x", EventType: EventRemoved, ScopeDelta: -1, RemainingDelta: -1},
				{SprintID: "s2", ArtefactID: "x", EventType: EventAdded, ScopeDelta: 1, RemainingDelta: 1},
			},
		},
		{
			name: "done crossing (same sprint)",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "s1", BeforeKind: "in_progress", AfterKind: kindDone},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventDone, RemainingDelta: -1}},
		},
		{
			name: "undone crossing (same sprint)",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "s1", AfterSprintID: "s1", BeforeKind: kindDone, AfterKind: "in_progress"},
			want: []PendingEvent{{SprintID: "s1", ArtefactID: "x", EventType: EventUndone, RemainingDelta: 1}},
		},
		{
			name: "no sprint, no events",
			in:   TaskDelta{ArtefactID: "x", IsTaskUnit: true, BeforeSprintID: "", AfterSprintID: "", AfterKind: kindDone},
			want: nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := DeriveTaskEvents(c.in)
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("DeriveTaskEvents() = %+v, want %+v", got, c.want)
			}
		})
	}
}
