// Package auth implements the `mmff auth ...` subtree.
package auth

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/mmffdev/vector-backend/cmd/cli/session"
)

func loginCmd() *cobra.Command {
	var (
		email   string
		baseURL string
	)
	cmd := &cobra.Command{
		Use:   "login",
		Short: "Sign in and persist a session under ~/.mmff/session.json",
		RunE: func(cmd *cobra.Command, args []string) error {
			if email == "" {
				fmt.Fprint(os.Stderr, "Email: ")
				reader := bufio.NewReader(os.Stdin)
				v, err := reader.ReadString('\n')
				if err != nil {
					return err
				}
				email = strings.TrimSpace(v)
			}
			if email == "" {
				return errors.New("email is required")
			}

			pw, err := readPassword()
			if err != nil {
				return err
			}

			base := baseURL
			if base == "" {
				base = session.DefaultBaseURL()
			}
			base = strings.TrimRight(base, "/")

			body, _ := json.Marshal(map[string]string{"email": email, "password": pw})
			req, _ := http.NewRequest(http.MethodPost, base+"/v1/api/auth/login", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Accept", "application/json")

			httpClient := &http.Client{Timeout: 30 * time.Second}
			resp, err := httpClient.Do(req)
			if err != nil {
				return fmt.Errorf("contact backend: %w", err)
			}
			defer resp.Body.Close()

			if resp.StatusCode != http.StatusOK {
				return decodeProblem(resp)
			}

			var lr struct {
				AccessToken string `json:"access_token"`
				User        struct {
					ID    string `json:"id"`
					Email string `json:"email"`
				} `json:"user"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&lr); err != nil {
				return fmt.Errorf("parse login response: %w", err)
			}

			s := &session.Session{
				BaseURL:     base,
				Email:       lr.User.Email,
				UserID:      lr.User.ID,
				AccessToken: lr.AccessToken,
				IssuedAt:    time.Now(),
			}
			for _, ck := range resp.Cookies() {
				switch ck.Name {
				case "rt":
					s.RefreshToken = ck.Value
				case "csrf_token":
					s.CSRFToken = ck.Value
				}
			}
			if err := s.Save(); err != nil {
				return fmt.Errorf("save session: %w", err)
			}
			p, _ := session.Path()
			fmt.Fprintf(cmd.OutOrStdout(), "Signed in as %s — session saved to %s\n", s.Email, p)
			return nil
		},
	}
	cmd.Flags().StringVarP(&email, "email", "e", "", "account email")
	cmd.Flags().StringVar(&baseURL, "url", "", "backend URL (defaults to MMFF_API_URL or http://localhost:5100)")
	return cmd
}

func readPassword() (string, error) {
	if pw := os.Getenv("MMFF_PASSWORD"); pw != "" {
		return pw, nil
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		// Allow piping passwords via stdin in CI/scripts.
		b, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", err
		}
		return strings.TrimRight(string(b), "\r\n"), nil
	}
	fmt.Fprint(os.Stderr, "Password: ")
	b, err := term.ReadPassword(int(os.Stdin.Fd()))
	fmt.Fprintln(os.Stderr)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func decodeProblem(resp *http.Response) error {
	var p struct {
		Title  string `json:"title"`
		Detail string `json:"detail"`
	}
	_ = json.NewDecoder(resp.Body).Decode(&p)
	if p.Detail != "" {
		return fmt.Errorf("login failed: %s", p.Detail)
	}
	if p.Title != "" {
		return fmt.Errorf("login failed: %s", p.Title)
	}
	return fmt.Errorf("login failed (HTTP %d)", resp.StatusCode)
}
