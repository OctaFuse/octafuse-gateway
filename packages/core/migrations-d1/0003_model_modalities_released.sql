-- Add model modalities and release date columns (aligned with Postgres/MySQL 0003).

ALTER TABLE models ADD COLUMN input_modalities TEXT DEFAULT NULL;
ALTER TABLE models ADD COLUMN output_modalities TEXT DEFAULT NULL;
ALTER TABLE models ADD COLUMN released_at TEXT DEFAULT NULL;
