package email

import (
	"os"
	"strings"
)

// channelEnabled returns true unless MAIL_CH_<UPPER>_ENABLED is set to a
// false-ish value ("0", "false", "off", "no"). Default is enabled so a
// fresh deploy doesn't silently drop password resets.
//
// Channel "password_reset" → env var MAIL_CH_PASSWORD_RESET_ENABLED.
func channelEnabled(c Channel) bool {
	key := "MAIL_CH_" + strings.ToUpper(string(c)) + "_ENABLED"
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return true
	}
	switch v {
	case "0", "false", "off", "no":
		return false
	}
	return true
}
