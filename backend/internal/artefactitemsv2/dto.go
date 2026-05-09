package artefactitemsv2

// MapPublicWorkItem projects the internal WorkItem wire type into its public
// API representation. The two shapes are currently identical — this function
// exists as the required seam (PLA-0039 / Story 00532) so that when the
// internal and public shapes diverge (e.g. stripping subscription_id,
// renaming fields, adding computed fields for external callers) the change
// is a single edit here rather than a hunt across handler call sites.
//
// lint:public-dto-mapper checks for MapPublic* in public-transport handlers;
// add new projections here as additional domains join /samantha/v2.
func MapPublicWorkItem(w WorkItem) WorkItem {
	return w
}

// MapPublicSprint projects the internal Sprint type into its public shape.
func MapPublicSprint(s Sprint) Sprint {
	return s
}
