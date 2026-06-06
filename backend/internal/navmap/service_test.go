package navmap

import "testing"

func TestAssembleSpine_NestsPagesUnderBuckets(t *testing.T) {
	buckets := []SpineBucket{{TagEnum: "planning", Label: "Planning", Order: 1}}
	pages := []SpinePage{
		{KeyEnum: "work-items", Label: "Work Items", Href: "/work-items"},
		{KeyEnum: "scope", Label: "Scope", Href: "/scope"},
	}
	tagOf := map[string]string{"work-items": "planning", "scope": "planning"}

	resp := assembleSpine(buckets, pages, tagOf)

	if len(resp.Buckets) != 1 {
		t.Fatalf("want 1 bucket, got %d", len(resp.Buckets))
	}
	if len(resp.Buckets[0].Pages) != 2 {
		t.Fatalf("want 2 pages under planning, got %d", len(resp.Buckets[0].Pages))
	}
	if len(resp.Untagged) != 0 {
		t.Fatalf("want 0 untagged, got %d", len(resp.Untagged))
	}
}

func TestAssembleSpine_CollectsUntagged(t *testing.T) {
	buckets := []SpineBucket{{TagEnum: "planning", Label: "Planning"}}
	pages := []SpinePage{{KeyEnum: "ghost", Label: "Ghost", Href: "/ghost"}}
	tagOf := map[string]string{"ghost": "no-such-bucket"}

	resp := assembleSpine(buckets, pages, tagOf)

	if len(resp.Untagged) != 1 {
		t.Fatalf("want 1 untagged page, got %d", len(resp.Untagged))
	}
	if len(resp.Buckets[0].Pages) != 0 {
		t.Fatalf("want 0 pages under planning, got %d", len(resp.Buckets[0].Pages))
	}
}

func TestAssembleSpine_EmptyInputs(t *testing.T) {
	resp := assembleSpine(nil, nil, nil)
	if len(resp.Buckets) != 0 {
		t.Fatalf("want 0 buckets, got %d", len(resp.Buckets))
	}
	if len(resp.Untagged) != 0 {
		t.Fatalf("want 0 untagged, got %d", len(resp.Untagged))
	}
	// Contract: slices are non-nil so JSON serializes as [] not null.
	if resp.Buckets == nil {
		t.Fatalf("Buckets must be non-nil (serializes as [])")
	}
	if resp.Untagged == nil {
		t.Fatalf("Untagged must be non-nil (serializes as [])")
	}
}

func TestAssembleSpine_EmptyBucketHasNonNilPages(t *testing.T) {
	buckets := []SpineBucket{{TagEnum: "empty", Label: "Empty"}}
	resp := assembleSpine(buckets, nil, nil)
	if resp.Buckets[0].Pages == nil {
		t.Fatalf("a bucket with no pages must have non-nil Pages (serializes as [])")
	}
}
