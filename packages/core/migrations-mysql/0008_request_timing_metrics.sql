ALTER TABLE api_key_request_logs ADD COLUMN gateway_overhead_ms INT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN upstream_response_ms INT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN final_upstream_headers_ms INT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN first_token_ms INT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN stream_duration_ms INT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN upstream_attempt_count INT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN upstream_failover_count INT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN timing_metadata TEXT NULL;
