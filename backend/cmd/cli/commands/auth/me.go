package auth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/spf13/cobra"

	"github.com/mmffdev/vector-backend/cmd/cli/client"
)

type meResp struct {
	ID             string   `json:"id"`
	Email          string   `json:"email"`
	SubscriptionID string   `json:"subscription_id"`
	IsActive       bool     `json:"is_active"`
	AuthMethod     string   `json:"auth_method"`
	Permissions    []string `json:"permissions"`
	Role           struct {
		Code  string `json:"code"`
		Label string `json:"label"`
		Rank  int    `json:"rank"`
	} `json:"role"`
}

func meCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "me",
		Short: "Print the signed-in user's profile",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			var me meResp
			if err := c.Do(http.MethodGet, "/v1/api/auth/me", nil, &me); err != nil {
				return err
			}
			if asJSON {
				b, _ := json.MarshalIndent(me, "", "  ")
				fmt.Fprintln(cmd.OutOrStdout(), string(b))
				return nil
			}
			fmt.Fprintf(cmd.OutOrStdout(), "Email      : %s\n", me.Email)
			fmt.Fprintf(cmd.OutOrStdout(), "User ID    : %s\n", me.ID)
			fmt.Fprintf(cmd.OutOrStdout(), "Role       : %s (%s)\n", me.Role.Label, me.Role.Code)
			fmt.Fprintf(cmd.OutOrStdout(), "Active     : %t\n", me.IsActive)
			fmt.Fprintf(cmd.OutOrStdout(), "Auth method: %s\n", me.AuthMethod)
			if len(me.Permissions) > 0 {
				fmt.Fprintf(cmd.OutOrStdout(), "Permissions: %s\n", strings.Join(me.Permissions, ", "))
			}
			return nil
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "print full profile as JSON")
	return cmd
}

// Command returns the assembled `auth` subtree.
func Command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "auth",
		Short: "Authenticate and manage the local CLI session",
	}
	cmd.AddCommand(loginCmd(), logoutCmd(), meCmd())
	return cmd
}
