-- Add model modalities and release date columns (aligned with D1/MySQL 0003).

SET search_path TO octafuse_gateway;

ALTER TABLE models ADD COLUMN IF NOT EXISTS input_modalities TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS output_modalities TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS released_at TEXT;
