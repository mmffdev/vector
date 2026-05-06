// Package workitems implements `mmff work-items ...`.
package workitems

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/spf13/cobra"

	"github.com/mmffdev/vector-backend/cmd/cli/client"
	"github.com/mmffdev/vector-backend/cmd/cli/printer"
)

type workItem struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	TypeID      string `json:"type_id"`
	FlowStateID string `json:"flow_state_id,omitempty"`
	OwnerID     string `json:"owner_id,omitempty"`
	CreatedAt   string `json:"created_at,omitempty"`
}

type listResp struct {
	Items []workItem `json:"items"`
	Total int        `json:"total"`
}

func Command() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "work-items",
		Aliases: []string{"wi", "work-item"},
		Short:   "List and inspect work items",
	}
	cmd.AddCommand(listCmd(), getCmd())
	return cmd
}

func listCmd() *cobra.Command {
	var (
		limit  int
		asJSON bool
	)
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List work items in the caller's tenant",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			q := url.Values{}
			if limit > 0 {
				q.Set("limit", strconv.Itoa(limit))
			}
			path := "/v1/api/work-items/"
			if encoded := q.Encode(); encoded != "" {
				path += "?" + encoded
			}
			var lr listResp
			if err := c.Do(http.MethodGet, path, nil, &lr); err != nil {
				return err
			}
			if asJSON {
				return printer.JSON(cmd.OutOrStdout(), lr)
			}
			rows := make([][]any, 0, len(lr.Items))
			for _, w := range lr.Items {
				rows = append(rows, []any{w.ID, truncate(w.Title, 50), w.TypeID})
			}
			if err := printer.Table(cmd.OutOrStdout(), []string{"ID", "TITLE", "TYPE_ID"}, rows); err != nil {
				return err
			}
			fmt.Fprintf(cmd.OutOrStdout(), "\n%d / %d\n", len(lr.Items), lr.Total)
			return nil
		},
	}
	cmd.Flags().IntVar(&limit, "limit", 0, "max items to return (default: server default)")
	cmd.Flags().BoolVar(&asJSON, "json", false, "raw JSON output")
	return cmd
}

func getCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "get <id>",
		Short: "Show one work item by ID",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			var item map[string]any
			if err := c.Do(http.MethodGet, "/v1/api/work-items/"+args[0], nil, &item); err != nil {
				return err
			}
			return printer.JSON(cmd.OutOrStdout(), item)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", true, "JSON output (default true)")
	return cmd
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
