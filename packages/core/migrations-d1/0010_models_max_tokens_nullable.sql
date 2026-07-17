-- D1 baseline already allows NULL on models.max_tokens (INTEGER DEFAULT 8192, no NOT NULL).
-- Keep a no-op migration so version numbers stay aligned across drivers.
SELECT 1;
