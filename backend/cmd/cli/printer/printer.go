// Package printer renders CLI output as either text tables or JSON.
package printer

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
)

// JSON pretty-prints v to w.
func JSON(w io.Writer, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(w, string(b))
	return err
}

// Table writes a tab-aligned table. headers length must match each row's length.
// Rows are stringified via fmt.Sprint so numbers, bools, etc., are accepted.
func Table(w io.Writer, headers []string, rows [][]any) error {
	tw := tabwriter.NewWriter(w, 0, 0, 2, ' ', 0)
	if _, err := fmt.Fprintln(tw, strings.Join(headers, "\t")); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(tw, dashes(headers)); err != nil {
		return err
	}
	for _, r := range rows {
		cells := make([]string, len(r))
		for i, c := range r {
			cells[i] = fmt.Sprint(c)
		}
		if _, err := fmt.Fprintln(tw, strings.Join(cells, "\t")); err != nil {
			return err
		}
	}
	return tw.Flush()
}

func dashes(headers []string) string {
	out := make([]string, len(headers))
	for i, h := range headers {
		out[i] = strings.Repeat("-", max(3, len(h)))
	}
	return strings.Join(out, "\t")
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
