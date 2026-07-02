-- Upstream trace ids on api_key_request_logs (two semantics):
--   upstream_request_id  — HTTP response header (x-request-id, request-id, x-ws-request-id, …)
--   upstream_message_id  — response body object id (chatcmpl-*, msg_*, responseId)
ALTER TABLE api_key_request_logs ADD COLUMN upstream_request_id TEXT;
ALTER TABLE api_key_request_logs ADD COLUMN upstream_message_id TEXT;
