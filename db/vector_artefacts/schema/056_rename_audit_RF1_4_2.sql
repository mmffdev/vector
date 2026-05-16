-- RF1.4.2.audit — audit_log → audit_logs + column-prefix.
BEGIN;

ALTER TABLE audit_log RENAME TO audit_logs;

ALTER TABLE audit_logs RENAME COLUMN id               TO audit_logs_id;
ALTER TABLE audit_logs RENAME COLUMN user_id          TO audit_logs_id_user;
ALTER TABLE audit_logs RENAME COLUMN subscription_id  TO audit_logs_id_subscription;
ALTER TABLE audit_logs RENAME COLUMN action           TO audit_logs_action;
ALTER TABLE audit_logs RENAME COLUMN resource         TO audit_logs_resource;
ALTER TABLE audit_logs RENAME COLUMN resource_id      TO audit_logs_resource_id;
ALTER TABLE audit_logs RENAME COLUMN metadata         TO audit_logs_metadata;
ALTER TABLE audit_logs RENAME COLUMN ip_address       TO audit_logs_ip_address;
ALTER TABLE audit_logs RENAME COLUMN created_at       TO audit_logs_created_at;
ALTER TABLE audit_logs RENAME COLUMN source_transport TO audit_logs_source_transport;

ALTER TABLE audit_logs RENAME CONSTRAINT audit_log_source_transport_check
                                      TO audit_logs_source_transport_check;

ALTER INDEX idx_audit_log_action           RENAME TO idx_audit_logs_action;
ALTER INDEX idx_audit_log_created          RENAME TO idx_audit_logs_created;
ALTER INDEX idx_audit_log_source_transport RENAME TO idx_audit_logs_source_transport;
ALTER INDEX idx_audit_log_subscription_id  RENAME TO idx_audit_logs_id_subscription;
ALTER INDEX idx_audit_log_user_id          RENAME TO idx_audit_logs_id_user;

COMMENT ON TABLE audit_logs IS
    'Append-only audit trail. Renamed audit_log → audit_logs in RF1.4.2.audit (PLA-0048, 2026-05-14). FKs to users/subscriptions remain app-enforced.';

COMMIT;
