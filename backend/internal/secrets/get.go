package secrets

import (
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
)

// Get returns the value of the environment variable named by key.
// If the value starts with ENC[aes256gcm:...], it is decrypted using the
// 32-byte master key read from the MASTER_KEY env var (hex-encoded, 64 chars).
// Plain values pass through unchanged.
// If decryption fails (bad key, corrupted ciphertext), Get panics — a
// misconfigured secret should crash at startup, not silently return garbage.
func Get(key string) string {
	raw := os.Getenv(key)

	if !strings.HasPrefix(raw, "ENC[") {
		return raw
	}

	masterHex := os.Getenv("MASTER_KEY")
	if len(masterHex) != 64 {
		panic(fmt.Sprintf(
			"secrets.Get: cannot decrypt %q: MASTER_KEY must be a 64-char hex string (got %d chars)",
			key, len(masterHex),
		))
	}

	masterKey, err := hex.DecodeString(masterHex)
	if err != nil {
		panic(fmt.Sprintf(
			"secrets.Get: cannot decrypt %q: MASTER_KEY is not valid hex: %v",
			key, err,
		))
	}

	plaintext, err := Decrypt(raw, masterKey)
	if err != nil {
		if errors.Is(err, ErrNotEncrypted) {
			// Shouldn't happen since we checked the prefix, but be safe.
			return raw
		}
		panic(fmt.Sprintf(
			"secrets.Get: decryption of %q failed: %v",
			key, err,
		))
	}

	return plaintext
}
