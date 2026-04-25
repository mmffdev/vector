package email

import (
	"context"
	"log"
)

// SendPasswordReset is the canonical reset-link email. Caller must already
// have inserted the password_resets row before invoking — this method only
// delivers the link.
func (s *Service) SendPasswordReset(ctx context.Context, to, link string) Result {
	if !channelEnabled(ChannelPasswordReset) {
		log.Printf("[EMAIL] channel=%s disabled by flag → %s", ChannelPasswordReset, to)
		return Result{Channel: ChannelPasswordReset, To: to, Sent: false, Reason: "disabled"}
	}
	subject, body, err := renderPasswordReset(link)
	if err != nil {
		return Result{Channel: ChannelPasswordReset, To: to, Sent: false, Reason: "render", Err: err}
	}
	return s.send(ctx, ChannelPasswordReset, Message{To: to, Subject: subject, Body: body})
}

// SendPasswordChanged notifies the user that their password just changed.
// Sent after a successful change (self-service or reset confirm); failure
// should NOT block the change itself — caller discards the Result.
func (s *Service) SendPasswordChanged(ctx context.Context, to string) Result {
	if !channelEnabled(ChannelPasswordChanged) {
		log.Printf("[EMAIL] channel=%s disabled by flag → %s", ChannelPasswordChanged, to)
		return Result{Channel: ChannelPasswordChanged, To: to, Sent: false, Reason: "disabled"}
	}
	subject, body, err := renderPasswordChanged()
	if err != nil {
		return Result{Channel: ChannelPasswordChanged, To: to, Sent: false, Reason: "render", Err: err}
	}
	return s.send(ctx, ChannelPasswordChanged, Message{To: to, Subject: subject, Body: body})
}

// SendUserUpdate is the generic vector→user channel: product updates,
// admin notices, etc. Subject + body are rendered upstream — we don't ship
// templates yet because the content varies per use case. Add a template
// here when a recurring shape emerges.
func (s *Service) SendUserUpdate(ctx context.Context, to, subject, body string) Result {
	if !channelEnabled(ChannelUserUpdate) {
		log.Printf("[EMAIL] channel=%s disabled by flag → %s", ChannelUserUpdate, to)
		return Result{Channel: ChannelUserUpdate, To: to, Sent: false, Reason: "disabled"}
	}
	return s.send(ctx, ChannelUserUpdate, Message{To: to, Subject: subject, Body: body})
}

// SendCustom is the escape hatch for ad-hoc mail (debug, one-off ops). Skip
// templating, skip channel-specific flags, but still respect a global
// MAIL_CH_CUSTOM_ENABLED toggle so this can be wholesale disabled in prod.
func (s *Service) SendCustom(ctx context.Context, to, subject, body string) Result {
	if !channelEnabled(ChannelCustom) {
		log.Printf("[EMAIL] channel=%s disabled by flag → %s", ChannelCustom, to)
		return Result{Channel: ChannelCustom, To: to, Sent: false, Reason: "disabled"}
	}
	return s.send(ctx, ChannelCustom, Message{To: to, Subject: subject, Body: body})
}

func (s *Service) send(ctx context.Context, ch Channel, msg Message) Result {
	if err := s.Transport.Send(ctx, s.From, msg); err != nil {
		return Result{Channel: ch, To: msg.To, Sent: false, Reason: "transport", Err: err}
	}
	return Result{Channel: ch, To: msg.To, Sent: true, Reason: "ok"}
}
