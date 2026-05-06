// Package session loads and saves the local CLI session at ~/.mmff/session.json.
package session

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// Session is the persisted CLI auth state. The refresh token is captured from the
// rt cookie at login time so the CLI can renew its own access token without keeping
// the cookie jar around between invocations.
type Session struct {
	BaseURL      string    `json:"base_url"`
	Email        string    `json:"email"`
	UserID       string    `json:"user_id"`
	AccessToken  string    `json:"access_token"`
	RefreshToken string    `json:"refresh_token"`
	CSRFToken    string    `json:"csrf_token"`
	IssuedAt     time.Time `json:"issued_at"`
}

// Path returns the canonical session file path.
func Path() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home dir: %w", err)
	}
	return filepath.Join(home, ".mmff", "session.json"), nil
}

// Load reads the session from disk. Returns ErrNoSession if the file does not exist.
var ErrNoSession = errors.New("no active session — run `mmff auth login` first")

func Load() (*Session, error) {
	p, err := Path()
	if err != nil {
		return nil, err
	}
	b, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrNoSession
		}
		return nil, fmt.Errorf("read session: %w", err)
	}
	var s Session
	if err := json.Unmarshal(b, &s); err != nil {
		return nil, fmt.Errorf("parse session: %w", err)
	}
	return &s, nil
}

// Save persists the session to ~/.mmff/session.json with 0600 permissions.
func (s *Session) Save() error {
	p, err := Path()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return fmt.Errorf("create session dir: %w", err)
	}
	b, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal session: %w", err)
	}
	return os.WriteFile(p, b, 0o600)
}

// Clear deletes the session file. Safe to call when no session exists.
func Clear() error {
	p, err := Path()
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

// DefaultBaseURL returns the URL the CLI talks to. Override via MMFF_API_URL.
func DefaultBaseURL() string {
	if u := os.Getenv("MMFF_API_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return "http://localhost:5100"
}

// MustParseURL returns u parsed or panics — used for CLI defaults known to be valid.
func MustParseURL(u string) *url.URL {
	parsed, err := url.Parse(u)
	if err != nil {
		panic(err)
	}
	return parsed
}
