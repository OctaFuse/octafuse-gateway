-- Catalog copy (provider kind and model introductions) lives in static presets.
-- The former description columns are operator notes and are not returned by public APIs.

SET search_path TO octafuse_gateway;

ALTER TABLE models RENAME COLUMN description TO note;
ALTER TABLE providers RENAME COLUMN description TO note;
