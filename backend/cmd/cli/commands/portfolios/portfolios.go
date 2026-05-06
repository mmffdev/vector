// Package portfolios implements `mmff portfolios ...` and `mmff models ...`.
package portfolios

import (
	"net/http"

	"github.com/spf13/cobra"

	"github.com/mmffdev/vector-backend/cmd/cli/client"
	"github.com/mmffdev/vector-backend/cmd/cli/printer"
)

func ItemsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:     "portfolios",
		Aliases: []string{"portfolio-items"},
		Short:   "Read portfolio items",
	}
	cmd.AddCommand(itemGetCmd())
	return cmd
}

func itemGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <id>",
		Short: "Get one portfolio item by ID",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			var v map[string]any
			if err := c.Do(http.MethodGet, "/v1/api/portfolio-items/"+args[0], nil, &v); err != nil {
				return err
			}
			return printer.JSON(cmd.OutOrStdout(), v)
		},
	}
	return cmd
}

func ModelsCommand() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "models",
		Short: "Read portfolio models (layer hierarchies — padmin only)",
	}
	cmd.AddCommand(modelsListCmd(), modelsGetCmd())
	return cmd
}

type templateLayer struct {
	Tag  string `json:"tag"`
	Name string `json:"name"`
}

type model struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description *string         `json:"description"`
	Layers      []templateLayer `json:"layers"`
}

type modelsListResp struct {
	Models []model `json:"models"`
}

func modelsListCmd() *cobra.Command {
	var asJSON bool
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List portfolio models",
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			var lr modelsListResp
			if err := c.Do(http.MethodGet, "/v1/api/portfolio-models/", nil, &lr); err != nil {
				return err
			}
			if asJSON {
				return printer.JSON(cmd.OutOrStdout(), lr)
			}
			rows := make([][]any, 0, len(lr.Models))
			for _, m := range lr.Models {
				desc := ""
				if m.Description != nil {
					desc = *m.Description
				}
				rows = append(rows, []any{m.ID, m.Name, desc, len(m.Layers)})
			}
			return printer.Table(cmd.OutOrStdout(), []string{"ID", "NAME", "DESCRIPTION", "LAYERS"}, rows)
		},
	}
	cmd.Flags().BoolVar(&asJSON, "json", false, "raw JSON output")
	return cmd
}

func modelsGetCmd() *cobra.Command {
	cmd := &cobra.Command{
		Use:   "get <id>",
		Short: "Get one portfolio model with its layers",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			c, err := client.MustAuthenticated()
			if err != nil {
				return err
			}
			var v map[string]any
			if err := c.Do(http.MethodGet, "/v1/api/portfolio-models/"+args[0], nil, &v); err != nil {
				return err
			}
			return printer.JSON(cmd.OutOrStdout(), v)
		},
	}
	return cmd
}
