// Command encsecret encrypts or decrypts a single value using the
// AES-256-GCM envelope format produced by internal/secrets.
//
// Usage:
//
//	encsecret -value <plaintext> [-key <hex>]
//	encsecret -decrypt -value <ENC[...]> [-key <hex>]
//
// The master key must be 32 bytes, supplied as 64 hex characters via the
// -key flag or the MASTER_KEY environment variable.  On success the tool
// prints only the result to stdout so it can be captured with $(...).
package main

import (
	"encoding/hex"
	"flag"
	"fmt"
	"os"

	"github.com/mmffdev/vector-backend/internal/secrets"
)

const usage = `encsecret — encrypt / decrypt values with AES-256-GCM

Usage:
  encsecret -value <plaintext>           [-key <64-hex-chars>]
  encsecret -decrypt -value <ENC[...]>   [-key <64-hex-chars>]

Flags:
  -value    string   plaintext to encrypt, or ENC[...] to decrypt (required)
  -key      string   64-hex-char master key (default: MASTER_KEY env var)
  -decrypt           treat -value as an encrypted envelope and print plaintext

The -key flag takes priority over the MASTER_KEY environment variable.
Exit codes: 0 = success, 1 = error.
`

func main() {
	fs := flag.NewFlagSet("encsecret", flag.ContinueOnError)
	fs.Usage = func() { fmt.Fprint(os.Stderr, usage) }

	value := fs.String("value", "", "value to encrypt or decrypt")
	keyHex := fs.String("key", "", "64-hex-char master key (overrides MASTER_KEY env var)")
	decrypt := fs.Bool("decrypt", false, "decrypt the -value instead of encrypting")

	if err := fs.Parse(os.Args[1:]); err != nil {
		// flag package already printed the error; ContinueOnError means we
		// get here for -help too — both are fine exits.
		os.Exit(1)
	}

	if *value == "" {
		fmt.Fprintln(os.Stderr, "error: -value is required")
		fmt.Fprint(os.Stderr, usage)
		os.Exit(1)
	}

	// Resolve the hex key: flag takes priority over env var.
	rawHex := *keyHex
	if rawHex == "" {
		rawHex = os.Getenv("MASTER_KEY")
	}
	if rawHex == "" {
		fmt.Fprintln(os.Stderr, "error: master key not set — provide -key flag or MASTER_KEY env var")
		os.Exit(1)
	}
	if len(rawHex) != 64 {
		fmt.Fprintf(os.Stderr, "error: master key must be 64 hex characters (32 bytes), got %d characters\n", len(rawHex))
		os.Exit(1)
	}

	masterKey, err := hex.DecodeString(rawHex)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: master key is not valid hex: %v\n", err)
		os.Exit(1)
	}

	if *decrypt {
		plaintext, err := secrets.Decrypt(*value, masterKey)
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: decryption failed: %v\n", err)
			os.Exit(1)
		}
		fmt.Print(plaintext)
		return
	}

	encrypted, err := secrets.Encrypt(*value, masterKey)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: encryption failed: %v\n", err)
		os.Exit(1)
	}
	fmt.Print(encrypted)
}
