package auth

import (
	"errors"
	"strings"
	"unicode"

	"golang.org/x/crypto/bcrypt"
)

const BcryptCost = 12

var (
	ErrWeakPassword      = errors.New("password must be at least 12 chars with one letter and one digit")
	ErrPasswordEqualsEmail = errors.New("password must not equal email")
)

func HashPassword(raw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(raw), BcryptCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

func VerifyPassword(hash, raw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(raw)) == nil
}

func ValidatePassword(raw, email string) error {
	if len(raw) < 12 {
		return ErrWeakPassword
	}
	if strings.EqualFold(raw, email) {
		return ErrPasswordEqualsEmail
	}
	hasLetter, hasDigit := false, false
	for _, r := range raw {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return ErrWeakPassword
	}
	return nil
}
