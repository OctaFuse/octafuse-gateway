ALTER TABLE api_key_request_logs ADD COLUMN gateway_overhead_ms INTEGER DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN upstream_response_ms INTEGER DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN final_upstream_headers_ms INTEGER DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN first_token_ms INTEGER DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN stream_duration_ms INTEGER DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN upstream_attempt_count INTEGER DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN upstream_failover_count INTEGER DEFAULT NULL;
ALTER TABLE api_key_request_logs ADD COLUMN timing_metadata TEXT DEFAULT NULL;
