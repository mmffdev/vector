package sprintmetrics

import "testing"

func TestDeriveBurnEvents(t *testing.T) {
	cases := []struct {
		name string
		in   ArtefactDelta
		want []PendingEvent
	}{
		{
			name: "AcceptedBurnsDown",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s1",
				BeforeKind:      "in_progress",
				AfterKind:       "accepted",
				BeforePoints:    5,
				AfterPoints:     5,
				Points:          5,
				IsAuthoritative: true,
			},
			want: []PendingEvent{{
				SprintID:    "s1",
				ArtefactID:  "a1",
				EventType:   EventAccepted,
				PointsDelta: -5,
				ScopeDelta:  0,
				PointsAfter: 5,
			}},
		},
		{
			name: "UnacceptedRestores",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s1",
				BeforeKind:      "accepted",
				AfterKind:       "done",
				BeforePoints:    5,
				AfterPoints:     5,
				Points:          5,
				IsAuthoritative: true,
			},
			want: []PendingEvent{{
				SprintID:    "s1",
				ArtefactID:  "a1",
				EventType:   EventUnaccepted,
				PointsDelta: 5,
				ScopeDelta:  0,
				PointsAfter: 5,
			}},
		},
		{
			name: "DoneEarnsNothing",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s1",
				BeforeKind:      "in_progress",
				AfterKind:       "done",
				BeforePoints:    5,
				AfterPoints:     5,
				Points:          5,
				IsAuthoritative: true,
			},
			want: nil,
		},
		{
			name: "Added",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "",
				AfterSprintID:   "s1",
				BeforeKind:      "todo",
				AfterKind:       "todo",
				BeforePoints:    8,
				AfterPoints:     8,
				Points:          8,
				IsAuthoritative: true,
			},
			want: []PendingEvent{{
				SprintID:    "s1",
				ArtefactID:  "a1",
				EventType:   EventAdded,
				PointsDelta: 8,
				ScopeDelta:  8,
				PointsAfter: 8,
			}},
		},
		{
			name: "RemovedWhileAccepted",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "",
				BeforeKind:      "accepted",
				AfterKind:       "accepted",
				BeforePoints:    8,
				AfterPoints:     8,
				Points:          8,
				IsAuthoritative: true,
			},
			want: []PendingEvent{{
				SprintID:    "s1",
				ArtefactID:  "a1",
				EventType:   EventRemoved,
				PointsDelta: 0,
				ScopeDelta:  -8,
				PointsAfter: 8,
			}},
		},
		{
			name: "RemovedWhileUnaccepted",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "",
				BeforeKind:      "in_progress",
				AfterKind:       "in_progress",
				BeforePoints:    8,
				AfterPoints:     8,
				Points:          8,
				IsAuthoritative: true,
			},
			want: []PendingEvent{{
				SprintID:    "s1",
				ArtefactID:  "a1",
				EventType:   EventRemoved,
				PointsDelta: -8,
				ScopeDelta:  -8,
				PointsAfter: 8,
			}},
		},
		{
			name: "PointsChangedUnaccepted",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s1",
				BeforeKind:      "in_progress",
				AfterKind:       "in_progress",
				BeforePoints:    3,
				AfterPoints:     8,
				Points:          8,
				IsAuthoritative: true,
			},
			want: []PendingEvent{{
				SprintID:    "s1",
				ArtefactID:  "a1",
				EventType:   EventPointsChanged,
				PointsDelta: 5,
				ScopeDelta:  5,
				PointsAfter: 8,
			}},
		},
		{
			name: "PointsChangedWhileAccepted",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s1",
				BeforeKind:      "accepted",
				AfterKind:       "accepted",
				BeforePoints:    3,
				AfterPoints:     8,
				Points:          8,
				IsAuthoritative: true,
			},
			want: []PendingEvent{{
				SprintID:    "s1",
				ArtefactID:  "a1",
				EventType:   EventPointsChanged,
				PointsDelta: 0,
				ScopeDelta:  5,
				PointsAfter: 8,
			}},
		},
		{
			name: "NonAuthoritativeChild",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s1",
				BeforeKind:      "in_progress",
				AfterKind:       "accepted",
				BeforePoints:    5,
				AfterPoints:     5,
				Points:          5,
				IsAuthoritative: false,
			},
			want: nil,
		},
		{
			name: "MoveBetweenSprintsUnaccepted",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s2",
				BeforeKind:      "in_progress",
				AfterKind:       "in_progress",
				BeforePoints:    8,
				AfterPoints:     8,
				Points:          8,
				IsAuthoritative: true,
			},
			want: []PendingEvent{
				{SprintID: "s1", ArtefactID: "a1", EventType: EventRemoved, ScopeDelta: -8, PointsDelta: -8, PointsAfter: 8},
				{SprintID: "s2", ArtefactID: "a1", EventType: EventAdded, ScopeDelta: 8, PointsDelta: 8, PointsAfter: 8},
			},
		},
		{
			name: "MoveBetweenSprintsWhileAcceptedInSource",
			in: ArtefactDelta{
				ArtefactID:      "a1",
				BeforeSprintID:  "s1",
				AfterSprintID:   "s2",
				BeforeKind:      "accepted",
				AfterKind:       "accepted",
				BeforePoints:    8,
				AfterPoints:     8,
				Points:          8,
				IsAuthoritative: true,
			},
			// Source remaining was already burned (accepted) so only its scope
			// drops; the destination gains full scope + remaining.
			want: []PendingEvent{
				{SprintID: "s1", ArtefactID: "a1", EventType: EventRemoved, ScopeDelta: -8, PointsDelta: 0, PointsAfter: 8},
				{SprintID: "s2", ArtefactID: "a1", EventType: EventAdded, ScopeDelta: 8, PointsDelta: 8, PointsAfter: 8},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := DeriveBurnEvents(tc.in)
			if len(got) != len(tc.want) {
				t.Fatalf("event count: got %d %+v, want %d %+v", len(got), got, len(tc.want), tc.want)
			}
			for i := range tc.want {
				if got[i] != tc.want[i] {
					t.Errorf("event[%d]: got %+v, want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}
