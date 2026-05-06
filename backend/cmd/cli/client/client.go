// Package client wraps the CLI's HTTP calls to the MMFF Vector backend.
//
// All authenticated calls send Bearer access_token + (for state-changing methods)
// the X-CSRF-Token header echoed from the saved cookie value, mirroring the
// browser frontend's contract. On a 401 the client tries one refresh round-trip
// and replays the original request before surfacing an auth error.
package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"

	"github.com/mmffdev/vector-backend/cmd/cli/session"
)

// Client is a session-aware HTTP client.
type Client struct {
	BaseURL string
	Session *session.Session
	HTTP    *http.Client
}

// New returns a client bound to a session loaded from disk.
// If no session exists Session is nil; callers must check before making
// authenticated calls (use NewAnonymous for unauthenticated endpoints).
func New() (*Client, error) {
	s, err := session.Load()
	if err != nil {
		if err == session.ErrNoSession {
			return NewAnonymous(session.DefaultBaseURL()), nil
		}
		return nil, err
	}
	return newClient(s.BaseURL, s), nil
}

// MustAuthenticated returns a client and errors if no saved session exists.
func MustAuthenticated() (*Client, error) {
	s, err := session.Load()
	if err != nil {
		return nil, err
	}
	return newClient(s.BaseURL, s), nil
}

// NewAnonymous builds a client without a session (used by login).
func NewAnonymous(baseURL string) *Client {
	return newClient(baseURL, nil)
}

func newClient(baseURL string, s *session.Session) *Client {
	jar, _ := cookiejar.New(nil)
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		Session: s,
		HTTP: &http.Client{
			Timeout: 30 * time.Second,
			Jar:     jar,
		},
	}
}

// Do issues an authenticated request, decoding the JSON response into out.
// Pass nil for out when the response body is empty (e.g. 204 No Content).
// in may be nil for GETs.
func (c *Client) Do(method, path string, in, out any) error {
	resp, err := c.do(method, path, in, true)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decode(resp, out)
}

// DoUnauth issues a request without attaching the access token (login/refresh paths).
func (c *Client) DoUnauth(method, path string, in, out any) error {
	resp, err := c.do(method, path, in, false)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return decode(resp, out)
}

// DoRaw returns the underlying response so callers can read non-JSON bodies
// or inspect headers (e.g. login needs the Set-Cookie chain).
func (c *Client) DoRaw(method, path string, in any, authenticate bool) (*http.Response, error) {
	return c.do(method, path, in, authenticate)
}

func (c *Client) do(method, path string, in any, authenticate bool) (*http.Response, error) {
	u := c.BaseURL + path
	var body io.Reader
	if in != nil {
		b, err := json.Marshal(in)
		if err != nil {
			return nil, fmt.Errorf("marshal request: %w", err)
		}
		body = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, u, body)
	if err != nil {
		return nil, err
	}
	if in != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")

	if authenticate && c.Session != nil {
		req.Header.Set("Authorization", "Bearer "+c.Session.AccessToken)
		if needsCSRF(method) && c.Session.CSRFToken != "" {
			req.Header.Set("X-CSRF-Token", c.Session.CSRFToken)
			req.AddCookie(&http.Cookie{Name: "csrf_token", Value: c.Session.CSRFToken})
		}
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}

	// One-shot refresh on 401, but only if we have a refresh token to try.
	if resp.StatusCode == http.StatusUnauthorized && authenticate && c.Session != nil && c.Session.RefreshToken != "" {
		resp.Body.Close()
		if rerr := c.refresh(); rerr != nil {
			return nil, fmt.Errorf("session expired: %w", rerr)
		}
		// Replay request with fresh access token.
		return c.do(method, path, in, authenticate)
	}
	return resp, nil
}

func needsCSRF(method string) bool {
	switch method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return false
	}
	return true
}

func (c *Client) refresh() error {
	req, _ := http.NewRequest(http.MethodPost, c.BaseURL+"/v1/api/auth/refresh", nil)
	req.AddCookie(&http.Cookie{Name: "rt", Value: c.Session.RefreshToken})
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("refresh failed (%d)", resp.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("parse refresh response: %w", err)
	}
	c.Session.AccessToken = body.AccessToken
	for _, ck := range resp.Cookies() {
		switch ck.Name {
		case "rt":
			c.Session.RefreshToken = ck.Value
		case "csrf_token":
			c.Session.CSRFToken = ck.Value
		}
	}
	c.Session.IssuedAt = time.Now()
	return c.Session.Save()
}

// APIError surfaces the RFC 9457 problem detail returned by the backend.
type APIError struct {
	Status int
	Title  string
	Detail string
}

func (e *APIError) Error() string {
	if e.Detail != "" {
		return e.Detail
	}
	if e.Title != "" {
		return e.Title
	}
	return fmt.Sprintf("HTTP %d", e.Status)
}

func decode(resp *http.Response, out any) error {
	if resp.StatusCode >= 400 {
		var problem struct {
			Title  string `json:"title"`
			Detail string `json:"detail"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&problem)
		return &APIError{Status: resp.StatusCode, Title: problem.Title, Detail: problem.Detail}
	}
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil && err != io.EOF {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}
