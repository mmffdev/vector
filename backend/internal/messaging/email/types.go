package email

// Channel identifies a logical mail purpose. Per-channel toggles, templates,
// and audit metadata key off this value, so renaming a channel is a breaking
// change for ops/config.
type Channel string

const (
	ChannelPasswordReset    Channel = "password_reset"
	ChannelPasswordChanged  Channel = "password_changed"
	ChannelUserUpdate       Channel = "user_update"
	ChannelSystemBroadcast  Channel = "system_broadcast"
	ChannelCustom           Channel = "custom"
)

// Message is the rendered envelope handed to a Transport. Subject + Body
// are already final strings (templates resolved upstream).
type Message struct {
	To      string
	Subject string
	Body    string
}

// Result is what every public Send* method returns. Sent=false with Err==nil
// means the channel was disabled by flag — caller can treat that as a
// non-error skip. Sent=false with Err!=nil means the transport failed.
type Result struct {
	Channel Channel
	To      string
	Sent    bool
	Reason  string // "disabled", "rendered", "ok", or transport-specific
	Err     error
}
