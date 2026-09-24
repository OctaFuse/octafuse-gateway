-- Provider kind: stable import-template name (or __custom__). Empty string means unclassified.
-- name stays the account alias. Uniqueness is (name, kind), not name alone.
-- Avoid semicolons in SQL comments.
SET search_path TO octafuse_gateway;

ALTER TABLE providers ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT '';

ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_name_key;

DROP INDEX IF EXISTS uk_providers_name_kind;
ALTER TABLE providers ADD CONSTRAINT uk_providers_name_kind UNIQUE (name, kind);
