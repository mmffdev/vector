package auth

import (
	"fmt"
	"net/http"

	"github.com/spf13/cobra"

	"github.com/mmffdev/vector-backend/cmd/cli/client"
	"github.com/mmffdev/vector-backend/cmd/cli/session"
)

func logoutCmd() *cobra.Command {
	return &cobra.Command{
		Use:   "logout",
		Short: "Forget the saved session",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				if err == session.ErrNoSession {
					fmt.Fprintln(cmd.OutOrStdout(), "Already signed out.")
					return nil
				}
				return err
			}
			// Best-effort server-side logout — ignore errors so a stale token still clears.
			_, _ = c.DoRaw(http.MethodPost, "/v1/api/auth/logout", nil, true)
			if err := session.Clear(); err != nil {
				return fmt.Errorf("clear session: %w", err)
			}
			fmt.Fprintln(cmd.OutOrStdout(), "Signed out — session removed.")
			return nil
		},
	}
}
