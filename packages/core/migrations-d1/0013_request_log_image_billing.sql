ALTER TABLE api_key_request_logs ADD COLUMN billing_kind TEXT;
ALTER TABLE api_key_request_logs ADD COLUMN input_image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE api_key_request_logs ADD COLUMN output_image_count INTEGER NOT NULL DEFAULT 0;
