package secrets_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/mmffdev/vector-backend/internal/secrets"
)

// validKey returns a deterministic 32-byte key for tests.
func validKey() []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	return key
}

// differentKey returns a 32-byte key that differs from validKey.
func differentKey() []byte {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(255 - i)
	}
	return key
}

// TestEncryptDecryptRoundtrip verifies that encrypting then decrypting a value
// returns the original plaintext.
func TestEncryptDecryptRoundtrip(t *testing.T) {
	plaintext := "super-secret-database-password"

	encrypted, err := secrets.Encrypt(plaintext, validKey())
	if err != nil {
		t.Fatalf("Encrypt returned unexpected error: %v", err)
	}

	// Confirm the envelope format.
	if !strings.HasPrefix(encrypted, "ENC[aes256gcm:") {
		t.Errorf("expected ENC[aes256gcm:...] prefix, got: %s", encrypted)
	}
	if !strings.HasSuffix(encrypted, "]") {
		t.Errorf("expected ']' suffix, got: %s", encrypted)
	}

	decrypted, err := secrets.Decrypt(encrypted, validKey())
	if err != nil {
		t.Fatalf("Decrypt returned unexpected error: %v", err)
	}

	if decrypted != plaintext {
		t.Errorf("roundtrip mismatch: got %q, want %q", decrypted, plaintext)
	}
}

// TestEncryptProducesUniqueOutputs confirms that two encryptions of the same
// plaintext produce different ciphertexts (nonce randomness).
func TestEncryptProducesUniqueOutputs(t *testing.T) {
	plaintext := "same-plaintext"
	key := validKey()

	a, err := secrets.Encrypt(plaintext, key)
	if err != nil {
		t.Fatalf("first Encrypt error: %v", err)
	}
	b, err := secrets.Encrypt(plaintext, key)
	if err != nil {
		t.Fatalf("second Encrypt error: %v", err)
	}

	if a == b {
		t.Error("two encryptions of the same plaintext produced identical output — nonce is not random")
	}
}

// TestDecryptWrongKey verifies that decrypting with a different key returns an
// error (GCM authentication tag mismatch).
func TestDecryptWrongKey(t *testing.T) {
	encrypted, err := secrets.Encrypt("sensitive-value", validKey())
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}

	_, err = secrets.Decrypt(encrypted, differentKey())
	if err == nil {
		t.Fatal("expected an error when decrypting with wrong key, got nil")
	}
}

// TestErrNotEncrypted verifies that passing a plain (non-envelope) string to
// Decrypt returns ErrNotEncrypted.
func TestErrNotEncrypted(t *testing.T) {
	_, err := secrets.Decrypt("just-a-plain-value", validKey())
	if err == nil {
		t.Fatal("expected ErrNotEncrypted, got nil")
	}
	if !errors.Is(err, secrets.ErrNotEncrypted) {
		t.Errorf("expected errors.Is(err, ErrNotEncrypted), got: %v", err)
	}
}

// TestMasterKeyLength verifies that Encrypt rejects a key that is not 32 bytes.
func TestMasterKeyLength(t *testing.T) {
	cases := []struct {
		name   string
		keyLen int
	}{
		{"empty", 0},
		{"too short (16 bytes)", 16},
		{"too long (64 bytes)", 64},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			key := make([]byte, tc.keyLen)
			_, err := secrets.Encrypt("plaintext", key)
			if err == nil {
				t.Errorf("Encrypt with %d-byte key: expected error, got nil", tc.keyLen)
			}
		})
	}
}
