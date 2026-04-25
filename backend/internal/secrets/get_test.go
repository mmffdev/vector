package secrets_test

import (
	"encoding/hex"
	"os"
	"testing"

	"github.com/mmffdev/vector-backend/internal/secrets"
)

// masterKeyHex returns a valid 64-char hex-encoded master key derived from validKey().
func masterKeyHex() string {
	return hex.EncodeToString(validKey())
}

// TestGetPlainValue verifies that a plain (non-encrypted) env var is returned
// unchanged without consulting MASTER_KEY.
func TestGetPlainValue(t *testing.T) {
	const envKey = "TEST_GET_PLAIN_VALUE"
	t.Setenv(envKey, "hello-world")

	got := secrets.Get(envKey)
	if got != "hello-world" {
		t.Errorf("Get(%q) = %q, want %q", envKey, got, "hello-world")
	}
}

// TestGetEncryptedValue verifies that an ENC[...] value is correctly decrypted
// when a valid MASTER_KEY is set.
func TestGetEncryptedValue(t *testing.T) {
	const envKey = "TEST_GET_ENCRYPTED_VALUE"
	const plaintext = "super-secret-db-password"

	ciphertext, err := secrets.Encrypt(plaintext, validKey())
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}

	t.Setenv(envKey, ciphertext)
	t.Setenv("MASTER_KEY", masterKeyHex())

	got := secrets.Get(envKey)
	if got != plaintext {
		t.Errorf("Get(%q) = %q, want %q", envKey, got, plaintext)
	}
}

// TestGetMissingMasterKeyPanics verifies that Get panics when the env var holds
// an ENC[...] value but MASTER_KEY is not set.
func TestGetMissingMasterKeyPanics(t *testing.T) {
	const envKey = "TEST_GET_MISSING_MASTER_KEY"
	const plaintext = "secret"

	ciphertext, err := secrets.Encrypt(plaintext, validKey())
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}

	t.Setenv(envKey, ciphertext)
	os.Unsetenv("MASTER_KEY")

	defer func() {
		if r := recover(); r == nil {
			t.Error("expected Get to panic when MASTER_KEY is missing, but it did not")
		}
	}()

	secrets.Get(envKey)
}

// TestGetPlainNoMasterKey verifies that a plain value is returned fine even
// when MASTER_KEY is not set — the key is only needed for ENC[...] values.
func TestGetPlainNoMasterKey(t *testing.T) {
	const envKey = "TEST_GET_PLAIN_NO_MASTER_KEY"
	t.Setenv(envKey, "plain-value")
	os.Unsetenv("MASTER_KEY")

	got := secrets.Get(envKey)
	if got != "plain-value" {
		t.Errorf("Get(%q) = %q, want %q", envKey, got, "plain-value")
	}
}
