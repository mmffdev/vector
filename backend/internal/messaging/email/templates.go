package email

import (
	"bytes"
	"text/template"
)

// Templates are kept inline as Go strings — no filesystem read at runtime,
// no embed.FS coupling. When a channel needs HTML or richer layout, lift
// it to its own file and switch to embed.FS in one move.

var (
	tmplPasswordReset = template.Must(template.New("password_reset").Parse(
		"Click the link below to reset your password:\r\n\r\n{{.Link}}\r\n\r\n" +
			"If you did not request this, ignore this email.\r\n",
	))

	tmplPasswordChanged = template.Must(template.New("password_changed").Parse(
		"Your password was just changed. If this was not you, contact an administrator immediately.\r\n",
	))
)

func renderPasswordReset(link string) (subject, body string, err error) {
	var buf bytes.Buffer
	if err := tmplPasswordReset.Execute(&buf, map[string]string{"Link": link}); err != nil {
		return "", "", err
	}
	return "Password reset", buf.String(), nil
}

func renderPasswordChanged() (subject, body string, err error) {
	var buf bytes.Buffer
	if err := tmplPasswordChanged.Execute(&buf, nil); err != nil {
		return "", "", err
	}
	return "Password changed", buf.String(), nil
}
