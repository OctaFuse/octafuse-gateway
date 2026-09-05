-- Per-key and per-user rate_limit JSON (NULL = unlimited) + request-log ingress host (observe only, not admission).
-- Window counters are process/isolate memory, not a table.
-- Current JSON shape: {"rpm": <non-negative int>}. Empty object is stored as NULL.
-- users.rate_limit is a shared pool across all keys of that user. api_keys.rate_limit is per-key.

ALTER TABLE api_keys ADD COLUMN rate_limit TEXT;
ALTER TABLE users ADD COLUMN rate_limit TEXT;

ALTER TABLE api_key_request_logs ADD COLUMN ingress_host TEXT;
CREATE INDEX idx_api_key_request_logs_ingress_created ON api_key_request_logs(ingress_host, created_at);
