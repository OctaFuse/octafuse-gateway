-- Optional dev/demo seed (idempotent). Requires 0001_baseline.sql applied.
-- Single source of truth for default keys/values: keep aligned with D1 `migrations-d1/0002_seed.sql` and Postgres `migrations-postgres/0002_seed.sql`.

INSERT INTO system_config (`key`, value, description, updated_at) VALUES
  (
    'MASTER_KEY',
    'sk-dev-admin-key',
    'Bearer token for Gateway admin API. Set in Admin Config.',
    CURRENT_TIMESTAMP(6)
  ),
  (
    'BUSINESS_TIMEZONE',
    'UTC',
    'IANA timezone for day-boundary logic (today stats)',
    CURRENT_TIMESTAMP(6)
  ),
  (
    'BILLING_CURRENCY',
    'USD',
    'ISO 4217 alphabetic code for pricing_profile and user budget amounts (per-million-token unit).',
    CURRENT_TIMESTAMP(6)
  )
AS new
ON DUPLICATE KEY UPDATE
  value = IF(`key` = 'MASTER_KEY', value, new.value),
  description = new.description,
  updated_at = new.updated_at;
