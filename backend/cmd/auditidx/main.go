// Throwaway one-shot for PLA-0011/00396: dump pg_stat_user_indexes rows
// where idx_scan = 0 on mmff_vector and write the list to a file.
// Connects via backend/.env.dev only; never logs credentials.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/mmffdev/vector-backend/internal/secrets"
)

type idxRow struct {
	Schema    string `json:"schemaname"`
	Table     string `json:"relname"`
	Index     string `json:"indexrelname"`
	Scans     int64  `json:"idx_scan"`
	SizeKB    int64  `json:"size_kb"`
	IsUnique  bool   `json:"is_unique"`
	IsPrimary bool   `json:"is_primary"`
}

func main() {
	envFile := flag.String("env", "backend/.env.dev", "path to .env file")
	out := flag.String("out", "dev/reports/unused_indexes.json", "output JSON path")
	flag.Parse()

	if err := godotenv.Load(*envFile); err != nil {
		log.Fatalf("load env: %v", err)
	}

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s",
		secrets.Get("DB_USER"),
		secrets.Get("DB_PASSWORD"),
		envOr("DB_HOST", "localhost"),
		envOr("DB_PORT", "5435"),
		envOr("DB_NAME", "mmff_vector"),
	)

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("pool: %v", err)
	}
	defer pool.Close()

	const q = `
SELECT
  s.schemaname,
  s.relname,
  s.indexrelname,
  s.idx_scan,
  COALESCE(pg_relation_size(s.indexrelid), 0) / 1024 AS size_kb,
  i.indisunique,
  i.indisprimary
FROM pg_stat_user_indexes s
JOIN pg_index i ON i.indexrelid = s.indexrelid
WHERE s.idx_scan = 0
ORDER BY s.schemaname, s.relname, s.indexrelname
`
	rows, err := pool.Query(ctx, q)
	if err != nil {
		log.Fatalf("query: %v", err)
	}
	defer rows.Close()

	var list []idxRow
	for rows.Next() {
		var r idxRow
		if err := rows.Scan(&r.Schema, &r.Table, &r.Index, &r.Scans, &r.SizeKB, &r.IsUnique, &r.IsPrimary); err != nil {
			log.Fatalf("scan: %v", err)
		}
		list = append(list, r)
	}

	if err := os.MkdirAll("dev/reports", 0o755); err != nil {
		log.Fatalf("mkdir: %v", err)
	}
	f, err := os.Create(*out)
	if err != nil {
		log.Fatalf("create: %v", err)
	}
	defer f.Close()
	enc := json.NewEncoder(f)
	enc.SetIndent("", "  ")
	var droppable, uniques, primaries int
	for _, r := range list {
		switch {
		case r.IsPrimary:
			primaries++
		case r.IsUnique:
			uniques++
		default:
			droppable++
		}
	}
	if err := enc.Encode(map[string]any{
		"db":          envOr("DB_NAME", "mmff_vector"),
		"host":        envOr("DB_HOST", "localhost") + ":" + envOr("DB_PORT", "5435"),
		"count_total": len(list),
		"count_droppable_secondary_nonunique": droppable,
		"count_unique_constraints":            uniques,
		"count_primary_keys":                  primaries,
		"indexes":                             list,
	}); err != nil {
		log.Fatalf("encode: %v", err)
	}
	fmt.Printf("total=%d droppable_secondary=%d unique=%d primary=%d -> %s\n",
		len(list), droppable, uniques, primaries, *out)
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}
