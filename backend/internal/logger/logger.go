// Package logger provides structured JSON logging with optional Loki push.
//
// Usage:
//
//	logger.Info("server started", "port", "5100")
//	logger.Error("db connect failed", "err", err)
//
// Set LOKI_URL in env to enable Loki push (e.g. "http://localhost:3100").
// If LOKI_URL is unset or Loki is unreachable, logs still go to stdout —
// Loki push is always fire-and-forget, never blocks the caller.
package logger

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"
)

// Level represents log severity.
type Level string

const (
	LevelDebug Level = "debug"
	LevelInfo  Level = "info"
	LevelWarn  Level = "warn"
	LevelError Level = "error"
)

var std = New("", "") // reinitialised by Init() after godotenv loads

// Init wires the package-level logger with env vars. Call once after godotenv.Load.
func Init() {
	std = New(os.Getenv("LOKI_URL"), os.Getenv("LOKI_JOB"))
}

// Logger is a structured logger that writes JSON to stdout and optionally
// ships entries to Loki via HTTP push.
type Logger struct {
	lokiURL string
	job     string
	env     string
	client  *http.Client
	mu      sync.Mutex
	buf     []lokiEntry
	flush   chan struct{}
}

type lokiEntry struct {
	ts  time.Time
	msg string
}

// New creates a Logger. lokiURL may be empty to disable Loki push.
func New(lokiURL, job string) *Logger {
	if job == "" {
		job = "vector-backend"
	}
	env := os.Getenv("BACKEND_ENV")
	if env == "" {
		env = "dev"
	}
	l := &Logger{
		lokiURL: lokiURL,
		job:     job,
		env:     env,
		client:  &http.Client{Timeout: 3 * time.Second},
		flush:   make(chan struct{}, 1),
	}
	if lokiURL != "" {
		go l.shipper()
	}
	return l
}

// Info logs at info level.
func Info(msg string, kv ...any) { std.log(LevelInfo, msg, kv...) }

// Warn logs at warn level.
func Warn(msg string, kv ...any) { std.log(LevelWarn, msg, kv...) }

// Error logs at error level.
func Error(msg string, kv ...any) { std.log(LevelError, msg, kv...) }

// Debug logs at debug level.
func Debug(msg string, kv ...any) { std.log(LevelDebug, msg, kv...) }

// Info logs at info level on a specific logger instance.
func (l *Logger) Info(msg string, kv ...any) { l.log(LevelInfo, msg, kv...) }

// Warn logs at warn level on a specific logger instance.
func (l *Logger) Warn(msg string, kv ...any) { l.log(LevelWarn, msg, kv...) }

// Error logs at error level on a specific logger instance.
func (l *Logger) Error(msg string, kv ...any) { l.log(LevelError, msg, kv...) }

// Debug logs at debug level on a specific logger instance.
func (l *Logger) Debug(msg string, kv ...any) { l.log(LevelDebug, msg, kv...) }

func (l *Logger) log(level Level, msg string, kv ...any) {
	now := time.Now().UTC()

	// Build structured JSON line.
	entry := map[string]any{
		"ts":    now.Format(time.RFC3339Nano),
		"level": string(level),
		"msg":   msg,
		"job":   l.job,
		"env":   l.env,
	}
	for i := 0; i+1 < len(kv); i += 2 {
		key := fmt.Sprintf("%v", kv[i])
		entry[key] = kv[i+1]
	}

	b, _ := json.Marshal(entry)
	line := string(b)

	// Always write to stdout via stdlib log (preserves existing behaviour).
	log.Println(line)

	// Queue for Loki push if enabled.
	if l.lokiURL != "" {
		l.mu.Lock()
		l.buf = append(l.buf, lokiEntry{ts: now, msg: line})
		l.mu.Unlock()
		select {
		case l.flush <- struct{}{}:
		default:
		}
	}
}

// shipper runs in a goroutine, batching and pushing entries to Loki.
func (l *Logger) shipper() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-l.flush:
		case <-ticker.C:
		}
		l.ship()
	}
}

func (l *Logger) ship() {
	l.mu.Lock()
	if len(l.buf) == 0 {
		l.mu.Unlock()
		return
	}
	entries := l.buf
	l.buf = nil
	l.mu.Unlock()

	// Build Loki push payload.
	// Format: {"streams":[{"stream":{"job":"...","env":"..."},"values":[["<ts_ns>","<line>"],...]}]}
	values := make([][]string, len(entries))
	for i, e := range entries {
		values[i] = []string{strconv.FormatInt(e.ts.UnixNano(), 10), e.msg}
	}

	payload := map[string]any{
		"streams": []map[string]any{
			{
				"stream": map[string]string{
					"job": l.job,
					"env": l.env,
				},
				"values": values,
			},
		},
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		l.lokiURL+"/loki/api/v1/push",
		bytes.NewReader(b),
	)
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := l.client.Do(req)
	if err != nil {
		return // silent — Loki unavailable should never affect the app
	}
	resp.Body.Close()
}
