package erd

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// normaliseType maps pg type names to short canonical forms used in the
// ERD payload. Unknown types pass through unchanged.
func normaliseType(pgType string) string {
	switch pgType {
	case "character varying", "text":
		return "text"
	case "timestamp with time zone":
		return "timestamptz"
	case "timestamp without time zone":
		return "timestamp"
	case "integer":
		return "int4"
	case "bigint":
		return "int8"
	case "smallint":
		return "int2"
	case "boolean":
		return "bool"
	case "double precision":
		return "float8"
	case "real":
		return "float4"
	case "json", "jsonb", "uuid":
		return pgType
	}
	return pgType
}

const sqlTableRowCounts = `
SELECT relname AS table_name,
       n_live_tup AS row_count
  FROM pg_stat_user_tables
 WHERE schemaname = 'public'
 ORDER BY relname;
`

const sqlColumns = `
SELECT c.table_name,
       c.column_name,
       c.data_type,
       c.is_nullable,
       CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk,
       CASE WHEN fk.column_name IS NOT NULL THEN true ELSE false END AS is_fk
  FROM information_schema.columns c
  LEFT JOIN (
       SELECT kcu.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
       ) pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name
  LEFT JOIN (
       SELECT kcu.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
       ) fk ON fk.table_name = c.table_name AND fk.column_name = c.column_name
 WHERE c.table_schema = 'public'
 ORDER BY c.table_name, c.ordinal_position;
`

// sqlHardFKs returns each FK with its from/to table+column and ON DELETE clause.
// Self-referencing FKs are included.
const sqlHardFKs = `
SELECT conname                            AS fk_name,
       cl.relname                         AS from_table,
       fa.attname                         AS from_column,
       fcl.relname                        AS to_table,
       ffa.attname                        AS to_column,
       CASE c.confdeltype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
       END                                AS on_delete
  FROM pg_constraint c
  JOIN pg_class cl  ON cl.oid  = c.conrelid
  JOIN pg_class fcl ON fcl.oid = c.confrelid
  JOIN pg_attribute fa  ON fa.attrelid  = c.conrelid  AND fa.attnum  = ANY(c.conkey)
  JOIN pg_attribute ffa ON ffa.attrelid = c.confrelid AND ffa.attnum = ANY(c.confkey)
  JOIN pg_namespace n   ON n.oid = cl.relnamespace
 WHERE c.contype = 'f'
   AND n.nspname = 'public'
 ORDER BY cl.relname, conname;
`

// fetchRowCounts returns table -> row count for the given pool.
func fetchRowCounts(ctx context.Context, db *pgxpool.Pool) (map[string]int64, error) {
	rows, err := db.Query(ctx, sqlTableRowCounts)
	if err != nil {
		return nil, fmt.Errorf("row counts: %w", err)
	}
	defer rows.Close()
	out := map[string]int64{}
	for rows.Next() {
		var name string
		var n int64
		if err := rows.Scan(&name, &n); err != nil {
			return nil, err
		}
		out[name] = n
	}
	return out, rows.Err()
}

// fetchColumns returns table -> [columns]. Each column has is_pk/is_fk/nullable flags.
func fetchColumns(ctx context.Context, db *pgxpool.Pool) (map[string][]Column, error) {
	rows, err := db.Query(ctx, sqlColumns)
	if err != nil {
		return nil, fmt.Errorf("columns: %w", err)
	}
	defer rows.Close()
	out := map[string][]Column{}
	for rows.Next() {
		var table, col, dtype, nullableStr string
		var isPK, isFK bool
		if err := rows.Scan(&table, &col, &dtype, &nullableStr, &isPK, &isFK); err != nil {
			return nil, err
		}
		out[table] = append(out[table], Column{
			Name:     col,
			Type:     normaliseType(dtype),
			IsPK:     isPK,
			IsFK:     isFK,
			Nullable: nullableStr == "YES",
		})
	}
	return out, rows.Err()
}

// fetchHardFKs returns one Edge per FK constraint. The database label is
// prepended to from/to so node ids match the convention "{db}.{table}".
func fetchHardFKs(ctx context.Context, db *pgxpool.Pool, dbLabel string) ([]Edge, error) {
	rows, err := db.Query(ctx, sqlHardFKs)
	if err != nil {
		return nil, fmt.Errorf("fks: %w", err)
	}
	defer rows.Close()
	var out []Edge
	for rows.Next() {
		var name, ft, fc, tt, tc, od string
		if err := rows.Scan(&name, &ft, &fc, &tt, &tc, &od); err != nil {
			return nil, err
		}
		out = append(out, Edge{
			ID:         "fk_" + name,
			From:       dbLabel + "." + ft,
			To:         dbLabel + "." + tt,
			FromColumn: fc,
			ToColumn:   tc,
			Kind:       "hard_fk",
			OnDelete:   od,
		})
	}
	return out, rows.Err()
}
