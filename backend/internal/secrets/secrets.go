// Package secrets provides AES-256-GCM encrypt/decrypt primitives for
// protecting sensitive values stored in env files.
//
// Encrypted values use the envelope format: ENC[aes256gcm:<base64>]
// where <base64> is the standard-encoding of (nonce || ciphertext || tag).
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
)

const (
	prefix    = "ENC[aes256gcm:"
	suffix    = "]"
	keyLen    = 32 // AES-256 requires a 32-byte key
	nonceLen  = 12 // GCM standard nonce size
)

// ErrNotEncrypted is returned by Decrypt when the value does not carry the
// ENC[aes256gcm:…] envelope.  Callers use this to distinguish a plain
// (not-yet-encrypted) value from a decryption failure.
var ErrNotEncrypted = errors.New("value is not encrypted")

// Encrypt encrypts plaintext with AES-256-GCM using the provided masterKey
// (must be exactly 32 bytes) and returns a string in the format:
//
//	ENC[aes256gcm:<base64(nonce||ciphertext||tag)>]
//
// A fresh random nonce is generated for every call.
func Encrypt(plaintext string, masterKey []byte) (string, error) {
	if len(masterKey) != keyLen {
		return "", fmt.Errorf("secrets: masterKey must be %d bytes, got %d", keyLen, len(masterKey))
	}

	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return "", fmt.Errorf("secrets: creating AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("secrets: creating GCM: %w", err)
	}

	nonce := make([]byte, nonceLen)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("secrets: generating nonce: %w", err)
	}

	// Seal appends the ciphertext and GCM tag to nonce.
	blob := gcm.Seal(nonce, nonce, []byte(plaintext), nil)

	encoded := base64.StdEncoding.EncodeToString(blob)
	return prefix + encoded + suffix, nil
}

// Decrypt decrypts a value produced by Encrypt.  It accepts the
// ENC[aes256gcm:<base64>] envelope format and returns the original plaintext.
//
// Returns ErrNotEncrypted (unwrappable via errors.Is) when the value does not
// carry the expected prefix, so callers can treat the value as plaintext.
func Decrypt(ciphertext string, masterKey []byte) (string, error) {
	if !strings.HasPrefix(ciphertext, prefix) {
		return "", ErrNotEncrypted
	}

	inner := strings.TrimPrefix(ciphertext, prefix)
	inner = strings.TrimSuffix(inner, suffix)

	blob, err := base64.StdEncoding.DecodeString(inner)
	if err != nil {
		return "", fmt.Errorf("secrets: base64 decode: %w", err)
	}

	if len(blob) < nonceLen {
		return "", fmt.Errorf("secrets: ciphertext too short")
	}

	if len(masterKey) != keyLen {
		return "", fmt.Errorf("secrets: masterKey must be %d bytes, got %d", keyLen, len(masterKey))
	}

	block, err := aes.NewCipher(masterKey)
	if err != nil {
		return "", fmt.Errorf("secrets: creating AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("secrets: creating GCM: %w", err)
	}

	nonce, ciphertextBytes := blob[:nonceLen], blob[nonceLen:]
	plaintext, err := gcm.Open(nil, nonce, ciphertextBytes, nil)
	if err != nil {
		return "", fmt.Errorf("secrets: decryption failed (wrong key or corrupted data): %w", err)
	}

	return string(plaintext), nil
}
