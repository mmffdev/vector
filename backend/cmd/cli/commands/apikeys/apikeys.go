// Package apikeys implements `mmff api-keys ...`.
package apikeys

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"

	"github.com/mmffdev/vector-backend/cmd/cli/client"
	"github.com/mmffdev/vector-backend/cmd/cli/printer"
)

func Command() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "api-keys",
		Aliases: []string{"keys"},
		Short:   "Issue, list and revoke API keys for the current subscription",
	}
	cmd.AddCommand(listCmd(), issueCmd(), revokeCmd())
	return cmd
}

type keyInfo struct {
	ID         string   `json:"id"`
	Prefix     string   `json:"prefix"`
	Scopes     []string `json:"scopes"`
	CreatedAt  string   `json:"created_at"`
	ExpiresAt  *string  `json:"expires_at"`
	RevokedAt  *string  `json:"revoked_at"`
	LastUsedAt *string  `json:"last_used_at"`
}

type listResp struct {
	Keys []keyInfo `json:"keys"`
}

func listCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List API keys",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			var lr listResp
			if err := c.Do(http.MethodGet, "/v1/api/admin/api-keys", nil, &lr); err != nil {
				return err
			}
			if asJSON {
				return printer.JSON(cmd.OutOrStdout(), lr)
			}
			rows := make([][]any, 0, len(lr.Keys))
			for _, k := range lr.Keys {
				revoked := "no"
				if k.RevokedAt != nil {
					revoked = *k.RevokedAt
				}
				lastUsed := ""
				if k.LastUsedAt != nil {
					lastUsed = *k.LastUsedAt
				}
				rows = append(rows, []any{k.ID, k.Prefix, strings.Join(k.Scopes, ","), k.CreatedAt, lastUsed, revoked})
			}
			return printer.Table(cmd.OutOrStdout(), []string{"ID", "PREFIX", "SCOPES", "CREATED", "LAST_USED", "REVOKED"}, rows)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "raw JSON output")
	return cmd
}

type issueReq struct {
	ExpiresAt *string  `json:"expires_at,omitempty"`
	Scopes    []string `json:"scopes,omitempty"`
}

type issueResp struct {
	Key struct {
		ID        string  `json:"id"`
		Prefix    string  `json:"prefix"`
		RawKey    string  `json:"raw_key"`
		CreatedAt string  `json:"created_at"`
		ExpiresAt *string `json:"expires_at"`
	} `json:"key"`
}

func issueCmd() *cobra.Command {
	var scopes []string
	var expires string
	cmd := &cobra.Command{
		Use:   "issue",
		Short: "Issue a new API key — the raw key is shown only once, save it",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			body := issueReq{Scopes: scopes}
			if expires != "" {
				body.ExpiresAt = &expires
			}
			var resp issueResp
			if err := c.Do(http.MethodPost, "/v1/api/admin/api-keys/issue", body, &resp); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(),
				"ID      : %s\nPrefix  : %s\nCreated : %s\nKey     : %s\n\nSave the key now — it is not retrievable later.\n",
				resp.Key.ID, resp.Key.Prefix, resp.Key.CreatedAt, resp.Key.RawKey)
			return nil
		},
	}
	cmd.Flags().StringSliceVar(&scopes, "scope", nil, "scope to grant (repeatable, e.g. --scope read:portfolio)")
	cmd.Flags().StringVar(&expires, "expires", "", "expiration timestamp (RFC3339, e.g. 2026-12-31T00:00:00Z)")
	return cmd
}

func revokeCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "revoke <id>",
		Short: "Revoke an API key by ID",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			if err := c.Do(http.MethodPost, "/v1/api/admin/api-keys/revoke", map[string]string{"id": args[0]}, nil); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Revoked %s\n", args[0])
			return nil
		},
	}
	return cmd
}
