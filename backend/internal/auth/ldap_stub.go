package auth

import "errors"

// LDAPProvider is a placeholder for a future LDAP bind implementation.
// Not wired up — login always uses local auth today.
type LDAPProvider interface {
	Authenticate(dn, password string) (bool, error)
}

type noopLDAP struct{}

func (noopLDAP) Authenticate(dn, password string) (bool, error) {
	return false, errors.New("ldap not configured")
}

func DefaultLDAP() LDAPProvider { return noopLDAP{} }
