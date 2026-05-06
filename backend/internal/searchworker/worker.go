// Package searchworker consumes o_search_index_outbox rows and keeps
// the TSVECTOR + pgvector content_embedding columns in sync with artefact
// content. It runs as a background goroutine started from main.go.
//
// Delivery guarantee: at-least-once via FOR UPDATE SKIP LOCKED.
// Multiple worker instances are safe — Postgres lock prevents double-processing.
// Polling every 5s is the fallback; pg_notify('search_index_queue') is the
// fast wake-up path (outbox trigger fires it on INSERT).
package searchworker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	pollInterval  = 5 * time.Second
	claimTimeout  = 30 * time.Second
	maxAttempts   = 5
)

// Config holds worker configuration loaded from environment.
type Config struct {
	OllamaURL  string // e.g. "http://localhost:11434"
	OllamaModel string // e.g. "nomic-embed-text"
}

// Worker consumes the search index outbox and updates artefact search
// vectors and embeddings.
type Worker struct {
	pool   *pgxpool.Pool
	cfg    Config
	client *http.Client
}

func New(pool *pgxpool.Pool, cfg Config) *Worker {
	if cfg.OllamaModel == "" {
		cfg.OllamaModel = "nomic-embed-text"
	}
	return &Worker{
		pool:   pool,
		cfg:    cfg,
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

// Run starts the worker loop. It blocks until ctx is cancelled.
// Call as: go worker.Run(ctx)
func (w *Worker) Run(ctx context.Context) {
	log.Println("searchworker: started")

	// Listen for pg_notify wake-ups.
	conn, err := w.pool.Acquire(ctx)
	if err != nil {
		log.Printf("searchworker: failed to acquire listen conn: %v", err)
	} else {
		defer conn.Release()
		if _, err := conn.Exec(ctx, "LISTEN search_index_queue"); err != nil {
			log.Printf("searchworker: LISTEN failed: %v", err)
		}
	}

	ticker := time.NewTicker(pollInterval)
	defer ticker.Stop()

	for {
		w.drainOutbox(ctx)

		select {
		case <-ctx.Done():
			log.Println("searchworker: shutting down")
			return
		case <-ticker.C:
		}

		// Also drain immediately on notify if the listen conn is available.
		if conn != nil {
			notifyCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
			conn.Conn().WaitForNotification(notifyCtx) //nolint:errcheck
			cancel()
		}
	}
}

// drainOutbox processes all currently claimable outbox rows.
func (w *Worker) drainOutbox(ctx context.Context) {
	for {
		processed, err := w.claimAndProcess(ctx)
		if err != nil {
			log.Printf("searchworker: claim error: %v", err)
			return
		}
		if !processed {
			return
		}
	}
}

// claimAndProcess claims one outbox row with FOR UPDATE SKIP LOCKED,
// processes it, and returns true if a row was found.
func (w *Worker) claimAndProcess(ctx context.Context) (bool, error) {
	tx, err := w.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)

	var rowID int64
	var artefactType, artefactIDStr string
	var attempts int

	claimCtx, cancel := context.WithTimeout(ctx, claimTimeout)
	defer cancel()

	err = tx.QueryRow(claimCtx, `
		SELECT id, artefact_type, artefact_id, attempts
		FROM o_search_index_outbox
		WHERE claimed_at IS NULL
		  AND attempts < $1
		ORDER BY enqueued_at
		LIMIT 1
		FOR UPDATE SKIP LOCKED`, maxAttempts,
	).Scan(&rowID, &artefactType, &artefactIDStr, &attempts)
	if err != nil {
		// pgx returns no error on no-rows for QueryRow when using Scan —
		// a zero rowID means nothing was found.
		if rowID == 0 {
			tx.Rollback(ctx)
			return false, nil
		}
		return false, err
	}
	if rowID == 0 {
		return false, nil
	}

	// Mark claimed.
	if _, err := tx.Exec(claimCtx, `
		UPDATE o_search_index_outbox SET claimed_at = NOW()
		WHERE id = $1`, rowID); err != nil {
		return false, err
	}
	if err := tx.Commit(claimCtx); err != nil {
		return false, err
	}

	// Process outside the transaction so the lock is released.
	if err := w.process(ctx, rowID, artefactType, artefactIDStr); err != nil {
		log.Printf("searchworker: process error (row %d, type %s, id %s attempt %d): %v",
			rowID, artefactType, artefactIDStr, attempts+1, err)
		w.recordFailure(ctx, rowID, err.Error())
		return true, nil
	}

	// Success — delete the outbox row.
	if _, err := w.pool.Exec(ctx, `DELETE FROM o_search_index_outbox WHERE id = $1`, rowID); err != nil {
		log.Printf("searchworker: failed to delete outbox row %d: %v", rowID, err)
	}
	return true, nil
}

// process fetches the artefact content, computes TSVECTOR and embedding,
// and writes both back to the core artefact row.
func (w *Worker) process(ctx context.Context, rowID int64, artefactType, artefactIDStr string) error {
	t, ok := coreTable(artefactType)
	if !ok {
		return fmt.Errorf("unknown artefact type %q", artefactType)
	}

	// Fetch text content from the core table.
	var title, contentPlain string
	var descPtr *string
	err := w.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT title, description, COALESCE(content_plain_text,'')
		FROM %s WHERE id = $1 AND archived_at IS NULL`, t),
		artefactIDStr,
	).Scan(&title, &descPtr, &contentPlain)
	if err != nil {
		return fmt.Errorf("fetch artefact: %w", err)
	}
	desc := ""
	if descPtr != nil {
		desc = *descPtr
	}
	combined := title + " " + desc + " " + contentPlain

	// Recompute TSVECTOR in Postgres.
	var tsvector string
	if err := w.pool.QueryRow(ctx,
		`SELECT to_tsvector('english', $1)::text`, combined,
	).Scan(&tsvector); err != nil {
		return fmt.Errorf("tsvector: %w", err)
	}

	// Get embedding from Ollama.
	embedding, err := w.embed(ctx, combined)
	if err != nil {
		return fmt.Errorf("embed: %w", err)
	}

	// Write both back.
	_, err = w.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s
		SET search_index    = $2::tsvector,
		    content_embedding = $3::vector
		WHERE id = $1`, t),
		artefactIDStr, tsvector, pgvectorLiteral(embedding))
	if err != nil {
		return fmt.Errorf("write back: %w", err)
	}
	return nil
}

// embed calls the Ollama HTTP API and returns the embedding vector.
func (w *Worker) embed(ctx context.Context, text string) ([]float32, error) {
	body, _ := json.Marshal(map[string]string{
		"model":  w.cfg.OllamaModel,
		"prompt": text,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		w.cfg.OllamaURL+"/api/embeddings", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := w.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ollama HTTP %d", resp.StatusCode)
	}

	var result struct {
		Embedding []float32 `json:"embedding"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	if len(result.Embedding) == 0 {
		return nil, fmt.Errorf("ollama returned empty embedding")
	}
	return result.Embedding, nil
}

// recordFailure increments attempts and records the error on the outbox row,
// and clears claimed_at so it will be retried on the next poll.
func (w *Worker) recordFailure(ctx context.Context, rowID int64, errMsg string) {
	_, err := w.pool.Exec(ctx, `
		UPDATE o_search_index_outbox
		SET attempts   = attempts + 1,
		    last_error = $2,
		    claimed_at = NULL
		WHERE id = $1`, rowID, errMsg)
	if err != nil {
		log.Printf("searchworker: failed to record failure for row %d: %v", rowID, err)
	}
}

// pgvectorLiteral converts a float32 slice to the Postgres vector literal
// format: '[0.1,0.2,...]' — accepted by the pgvector extension via ::vector cast.
func pgvectorLiteral(v []float32) string {
	b := make([]byte, 0, len(v)*10)
	b = append(b, '[')
	for i, f := range v {
		if i > 0 {
			b = append(b, ',')
		}
		b = append(b, fmt.Sprintf("%g", f)...)
	}
	b = append(b, ']')
	return string(b)
}

// coreTable maps scope_key → core table name. Empty during the
// vector_artefacts cutover (see docs/c_c_vector_artefacts_backfill.md):
// migrations 124 and 125 dropped the legacy per-type artefact tables
// entirely. Re-populate when the worker is rewired against the new
// substrate.
var coreTableMap = map[string]string{}

func coreTable(artefactType string) (string, bool) {
	t, ok := coreTableMap[artefactType]
	return t, ok
}
