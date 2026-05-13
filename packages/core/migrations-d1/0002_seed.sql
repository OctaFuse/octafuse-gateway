-- Optional dev/demo seed (idempotent). Requires 0001_baseline.sql applied.
-- Single source of truth for default keys/values: keep aligned with Postgres `migrations-postgres/0002_seed.sql`.

INSERT INTO system_config (key, value, description) VALUES
  (
    'MASTER_KEY',
    'sk-dev-admin-key',
    'Bearer token for Gateway admin API. Set in Admin Config.'
  ),
  (
    'BUSINESS_TIMEZONE',
    'UTC',
    'IANA timezone for day-boundary logic (today stats)'
  ),
  (
    'BILLING_CURRENCY',
    'USD',
    'ISO 4217 alphabetic code for pricing_profile and api_keys budget amounts (per-million-token unit).'
  )
ON CONFLICT(key) DO UPDATE SET
  value = CASE
    WHEN system_config.key = 'MASTER_KEY' THEN system_config.value
    ELSE excluded.value
  END,
  description = excluded.description;
