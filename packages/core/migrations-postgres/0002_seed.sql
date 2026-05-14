-- Optional dev/demo seed (idempotent). Requires 0001_baseline.sql applied.
-- Single source of truth for default keys/values: keep aligned with D1 `migrations-d1/0002_seed.sql`.

SET search_path TO octafuse_gateway;

INSERT INTO system_config (key, value, description, updated_at) VALUES
  (
    'MASTER_KEY',
    'sk-dev-admin-key',
    'Bearer token for Gateway admin API. Set in Admin Config.',
    NOW()
  ),
  (
    'BUSINESS_TIMEZONE',
    'UTC',
    'IANA timezone for day-boundary logic (today stats)',
    NOW()
  ),
  (
    'BILLING_CURRENCY',
    'USD',
    'ISO 4217 alphabetic code for pricing_profile and user budget amounts (per-million-token unit).',
    NOW()
  )
ON CONFLICT (key) DO UPDATE SET
  value = CASE
    WHEN system_config.key = 'MASTER_KEY' THEN system_config.value
    ELSE EXCLUDED.value
  END,
  description = EXCLUDED.description,
  updated_at = NOW();
