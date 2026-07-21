ALTER TABLE api_key_request_logs ADD COLUMN billing_kind VARCHAR(32) NULL;
ALTER TABLE api_key_request_logs ADD COLUMN input_image_count INT NOT NULL DEFAULT 0;
ALTER TABLE api_key_request_logs ADD COLUMN output_image_count INT NOT NULL DEFAULT 0;
