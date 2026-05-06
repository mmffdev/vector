// Command mmff is the MMFF Vector CLI — a thin wrapper over the backend's
// HTTP API for scripts, CI, and human use outside the browser.
package main

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"

	apikeyscmd "github.com/mmffdev/vector-backend/cmd/cli/commands/apikeys"
	authcmd "github.com/mmffdev/vector-backend/cmd/cli/commands/auth"
	flowscmd "github.com/mmffdev/vector-backend/cmd/cli/commands/flows"
	portfolioscmd "github.com/mmffdev/vector-backend/cmd/cli/commands/portfolios"
	workitemscmd "github.com/mmffdev/vector-backend/cmd/cli/commands/workitems"
	workspacescmd "github.com/mmffdev/vector-backend/cmd/cli/commands/workspaces"
)

func main() {
	root := &cobra.Command{
		Use:           "mmff",
		Short:         "MMFF Vector CLI",
		Long:          "mmff is the command-line client for the MMFF Vector backend. Sign in with `mmff auth login`, then drive the API from your terminal.",
		SilenceUsage:  true,
		SilenceErrors: true,
	}
	root.AddCommand(
		authcmd.Command(),
		workitemscmd.Command(),
		flowscmd.Command(),
		workspacescmd.Command(),
		portfolioscmd.ItemsCommand(),
		portfolioscmd.ModelsCommand(),
		apikeyscmd.Command(),
	)

	if err := root.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}
