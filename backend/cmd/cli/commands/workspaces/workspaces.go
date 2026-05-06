// Package workspaces implements `mmff workspaces ...`.
package workspaces

import (
	"net/http"

	"github.com/spf13/cobra"

	"github.com/mmffdev/vector-backend/cmd/cli/client"
	"github.com/mmffdev/vector-backend/cmd/cli/printer"
)

type workspace struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Slug        string  `json:"slug"`
	Description *string `json:"description"`
	ArchivedAt  *string `json:"archived_at"`
}

func Command() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "workspaces",
		Aliases: []string{"ws"},
		Short:   "List workspaces in the caller's tenant",
	}
	cmd.AddCommand(listCmd())
	return cmd
}

func listCmd() *cobra.Command {
	var asJSON bool
	var archived bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List workspaces (default: live only; --archived for archived only)",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			path := "/v1/api/workspaces/"
			if archived {
				path += "?archived=true"
			}
			var rows []workspace
			if err := c.Do(http.MethodGet, path, nil, &rows); err != nil {
				return err
			}
			if asJSON {
				return printer.JSON(cmd.OutOrStdout(), rows)
			}
			out := make([][]any, 0, len(rows))
			for _, w := range rows {
				archivedAt := ""
				if w.ArchivedAt != nil {
					archivedAt = *w.ArchivedAt
				}
				out = append(out, []any{w.ID, w.Slug, w.Name, archivedAt})
			}
			return printer.Table(cmd.OutOrStdout(), []string{"ID", "SLUG", "NAME", "ARCHIVED_AT"}, out)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "raw JSON output")
	cmd.Flags().BoolVar(&archived, "archived", false, "list archived workspaces only")
	return cmd
}
