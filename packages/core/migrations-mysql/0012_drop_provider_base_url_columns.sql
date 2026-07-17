-- Phase 2: endpoints is authoritative; drop legacy base_url_* columns.
-- Apply after code that no longer reads/writes these columns is deployed.
ALTER TABLE providers DROP COLUMN base_url_openai;
ALTER TABLE providers DROP COLUMN base_url_anthropic;
ALTER TABLE providers DROP COLUMN base_url_gemini;
