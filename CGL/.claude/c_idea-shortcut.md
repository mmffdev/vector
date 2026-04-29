# `<idea>` — Add Feature Idea

> **Port**: Read `backend_port` from `GET /api/dev/config/backend_port` if needed. Default: `5175`.

When the user writes text followed by **`<idea>`**, add it to the Feature Ideas table on the Statement of Work page via the API.

## Process

1. **Parse the message**: The text before `<idea>` is the feature idea. Extract a short **feature name** (2-4 words) and use the full text as the **description**.
2. **POST to the API**:
   ```bash
   curl -s -X POST http://localhost:5175/api/dev/ideas \
     -H "Content-Type: application/json" \
     -d '{"feature":"SHORT NAME","description":"Full description text","origin":"sprintXXX","status":"Idea"}'
   ```
   - `origin` = current sprint from CLAUDE.md Current State
   - `status` = always `Idea` unless the user specifies otherwise
3. **Report**: Show the assigned ID (e.g. `IDEA-002`) and confirm it was added.

## Rules

- Keep the feature name short — it's a label, not a sentence
- The description should capture the full idea as the user wrote it
- Do not create user stories, backlog items, or scope entries — this is just an idea capture
- If the API is unreachable, insert directly into Postgres (port 5434):
  ```bash
  PGPASSWORD=$(grep DB_PASSWORD backend/.env.local | cut -d'"' -f2) \
    /opt/homebrew/Cellar/libpq/18.3/bin/psql -h 127.0.0.1 -p 5434 -U mmff_dev -d mmff_ops \
    -c "INSERT INTO feature_ideas (id, feature, description, origin, status) VALUES ('IDEA-XXX', 'NAME', 'DESC', 'sprintXXX', 'Idea');"
  ```
  (Query `SELECT COUNT(*) FROM feature_ideas` first to determine the next ID number)

## Status Values

| Status | Meaning |
|--------|---------|
| `Idea` | Captured, not yet evaluated |
| `Scoped` | Broken into user stories via `<ATS>` |
| `Building` | Active development in a sprint |
| `Done` | Delivered |
| `Parked` | Deferred indefinitely |
