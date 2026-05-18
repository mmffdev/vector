package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	MFARememberCookiePrefix = "mfa_remember_"
	MFARememberTTL          = 30 * 24 * time.Hour
)

var ErrMFARememberInvalid = errors.New("mfa_remember: token invalid or expired")

// SignMFARememberToken creates a self-verifying token for device trust.
// Format: <expiry_unix>.<nonce>.<hmac>
// The nonce prevents two tokens for the same user issued in the same second
// from being identical. No DB row — revocation is handled by mfa_enrolled=false.
func SignMFARememberToken(userID string) (string, error) {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	if secret == "" {
		return "", errors.New("JWT_ACCESS_SECRET not set")
	}
	expiry := time.Now().Add(MFARememberTTL).Unix()
	nonce := make([]byte, 8)
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	nonceHex := hex.EncodeToString(nonce)
	payload := fmt.Sprintf("%s.%d.%s", userID, expiry, nonceHex)
	mac := hmacHex(secret, payload)
	return fmt.Sprintf("%d.%s.%s", expiry, nonceHex, mac), nil
}

// ParseMFARememberToken validates a token previously signed by SignMFARememberToken.
// Returns ErrMFARememberInvalid if the token is malformed, expired, or tampered.
func ParseMFARememberToken(userID, token string) error {
	secret := os.Getenv("JWT_ACCESS_SECRET")
	if secret == "" {
		return ErrMFARememberInvalid
	}
	parts := strings.SplitN(token, ".", 3)
	if len(parts) != 3 {
		return ErrMFARememberInvalid
	}
	expiry, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || time.Now().Unix() > expiry {
		return ErrMFARememberInvalid
	}
	nonceHex := parts[1]
	gotMAC := parts[2]
	payload := fmt.Sprintf("%s.%d.%s", userID, expiry, nonceHex)
	if !hmac.Equal([]byte(hmacHex(secret, payload)), []byte(gotMAC)) {
		return ErrMFARememberInvalid
	}
	return nil
}

func hmacHex(secret, payload string) string {
	h := hmac.New(sha256.New, []byte(secret))
	h.Write([]byte(payload))
	return hex.EncodeToString(h.Sum(nil))
}

// MFARememberCookieName returns the per-user cookie name.
func MFARememberCookieName(userID string) string {
	return MFARememberCookiePrefix + userID
}

// SetMFARememberCookie writes the 30-day device-trust cookie for a user.
// Secure flag set when the request arrived over TLS (r.TLS != nil) or
// when COOKIE_SECURE=true. B16.8.7.
func SetMFARememberCookie(w http.ResponseWriter, r *http.Request, userID string) error {
	token, err := SignMFARememberToken(userID)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     MFARememberCookieName(userID),
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   isSecureCookieRequest(r),
		SameSite: http.SameSiteStrictMode,
		Expires:  time.Now().Add(MFARememberTTL),
	})
	return nil
}

// ClearMFARememberCookie removes the device-trust cookie for a user.
func ClearMFARememberCookie(w http.ResponseWriter, userID string) {
	http.SetCookie(w, &http.Cookie{
		Name:     MFARememberCookieName(userID),
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
		SameSite: http.SameSiteStrictMode,
	})
}

// CheckMFARememberCookie returns true if the request carries a valid
// device-trust cookie for the given user.
func CheckMFARememberCookie(r *http.Request, userID string) bool {
	c, err := r.Cookie(MFARememberCookieName(userID))
	if err != nil || c.Value == "" {
		return false
	}
	return ParseMFARememberToken(userID, c.Value) == nil
}
