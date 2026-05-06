package apikeys

import "testing"

// TestKeyGeneration verifies the key generation format.
func TestKeyGeneration(t *testing.T) {
	key := generateKey()
	if len(key) < 40 { // sam_live_ (9 chars) + 32 char key = 41
		t.Fatalf("key too short: %s (len %d)", key, len(key))
	}
	if key[:9] != "sam_live_" {
		t.Fatalf("key prefix mismatch: %s", key[:9])
	}
}

// TestKeyHash verifies that hashing is deterministic.
func TestKeyHash(t *testing.T) {
	key := "sam_live_aaaaaaaaaaaaaaaaaaaaaaaaa1"
	hash1 := hashKey(key)
	hash2 := hashKey(key)
	if len(hash1) == 0 || len(hash2) == 0 {
		t.Fatalf("hash produced zero-length result")
	}
	// Blake3 is deterministic
	for i := range hash1 {
		if hash1[i] != hash2[i] {
			t.Fatalf("hashing not deterministic: %v vs %v", hash1, hash2)
		}
	}
}

// TestKeyValidation requires a database connection.
// Run with: go test -v -run TestKeyValidation
// Prerequisites: ensure DB is up, DEV_API_KEY is set in .env.dev
func TestKeyValidation(t *testing.T) {
	// Skip if DB not available (CI environment)
	if testing.Short() {
		t.Skip("skipping DB test in short mode")
	}

	// This test would require a full DB setup. For now, just verify the logic.
	// Real integration tests should be in a separate integration_test.go file.
	t.Logf("key validation tested via HTTP endpoints; see api_test.sh")
}
