// Package flows implements `mmff flows ...`.
package flows

import (
	"net/http"

	"github.com/spf13/cobra"

	"github.com/mmffdev/vector-backend/cmd/cli/client"
	"github.com/mmffdev/vector-backend/cmd/cli/printer"
)

func Command() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "flows",
		Short: "Inspect tenant flow states",
	}
	cmd.AddCommand(listCmd())
	return cmd
}

func listCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List all flow groups (system + tenant + portfolio) for the caller",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			var resp map[string]any
			if err := c.Do(http.MethodGet, "/v1/api/flows/", nil, &resp); err != nil {
				return err
			}
			if asJSON {
				return printer.JSON(cmd.OutOrStdout(), resp)
			}
			return printSummary(cmd, resp)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "raw JSON output")
	return cmd
}

func printSummary(cmd *cobra.Command, resp map[string]any) error {
	rows := [][]any{}
	for _, section := range []string{"system", "tenant", "portfolio"} {
		groups, ok := resp[section].([]any)
		if !ok {
			continue
		}
		for _, gAny := range groups {
			g, ok := gAny.(map[string]any)
			if !ok {
				continue
			}
			label, _ := g["target_label"].(string)
			states, _ := g["states"].([]any)
			rows = append(rows, []any{section, label, len(states)})
		}
	}
	return printer.Table(cmd.OutOrStdout(), []string{"SECTION", "GROUP", "STATE_COUNT"}, rows)
}
