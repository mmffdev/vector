# `db/schema/down/` — rollback scripts

Reverse migrations for files in `db/schema/`. Filename convention:

    <NNN>_<name>_DOWN.sql

The migrate runner (`backend/cmd/migrate/main.go`) reads only the **top
level** of `db/schema/`, so anything in this subdirectory is skipped by
design — DOWN scripts never auto-apply.

To run one, invoke `psql` directly against the target DB. Always check
the corresponding UP migration first to confirm whether the DOWN is
data-preserving or destructive.
