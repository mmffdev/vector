package realtime

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// rankPayload mirrors the JSON shape produced by the
// notify_rank_changed() trigger function (db/mmff_vector/schema/069). Field names
// must stay aligned — the trigger is the source of truth.
type rankPayload struct {
	ResourceType   string     `json:"resource_type"`
	SubscriptionID uuid.UUID  `json:"subscription_id"`
	Scope          string     `json:"scope"` // "backlog" | "sprint"
	ScopeID        *uuid.UUID `json:"scope_id,omitempty"`
	RowID          uuid.UUID  `json:"row_id"`
	Op             string     `json:"op"` // "INSERT" | "UPDATE" | "DELETE"
}

// StartRankListener opens a dedicated Postgres connection, runs
// LISTEN rank_changed, and fans every NOTIFY payload to the hub.
// Returns a cancel func; calling it cleans up and the goroutine exits.
//
// Reconnect policy: any error tears down the listener and reopens
// after a 2s back-off. We don't bother with jitter — a NOTIFY listener
// is one connection per process, the thundering-herd risk is nil.
func StartRankListener(ctx context.Context, pool *pgxpool.Pool, hub *Hub) {
	go func() {
		for {
			if err := listenLoop(ctx, pool, hub); err != nil {
				log.Printf("realtime: rank listener: %v (reconnecting in 2s)", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Second):
			}
		}
	}()
}

func listenLoop(ctx context.Context, pool *pgxpool.Pool, hub *Hub) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, "LISTEN rank_changed"); err != nil {
		return err
	}

	for {
		n, err := conn.Conn().WaitForNotification(ctx)
		if err != nil {
			return err
		}
		var p rankPayload
		if err := json.Unmarshal([]byte(n.Payload), &p); err != nil {
			continue // skip malformed payload, keep listening
		}
		topic := TopicForRank(p.ResourceType, p.SubscriptionID, p.Scope, p.ScopeID)
		hub.Publish(topic, []byte(n.Payload))
	}
}
