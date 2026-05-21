// Package devreports SQL constants.
//
// PLA-0048 / RF1.2.9 — every raw SQL literal for this package lives here,
// referenced by service.go. See dev/scripts/lint_sql_in_sqlfile_only.py.
package devreports

const sqlListBase = `
SELECT id, type, title, COALESCE(category,''), COALESCE(topic,''),
       COALESCE(summary,''), COALESCE(content_text,''),
       COALESCE(to_char(report_date, 'YYYY-MM-DD'),''),
       created_at, updated_at
  FROM dev_reports`

const sqlListOrderBy = ` ORDER BY report_date DESC NULLS LAST, id DESC`

// sqlListTypeFilter is concatenated after a WHERE / AND. The $N placeholder
// is rewritten at call-site (one-arg dynamic builder; see service.List).
const sqlListTypeFilter = `type = $`

const sqlListSearchFilter = `(title ILIKE $%[1]d OR summary ILIKE $%[1]d OR content_text ILIKE $%[1]d)`

const sqlGetByID = `
SELECT id, type, title, COALESCE(category,''), COALESCE(topic,''),
       COALESCE(summary,''), COALESCE(content_text,''),
       COALESCE(to_char(report_date, 'YYYY-MM-DD'),''),
       created_at, updated_at, content, payload
  FROM dev_reports
 WHERE id = $1`

const sqlUpsert = `
INSERT INTO dev_reports
       (id, type, title, category, topic, summary,
        content, content_text, payload, report_date)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
ON CONFLICT (id) DO UPDATE SET
       type         = EXCLUDED.type,
       title        = EXCLUDED.title,
       category     = EXCLUDED.category,
       topic        = EXCLUDED.topic,
       summary      = EXCLUDED.summary,
       content      = EXCLUDED.content,
       content_text = EXCLUDED.content_text,
       payload      = EXCLUDED.payload,
       report_date  = EXCLUDED.report_date`

const sqlDeleteByID = `DELETE FROM dev_reports WHERE id = $1`
