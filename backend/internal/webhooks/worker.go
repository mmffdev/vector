// Package webhooks — delivery worker.
//
// Consumes webhook_deliveries rows and POSTs the payload to the
// subscriber's URL. Runs as a background goroutine.
//
// Delivery guarantee: at-least-once via FOR UPDATE SKIP LOCKED.
// Retry policy: exponential backoff (base 30s, cap 6h), up to
// max_attempts per row. Rows are deleted on success.
//
// Signature: HMAC-SHA256 of the raw JSON payload, keyed on the
// subscription secret. Sent as X-Vector-Signature: sha256=<hex>.
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	workerPollInterval = 10 * time.Second
	workerClaimTimeout = 30 * time.Second
	deliveryTimeout    = 10 * time.Second
	backoffBase        = 30 * time.Second
	backoffCap         = 6 * time.Hour
)

// Worker delivers webhook_deliveries rows.
type Worker struct {
	pool   *pgxpool.Pool
	client *http.Client
}

func NewWorker(pool *pgxpool.Pool) *Worker {
	return &Worker{
		pool:   pool,
		client: &http.Client{Timeout: deliveryTimeout},
	}
}

// Run starts the worker loop. Blocks until ctx is cancelled.
func (w *Worker) Run(ctx context.Context) {
	log.Println("webhooks/worker: started")
	ticker := time.NewTicker(workerPollInterval)
	defer ticker.Stop()

	for {
		w.drain(ctx)
		select {
		case <-ctx.Done():
			log.Println("webhooks/worker: shutting down")
			return
		case <-ticker.C:
		}
	}
}

func (w *Worker) drain(ctx context.Context) {
	for {
		done, err := w.claimAndDeliver(ctx)
		if err != nil {
			log.Printf("webhooks/worker: claim error: %v", err)
			return
		}
		if done {
			return
		}
	}
}

func (w *Worker) claimAndDeliver(ctx context.Context) (done bool, err error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	claimCtx, cancel := context.WithTimeout(ctx, workerClaimTimeout)
	defer cancel()

	var (
		deliveryID     int64
		subscriptionID string
		eventType      string
		payload        []byte
		attempts       int
		maxAttempts    int
		secret         string
		url            string
	)

	err = tx.QueryRow(claimCtx, sqlClaimNextDelivery).
		Scan(&deliveryID, &subscriptionID, &eventType, &payload,
			&attempts, &maxAttempts, &secret, &url)
	if err != nil {
		tx.Rollback(ctx)
		// pgx returns nil rows as a scan error with no rows
		if isNoRows(err) {
			return true, nil
		}
		return false, err
	}

	// Mark claimed.
	if _, err := tx.Exec(claimCtx, sqlMarkDeliveryClaimed, deliveryID); err != nil {
		return false, err
	}
	if err := tx.Commit(claimCtx); err != nil {
		return false, err
	}

	// Deliver outside the transaction.
	deliveryErr := w.deliver(ctx, url, secret, eventType, payload)
	if deliveryErr == nil {
		if _, err := w.pool.Exec(ctx, sqlDeleteDelivery, deliveryID); err != nil {
			log.Printf("webhooks/worker: failed to delete delivery %d: %v", deliveryID, err)
		}
		return false, nil
	}

	log.Printf("webhooks/worker: delivery %d failed (attempt %d/%d): %v",
		deliveryID, attempts+1, maxAttempts, deliveryErr)

	nextAttempt := time.Now().Add(backoff(attempts + 1))
	if _, err := w.pool.Exec(ctx, sqlRecordDeliveryFailure,
		deliveryID, attempts+1, nextAttempt, deliveryErr.Error(),
	); err != nil {
		log.Printf("webhooks/worker: failed to record failure for delivery %d: %v", deliveryID, err)
	}
	return false, nil
}

func (w *Worker) deliver(ctx context.Context, url, secret, eventType string, payload []byte) error {
	sig := sign(secret, payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Vector-Event", eventType)
	req.Header.Set("X-Vector-Signature", "sha256="+sig)

	resp, err := w.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

// sign returns the hex-encoded HMAC-SHA256 of payload keyed by secret.
func sign(secret string, payload []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(payload)
	return hex.EncodeToString(mac.Sum(nil))
}

// backoff returns the delay before the (attempt+1)th retry.
// Formula: base * 2^attempt, capped at backoffCap.
func backoff(attempt int) time.Duration {
	exp := math.Pow(2, float64(attempt))
	d := time.Duration(float64(backoffBase) * exp)
	if d > backoffCap {
		d = backoffCap
	}
	return d
}

func isNoRows(err error) bool {
	return err != nil && err.Error() == "no rows in result set"
}

// EventPayload is the canonical JSON envelope for all webhook events.
type EventPayload struct {
	Event       string          `json:"event"`
	WorkspaceID string          `json:"workspace_id"`
	OccurredAt  time.Time       `json:"occurred_at"`
	Data        json.RawMessage `json:"data"`
}

// MarshalEvent serialises an EventPayload to JSON for use in Enqueue.
func MarshalEvent(workspaceID, eventType string, data any) ([]byte, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return json.Marshal(EventPayload{
		Event:       eventType,
		WorkspaceID: workspaceID,
		OccurredAt:  time.Now().UTC(),
		Data:        raw,
	})
}
