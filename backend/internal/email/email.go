package email

import (
	"log"
	"os"
)

type Sender interface {
	SendResetLink(toEmail, link string) error
}

type ConsoleSender struct{}

func (ConsoleSender) SendResetLink(toEmail, link string) error {
	log.Printf("[EMAIL:console] reset link → %s : %s", toEmail, link)
	return nil
}

func NewFromEnv() Sender {
	if os.Getenv("EMAIL_MODE") == "smtp" {
		log.Println("[EMAIL] SMTP mode not implemented; falling back to console")
	}
	return ConsoleSender{}
}
