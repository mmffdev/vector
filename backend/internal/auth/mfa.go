package auth

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/mmffdev/vector-backend/internal/roletypes"
	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

// Recovery code constants.
const (
	recoveryCodeLen   = 16 // chars per code (alphanumeric)
	recoveryCodeCount = 8  // codes generated at enrollment
	recoveryCodeAlpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // unambiguous charset
)

var (
	ErrMFAInvalidCode      = errors.New("mfa_invalid: code is incorrect or expired")
	ErrRecoveryCodeInvalid = errors.New("mfa_invalid: recovery code is invalid or already used")
	ErrMFANotEnrolled      = errors.New("mfa not enrolled")
	ErrMFAAlreadyEnrolled  = errors.New("mfa already enrolled")
)

// GenerateTOTPSecret creates a new TOTP key for the given user email
// and returns the key (which carries both the secret and the otpauth:// URI).
// The raw secret is stored in mfa_secret; the otpauth URI is shown to the
// user as a QR code.
func GenerateTOTPSecret(email string) (*otp.Key, error) {
	return totp.Generate(totp.GenerateOpts{
		Issuer:      "Vector",
		AccountName: email,
		Period:      30,
		Digits:      otp.DigitsSix,
		Algorithm:   otp.AlgorithmSHA1,
	})
}

// ValidateTOTPCode checks a 6-digit code against the stored secret.
// Accepts one window of clock skew (±30 s) via the opts.
func ValidateTOTPCode(secret, code string) bool {
	return totp.Validate(code, secret)
}

// GenerateRecoveryCodes produces recoveryCodeCount single-use recovery
// codes. Returns two parallel slices: plaintext (shown once to the user)
// and bcrypt hashes (stored in mfa_recovery_codes).
func GenerateRecoveryCodes() (plain []string, hashed []string, err error) {
	plain = make([]string, recoveryCodeCount)
	hashed = make([]string, recoveryCodeCount)

	alphabet := []byte(recoveryCodeAlpha)
	buf := make([]byte, recoveryCodeLen)

	for i := range plain {
		if _, err = rand.Read(buf); err != nil {
			return nil, nil, err
		}
		code := make([]byte, recoveryCodeLen)
		for j, b := range buf {
			code[j] = alphabet[int(b)%len(alphabet)]
		}
		plain[i] = string(code)
		h, herr := bcrypt.GenerateFromPassword([]byte(plain[i]), BcryptCost)
		if herr != nil {
			return nil, nil, herr
		}
		hashed[i] = string(h)
	}
	return plain, hashed, nil
}

// UseRecoveryCode validates a recovery code against the stored bcrypt hashes.
// On success it marks the slot as spent (replaces it with the empty string in
// the DB) and returns the updated hashes slice. Returns
// ErrRecoveryCodeInvalid if no slot matches.
func UseRecoveryCode(storedHashes []string, candidate string) ([]string, error) {
	candidate = strings.ToUpper(strings.ReplaceAll(candidate, "-", ""))
	for i, h := range storedHashes {
		if h == "" {
			continue // already spent
		}
		if bcrypt.CompareHashAndPassword([]byte(h), []byte(candidate)) == nil {
			updated := make([]string, len(storedHashes))
			copy(updated, storedHashes)
			updated[i] = "" // spend the slot
			return updated, nil
		}
	}
	return nil, ErrRecoveryCodeInvalid
}

// ── Service methods ──────────────────────────────────────────────────────────

// MFAEnroll generates a new TOTP secret and stores it against the user.
// Enrollment is NOT confirmed until MFAConfirm is called — mfa_enrolled
// stays false until then.
// Returns the otpauth:// URI (for QR rendering) and the plaintext recovery
// codes (shown once; hashes stored in DB).
func (s *Service) MFAEnroll(ctx context.Context, userID uuid.UUID, email string) (otpauthURI string, recoveryCodes []string, err error) {
	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return "", nil, err
	}
	if u.MFAEnrolled {
		return "", nil, ErrMFAAlreadyEnrolled
	}

	key, err := GenerateTOTPSecret(email)
	if err != nil {
		return "", nil, err
	}

	plain, hashed, err := GenerateRecoveryCodes()
	if err != nil {
		return "", nil, err
	}

	// Store secret + hashed recovery codes so MFAConfirm can validate.
	// mfa_enrolled stays FALSE until MFAConfirm succeeds.
	if _, err = s.Pool.Exec(ctx, sqlStoreMFASecretAndRecoveries, key.Secret(), hashed, userID); err != nil {
		return "", nil, err
	}

	return key.URL(), plain, nil
}

// MFAConfirm validates a live TOTP code against the stored secret and, on
// success, flips mfa_enrolled=TRUE. The user must call this before any
// login gate takes effect.
func (s *Service) MFAConfirm(ctx context.Context, userID uuid.UUID) (func(code string) error) {
	return func(code string) error {
		u, err := s.FindUserByID(ctx, userID)
		if err != nil {
			return err
		}
		if u.MFASecret == nil || *u.MFASecret == "" {
			return ErrMFANotEnrolled
		}
		if !ValidateTOTPCode(*u.MFASecret, code) {
			return ErrMFAInvalidCode
		}
		plain, hashed, err := GenerateRecoveryCodes()
		_ = plain // already shown at enroll; this is a fresh set on confirm
		if err != nil {
			return err
		}
		_, err = s.Pool.Exec(ctx, sqlConfirmMFAEnrollment, hashed, userID)
		return err
	}
}

// MFAVerifyCode checks a TOTP code or recovery code for a user that has
// mfa_enrolled=TRUE. Returns nil on success. The updated recovery codes
// (with the used slot spent) are written back to the DB when a recovery
// code is used.
func (s *Service) MFAVerifyCode(ctx context.Context, u *roletypes.User, code string) error {
	if !u.MFAEnrolled || u.MFASecret == nil {
		return ErrMFANotEnrolled
	}

	// First try TOTP.
	if ValidateTOTPCode(*u.MFASecret, code) {
		return nil
	}

	// Fall through to recovery codes.
	updated, err := UseRecoveryCode(u.MFARecoveryCodes, code)
	if err != nil {
		return ErrMFAInvalidCode
	}
	// Persist the spent slot.
	_, err = s.Pool.Exec(ctx, sqlUpdateMFARecoveryCodes, updated, u.ID)
	return err
}

// MFADisable clears all MFA state after verifying the user's current
// password. Requires the caller to supply the raw password for confirmation.
func (s *Service) MFADisable(ctx context.Context, userID uuid.UUID, currentPassword string) error {
	u, err := s.FindUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if !VerifyPassword(u.PasswordHash, currentPassword) {
		return ErrInvalidCredentials
	}
	_, err = s.Pool.Exec(ctx, sqlDisableMFA, userID)
	return err
}

// ── helpers ──────────────────────────────────────────────────────────────────

// generateSecret is a lower-level helper that returns a base32-encoded
// random secret suitable for TOTP. Used in tests.
func generateSecret() (string, error) {
	b := make([]byte, 20) // 160-bit secret → standard TOTP size
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b), nil
}

// clockNow is a package-level hook for tests to override time.Now().
var clockNow = time.Now
